from datetime import timedelta
from io import BytesIO
import json
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from django.test import override_settings
from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from .models import VirtualCareAccount, VirtualVisit
from .authentication import HospitalIdentityUnavailable, verify_hospital_identity
from rest_framework.exceptions import AuthenticationFailed


class VirtualCareWorkflowTests(APITestCase):
    def setUp(self):
        verifier = patch("virtualcare_service.core.authentication.verify_hospital_identity")
        self.verify_hospital = verifier.start()
        self.addCleanup(verifier.stop)
        self.scheduled_at = (timezone.now() + timedelta(days=1)).replace(
            minute=0, second=0, microsecond=0
        )

    def token_for(self, role, user_id, patient_id="", clinician_id=""):
        token = AccessToken()
        token["user_id"] = user_id
        token["role"] = role
        token["organization_id"] = "org-1"
        token["patient_id"] = patient_id
        token["clinician_id"] = clinician_id
        return str(token)

    def authenticate(self, role, user_id, patient_id="", clinician_id=""):
        self.client.credentials(
            HTTP_AUTHORIZATION=(
                f"Bearer {self.token_for(role, user_id, patient_id, clinician_id)}"
            )
        )

    def create_visit(self):
        self.authenticate("admin", "admin-1")
        return self.client.post(
            "/api/v1/sessions/",
            {
                "appointment_id": "appt-1",
                "patient_id": "patient-1",
                "patient_name": "Test Patient",
                "clinician_id": "clinician-1",
                "clinician_name": "Dr. Test",
                "scheduled_at": self.scheduled_at.isoformat(),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="virtual-booking-1",
        )

    def test_booking_retry_returns_the_existing_session(self):
        first = self.create_visit()
        retry = self.create_visit()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(first.data["id"], retry.data["id"])
        self.assertEqual(VirtualVisit.objects.count(), 1)

    def test_each_user_sees_only_their_own_visits(self):
        visit_id = self.create_visit().data["id"]
        url = f"/api/v1/sessions/{visit_id}/"

        def status_for(*identity):
            self.authenticate(*identity)
            return (
                self.client.get("/api/v1/sessions/").data,
                self.client.get(url).status_code,
            )

        own, own_status = status_for("patient", "u-1", "patient-1")
        self.assertEqual((len(own["results"] if "results" in own else own), own_status), (1, 200))
        for identity in (
            ("patient", "u-2", "patient-2"),
            ("patient", "u-3", ""),
            ("clinician", "c-2", "", "clinician-2"),
            ("clinician", "c-3", "", ""),
        ):
            listing, detail_status = status_for(*identity)
            self.assertEqual(len(listing["results"] if "results" in listing else listing), 0, identity)
            self.assertEqual(detail_status, 404, identity)

    def test_consent_gates_intake_consultation_and_completion(self):
        created = self.create_visit()
        visit_id = created.data["id"]
        self.authenticate("patient", "patient-user", patient_id="patient-1")

        blocked = self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "intake"},
            format="json",
        )
        self.assertEqual(blocked.status_code, 400)

        self.client.post(
            f"/api/v1/sessions/{visit_id}/consent/",
            {"granted": True},
            format="json",
        )
        intake_stage = self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "intake"},
            format="json",
        )
        self.assertEqual(intake_stage.status_code, 200)
        intake = self.client.post(
            f"/api/v1/sessions/{visit_id}/intake/",
            {
                "reason": "Persistent headache",
                "verified": True,
                "interpreter_requested": True,
                "language": "Swahili",
            },
            format="json",
        )
        self.assertEqual(intake.status_code, 200)
        waiting = self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "waiting"},
            format="json",
        )
        self.assertEqual(waiting.status_code, 200)

        self.authenticate("clinician", "doctor-1", clinician_id="clinician-1")
        consulting = self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "consulting"},
            format="json",
        )
        self.assertEqual(consulting.status_code, 200)
        self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "interrupted"},
            format="json",
        )

        self.authenticate("patient", "patient-user", patient_id="patient-1")
        self.client.post(
            f"/api/v1/sessions/{visit_id}/consent/",
            {"granted": False},
            format="json",
        )
        self.authenticate("clinician", "doctor-1", clinician_id="clinician-1")
        blocked_resume = self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "waiting"},
            format="json",
        )
        self.assertEqual(blocked_resume.status_code, 400)

        self.authenticate("patient", "patient-user", patient_id="patient-1")
        self.client.post(
            f"/api/v1/sessions/{visit_id}/consent/",
            {"granted": True},
            format="json",
        )
        self.authenticate("clinician", "doctor-1", clinician_id="clinician-1")
        self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "waiting"},
            format="json",
        )
        self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "consulting"},
            format="json",
        )
        completed = self.client.post(
            f"/api/v1/sessions/{visit_id}/complete/",
            {
                "note": "No red flags on assessment.",
                "summary": "Headache likely tension-related.",
                "follow_up_plan": "Review if symptoms persist.",
                "follow_up_date": "2027-01-15",
                "lab_orders": [{"test_name": "CBC"}],
                "prescriptions": [
                    {"medication": "Paracetamol", "dosage": "500 mg", "instructions": "As needed"}
                ],
            },
            format="json",
        )

        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.data["status"], "completed")
        self.assertEqual(completed.data["lab_orders"], [{"test_name": "CBC"}])
        self.assertEqual(completed.data["prescriptions"][0]["medication"], "Paracetamol")
        self.assertGreaterEqual(len(completed.data["audit_events"]), 8)

    def test_only_assigned_clinician_can_start_consultation(self):
        created = self.create_visit()
        visit_id = created.data["id"]
        self.authenticate("patient", "patient-user", patient_id="patient-1")
        self.client.post(
            f"/api/v1/sessions/{visit_id}/consent/",
            {"granted": True},
            format="json",
        )
        self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "intake"},
            format="json",
        )
        self.client.post(
            f"/api/v1/sessions/{visit_id}/intake/",
            {"reason": "Consultation", "verified": True},
            format="json",
        )
        self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "waiting"},
            format="json",
        )
        self.authenticate("clinician", "other-doctor", clinician_id="clinician-2")

        response = self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/",
            {"status": "consulting"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    @override_settings(VIRTUALCARE_BOOTSTRAP_KEY="synthetic-bootstrap-key")
    def test_standalone_accounts_authenticate_and_book_without_hospital_identity(self):
        bootstrapped = self.client.post(
            "/api/v1/auth/bootstrap/",
            {
                "bootstrap_key": "synthetic-bootstrap-key",
                "organization": "independent-test",
                "username": "vc-admin",
                "display_name": "VC Admin",
                "password": "SyntheticAdminPassword123",
            },
            format="json",
        )
        self.assertEqual(bootstrapped.status_code, 201, bootstrapped.data)
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {bootstrapped.data['access']}"
        )
        clinician_response = self.client.post(
            "/api/v1/directory/",
            {
                "role": "clinician",
                "username": "vc-clinician",
                "display_name": "Dr. Virtual",
                "password": "SyntheticClinicianPassword123",
            },
            format="json",
        )
        self.assertEqual(clinician_response.status_code, 201, clinician_response.data)

        patient_response = self.client.post(
            "/api/v1/auth/register/",
            {
                "organization": "independent-test",
                "username": "vc-patient",
                "display_name": "Virtual Patient",
                "password": "SyntheticPatientPassword123",
            },
            format="json",
        )
        self.assertEqual(patient_response.status_code, 201, patient_response.data)
        self.assertEqual(VirtualCareAccount.objects.count(), 3)

        login = self.client.post(
            "/api/v1/auth/login/",
            {
                "organization": "independent-test",
                "username": "vc-patient",
                "password": "SyntheticPatientPassword123",
            },
            format="json",
        )
        self.assertEqual(login.status_code, 200, login.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        directory = self.client.get("/api/v1/directory/")
        self.assertEqual(directory.status_code, 200, directory.data)
        self.assertEqual(len(directory.data["patients"]), 1)
        self.assertEqual(len(directory.data["clinicians"]), 1)

        booking = self.client.post(
            "/api/v1/sessions/",
            {
                "patient_id": login.data["user"]["patient_id"],
                "patient_name": "Virtual Patient",
                "clinician_id": clinician_response.data["clinician_id"],
                "clinician_name": "Dr. Virtual",
                "scheduled_at": (timezone.now() + timedelta(days=1)).replace(
                    minute=0, second=0, microsecond=0
                ).isoformat(),
            },
            format="json",
        )
        self.assertEqual(booking.status_code, 201, booking.data)
        self.assertFalse(booking.data["consent_active"])
        visit_id = booking.data["id"]
        for action, payload in (
            ("consent", {"granted": True}),
            ("transition", {"status": "intake"}),
            ("intake", {"reason": "Synthetic visit", "verified": True}),
            ("transition", {"status": "waiting"}),
        ):
            response = self.client.post(f"/api/v1/sessions/{visit_id}/{action}/", payload, format="json")
            self.assertEqual(response.status_code, 200, response.data)
        clinician_login = self.client.post("/api/v1/auth/login/", {
            "organization": "independent-test", "username": "vc-clinician",
            "password": "SyntheticClinicianPassword123",
        }, format="json")
        self.assertEqual(clinician_login.status_code, 200, clinician_login.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {clinician_login.data['access']}")
        response = self.client.post(
            f"/api/v1/sessions/{visit_id}/transition/", {"status": "consulting"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(
            f"/api/v1/sessions/{visit_id}/complete/",
            {"note": "Synthetic note.", "summary": "Synthetic summary."}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "completed")
        self.verify_hospital.assert_not_called()

    @override_settings(VIRTUALCARE_BOOTSTRAP_KEY="synthetic-bootstrap-key")
    def test_admin_manages_doctors_and_users_update_their_own_profile(self):
        self.client.post("/api/v1/auth/bootstrap/", {
            "bootstrap_key": "synthetic-bootstrap-key", "organization": "solo",
            "username": "root", "display_name": "Root Admin",
            "password": "SyntheticAdminPassword123",
        }, format="json")
        status_data = self.client.get("/api/v1/auth/status/").data
        self.assertEqual((status_data["initialized"], status_data["organization"]), (True, "solo"))

        login = self.client.post("/api/v1/auth/login/", {
            "username": "root", "password": "SyntheticAdminPassword123",
        }, format="json")
        self.assertEqual(login.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        doctor = self.client.post("/api/v1/directory/", {
            "role": "clinician", "username": "dr1", "display_name": "Dr One",
            "specialty": "Cardiology", "phone": "+2526", "password": "SyntheticDoctorPass123",
        }, format="json")
        self.assertEqual(doctor.status_code, 201, doctor.data)
        updated = self.client.patch(f"/api/v1/directory/{doctor.data['id']}/", {
            "specialty": "Neurology", "username": "dr1b",
        }, format="json")
        self.assertEqual((updated.data["specialty"], updated.data["username"]), ("Neurology", "dr1b"))
        listed = self.client.get("/api/v1/directory/").data["clinicians"]
        self.assertEqual(listed[0]["specialty"], "Neurology")

        self.client.credentials()
        doctor_login = self.client.post("/api/v1/auth/login/", {
            "username": "dr1b", "password": "SyntheticDoctorPass123",
        }, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {doctor_login.data['access']}")
        self.assertEqual(self.client.get("/api/v1/directory/").data.get("accounts"), None)
        self.assertEqual(self.client.patch(
            f"/api/v1/directory/{doctor.data['id']}/", {"is_active": False}, format="json"
        ).status_code, 403)
        wrong = self.client.patch("/api/v1/auth/me/", {
            "current_password": "nope", "new_password": "AnotherSyntheticPass123",
        }, format="json")
        self.assertEqual(wrong.status_code, 400)
        changed = self.client.patch("/api/v1/auth/me/", {
            "display_name": "Dr Uno", "current_password": "SyntheticDoctorPass123",
            "new_password": "AnotherSyntheticPass123",
        }, format="json")
        self.assertEqual(changed.data["display_name"], "Dr Uno")
        self.client.credentials()
        self.assertEqual(self.client.post("/api/v1/auth/login/", {
            "username": "dr1b", "password": "AnotherSyntheticPass123",
        }, format="json").status_code, 200)

    @override_settings(VIRTUALCARE_BOOTSTRAP_KEY="synthetic-bootstrap-key")
    def test_admin_lists_and_deactivates_organization_accounts_only(self):
        for org in ("org-a", "org-b"):
            self.client.post("/api/v1/auth/bootstrap/", {
                "bootstrap_key": "synthetic-bootstrap-key", "organization": org,
                "username": f"{org}-admin", "display_name": "Admin",
                "password": "SyntheticAdminPassword123",
            }, format="json")
        other = VirtualCareAccount.objects.get(organization="org-b")
        login = self.client.post("/api/v1/auth/login/", {
            "organization": "org-a", "username": "org-a-admin",
            "password": "SyntheticAdminPassword123",
        }, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
        patient = self.client.post("/api/v1/auth/register/", {
            "organization": "org-a", "username": "p1", "display_name": "Pat One",
            "password": "SyntheticPatientPassword123",
        }, format="json")
        self.assertEqual(patient.status_code, 201)

        listing = self.client.get("/api/v1/directory/")
        self.assertEqual(
            {a["username"] for a in listing.data["accounts"]}, {"org-a-admin", "p1"}
        )
        patient_id = patient.data["user"]["id"]
        self.assertEqual(
            self.client.patch(f"/api/v1/directory/{patient_id}/", {"is_active": False}, format="json").status_code,
            200,
        )
        self.assertEqual(self.client.post("/api/v1/auth/login/", {
            "organization": "org-a", "username": "p1", "password": "SyntheticPatientPassword123",
        }, format="json").status_code, 403)
        self.assertEqual(
            self.client.patch(f"/api/v1/directory/{login.data['user']['id']}/", {"is_active": False}, format="json").status_code,
            400,
        )
        self.assertEqual(
            self.client.patch(f"/api/v1/directory/{other.pk}/", {"is_active": False}, format="json").status_code,
            404,
        )
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + self.client.post("/api/v1/auth/login/", {
            "organization": "org-a", "username": "org-a-admin", "password": "SyntheticAdminPassword123",
        }, format="json").data["access"])
        reactivate = self.client.patch(f"/api/v1/directory/{patient_id}/", {"is_active": True}, format="json")
        self.assertEqual(reactivate.status_code, 200)


class HospitalIdentityTests(SimpleTestCase):
    def setUp(self):
        self.claims = {
            "user_id": "1", "role": "patient", "organization_id": "org",
            "patient_id": "patient", "clinician_id": "",
        }
        self.identity = {
            "id": 1, "role": "patient", "organization": "org",
            "patient_id": "patient", "clinician_id": None,
        }

    @patch("virtualcare_service.core.authentication.build_opener")
    def test_hospital_identity_matches_and_changed_identity_is_rejected(self, opener):
        opener.return_value.open.return_value.__enter__.return_value = BytesIO(
            json.dumps(self.identity).encode()
        )
        verify_hospital_identity("synthetic-token", self.claims)
        self.identity["role"] = "clinician"
        opener.return_value.open.return_value.__enter__.return_value = BytesIO(
            json.dumps(self.identity).encode()
        )
        with self.assertRaises(AuthenticationFailed):
            verify_hospital_identity("synthetic-token", self.claims)

    @patch("virtualcare_service.core.authentication.build_opener")
    def test_revoked_or_unavailable_hospital_identity_fails_closed(self, opener):
        opener.return_value.open.side_effect = HTTPError("http://hospital", 401, "Unauthorized", {}, None)
        with self.assertRaises(AuthenticationFailed):
            verify_hospital_identity("synthetic-token", self.claims)
        opener.return_value.open.side_effect = URLError("unavailable")
        with self.assertRaises(HospitalIdentityUnavailable):
            verify_hospital_identity("synthetic-token", self.claims)
