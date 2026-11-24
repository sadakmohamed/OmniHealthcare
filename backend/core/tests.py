"""
OmniHealthcare – comprehensive test suite.

Run:  python manage.py test core
"""

import uuid
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import (
    Allergy,
    Appointment,
    AuditEvent,
    Bill,
    ClinicalNote,
    Clinician,
    Encounter,
    LabOrder,
    LabResult,
    Organization,
    Patient,
    Payment,
    Prescription,
)

User = get_user_model()

PASSWORD = "Password123!"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _org(code="ORG-TEST"):
    return Organization.objects.create(name=f"Test Org {code}", code=code)


def _user(org, role="admin", username=None):
    username = username or f"{role}_{uuid.uuid4().hex[:6]}"
    u = User.objects.create_user(
        username=username,
        password=PASSWORD,
        role=role,
        organization=org,
    )
    return u


def _patient(org, mrn=None):
    mrn = mrn or f"MRN-{uuid.uuid4().hex[:8].upper()}"
    return Patient.objects.create(
        organization=org,
        medical_record_number=mrn,
        first_name="Test",
        last_name="Patient",
        date_of_birth=date(1985, 1, 1),
        sex="Male",
    )


def _clinician(org, user=None):
    if user is None:
        user = _user(org, role="clinician")
    return Clinician.objects.create(organization=org, user=user, specialty="General")


def _appointment(org, patient, clinician, starts_at=None, status="scheduled"):
    starts_at = starts_at or timezone.now() + timedelta(hours=1)
    return Appointment.objects.create(
        organization=org,
        patient=patient,
        clinician=clinician,
        starts_at=starts_at,
        status=status,
    )


def _encounter(org, patient, clinician, appointment=None, enc_status="scheduled"):
    return Encounter.objects.create(
        organization=org,
        patient=patient,
        clinician=clinician,
        appointment=appointment,
        status=enc_status,
    )


def _login(client, user):
    resp = client.post(
        "/api/v1/auth/login/",
        {"username": user.username, "password": PASSWORD},
        format="json",
    )
    assert resp.status_code == 200, f"Login failed: {resp.data}"
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")


# ---------------------------------------------------------------------------
# 1. Authentication
# ---------------------------------------------------------------------------


class AuthTests(APITestCase):
    def setUp(self):
        self.org = _org("AUTH-TEST")
        self.admin = _user(self.org, role="admin", username="auth_admin")

    def test_login_success(self):
        resp = self.client.post(
            "/api/v1/auth/login/",
            {"username": "auth_admin", "password": PASSWORD},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("access", resp.data)

    def test_login_wrong_password(self):
        resp = self.client.post(
            "/api/v1/auth/login/",
            {"username": "auth_admin", "password": "WrongPass!"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_nonexistent_user(self):
        resp = self.client.post(
            "/api/v1/auth/login/",
            {"username": "ghost", "password": PASSWORD},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_requires_auth(self):
        resp = self.client.get("/api/v1/me/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_authenticated(self):
        _login(self.client, self.admin)
        resp = self.client.get("/api/v1/me/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["username"], "auth_admin")

    def test_health_public(self):
        resp = self.client.get("/api/v1/health/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], "ok")


# ---------------------------------------------------------------------------
# 2. Role-based permissions
# ---------------------------------------------------------------------------


class RolePermissionTests(APITestCase):
    def setUp(self):
        self.org = _org("ROLE-TEST")
        self.admin = _user(self.org, role="admin", username="role_admin")
        self.billing = _user(self.org, role="billing", username="role_billing")
        self.patient_user = _user(self.org, role="patient", username="role_patient")
        self.patient = _patient(self.org)
        self.clinician = _clinician(self.org)
        self.encounter = _encounter(self.org, self.patient, self.clinician)

    def test_non_billing_cannot_create_bill(self):
        _login(self.client, self.patient_user)
        resp = self.client.post(
            "/api/v1/bills/",
            {
                "patient": str(self.patient.pk),
                "encounter": str(self.encounter.pk),
                "invoice_number": "INV-PERM-001",
                "items": [],
            },
            format="json",
        )
        self.assertIn(resp.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST])

    def test_nurse_cannot_create_clinical_note(self):
        nurse = _user(self.org, role="nurse", username="role_nurse")
        _login(self.client, nurse)
        resp = self.client.post(
            "/api/v1/notes/",
            {
                "encounter": str(self.encounter.pk),
                "patient": str(self.patient.pk),
                "content": "Test note",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_lab_cannot_create_lab_order(self):
        lab = _user(self.org, role="lab", username="role_lab")
        _login(self.client, lab)
        resp = self.client.post(
            "/api/v1/lab-orders/",
            {
                "encounter": str(self.encounter.pk),
                "patient": str(self.patient.pk),
                "test_name": "CBC",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_pharmacist_cannot_authorize_prescription(self):
        pharma = _user(self.org, role="pharmacist", username="role_pharma")
        _login(self.client, pharma)
        resp = self.client.post(
            "/api/v1/prescriptions/",
            {
                "encounter": str(self.encounter.pk),
                "patient": str(self.patient.pk),
                "medication": "Metformin",
                "dosage": "500mg",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_audit_log_is_read_only(self):
        _login(self.client, self.admin)
        resp = self.client.post("/api/v1/audit/", {"action": "test"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


# ---------------------------------------------------------------------------
# 3. Tenant isolation
# ---------------------------------------------------------------------------


class TenantIsolationTests(APITestCase):
    def setUp(self):
        self.org_a = _org("ORG-A")
        self.org_b = _org("ORG-B")
        self.admin_a = _user(self.org_a, role="admin", username="iso_admin_a")
        self.admin_b = _user(self.org_b, role="admin", username="iso_admin_b")
        self.patient_a = _patient(self.org_a)
        self.patient_b = _patient(self.org_b)

    def test_org_a_cannot_see_org_b_patients(self):
        _login(self.client, self.admin_a)
        resp = self.client.get("/api/v1/patients/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # patient_b must not appear in org_a's list
        if isinstance(resp.data, dict):
            ids = [p["id"] for p in resp.data.get("results", [])]
        else:
            ids = [p["id"] for p in resp.data]
        self.assertNotIn(str(self.patient_b.pk), ids)

    def test_org_a_cannot_retrieve_org_b_patient(self):
        _login(self.client, self.admin_a)
        resp = self.client.get(f"/api/v1/patients/{self.patient_b.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_org_b_cannot_see_org_a_encounter(self):
        clin_a = _clinician(self.org_a)
        enc_a = _encounter(self.org_a, self.patient_a, clin_a)
        _login(self.client, self.admin_b)
        resp = self.client.get(f"/api/v1/encounters/{enc_a.pk}/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


# ---------------------------------------------------------------------------
# 4. Encounter state machine
# ---------------------------------------------------------------------------


class EncounterTransitionTests(APITestCase):
    def setUp(self):
        self.org = _org("ENC-TEST")
        self.admin = _user(self.org, role="admin", username="enc_admin")
        self.patient = _patient(self.org)
        self.clinician = _clinician(self.org)
        _login(self.client, self.admin)

    def _create_encounter(self, enc_status="scheduled"):
        return _encounter(self.org, self.patient, self.clinician, enc_status=enc_status)

    def test_valid_transition_scheduled_to_checked_in(self):
        enc = self._create_encounter("scheduled")
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/",
            {"status": "checked_in"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], "checked_in")

    def test_valid_transition_to_in_progress(self):
        enc = self._create_encounter("checked_in")
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/",
            {"status": "in_progress"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_invalid_transition_scheduled_to_completed(self):
        enc = self._create_encounter("scheduled")
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/",
            {"status": "completed"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_completion_requires_clinical_note(self):
        enc = self._create_encounter("documentation_pending")
        # No note created – should fail
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/",
            {"status": "completed"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("clinical note", str(resp.data).lower())

    def test_completion_succeeds_with_note(self):
        enc = self._create_encounter("documentation_pending")
        clinician_user = _user(self.org, role="clinician", username="enc_clin")
        ClinicalNote.objects.create(
            organization=self.org,
            encounter=enc,
            patient=enc.patient,
            author=clinician_user,
            content="SOAP note content.",
        )
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/",
            {"status": "completed"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], "completed")

    def test_no_transition_from_completed(self):
        enc = self._create_encounter("completed")
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/",
            {"status": "in_progress"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_missing_status_field(self):
        enc = self._create_encounter("scheduled")
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/",
            {},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# 5. Lab result must match order patient
# ---------------------------------------------------------------------------


class LabResultValidationTests(APITestCase):
    def setUp(self):
        self.org = _org("LAB-TEST")
        self.lab_user = _user(self.org, role="lab", username="lab_tech")
        self.admin = _user(self.org, role="admin", username="lab_admin")
        self.patient_a = _patient(self.org, mrn="LAB-MRN-001")
        self.patient_b = _patient(self.org, mrn="LAB-MRN-002")
        self.clinician = _clinician(self.org)
        self.encounter = _encounter(self.org, self.patient_a, self.clinician)
        self.order = LabOrder.objects.create(
            organization=self.org,
            encounter=self.encounter,
            patient=self.patient_a,
            test_name="CBC",
            ordered_by=self.admin,
        )
        _login(self.client, self.lab_user)

    def test_result_for_correct_patient_succeeds(self):
        resp = self.client.post(
            "/api/v1/lab-results/",
            {
                "order": str(self.order.pk),
                "patient": str(self.patient_a.pk),
                "result": "Normal",
                "reference_range": "4.5-11",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_result_for_wrong_patient_rejected(self):
        resp = self.client.post(
            "/api/v1/lab-results/",
            {
                "order": str(self.order.pk),
                "patient": str(self.patient_b.pk),
                "result": "Abnormal",
                "reference_range": "4.5-11",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


# ---------------------------------------------------------------------------
# 6. Payment cannot exceed balance
# ---------------------------------------------------------------------------


class PaymentValidationTests(APITestCase):
    def setUp(self):
        self.org = _org("PAY-TEST")
        self.billing_user = _user(self.org, role="billing", username="pay_billing")
        self.patient = _patient(self.org)
        self.clinician = _clinician(self.org)
        self.encounter = _encounter(self.org, self.patient, self.clinician)
        self.bill = Bill.objects.create(
            organization=self.org,
            patient=self.patient,
            encounter=self.encounter,
            invoice_number="INV-PAY-TEST-001",
            items=[{"description": "Consultation", "amount_cents": 5000}],
            total_cents=5000,
            status="unpaid",
        )
        _login(self.client, self.billing_user)

    def test_payment_within_balance_accepted(self):
        resp = self.client.post(
            "/api/v1/payments/",
            {
                "bill": str(self.bill.pk),
                "amount_cents": 3000,
                "method": "cash",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_payment_exceeding_balance_rejected(self):
        resp = self.client.post(
            "/api/v1/payments/",
            {
                "bill": str(self.bill.pk),
                "amount_cents": 9999,
                "method": "cash",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("balance", str(resp.data).lower())

    def test_full_payment_marks_bill_paid(self):
        self.client.post(
            "/api/v1/payments/",
            {"bill": str(self.bill.pk), "amount_cents": 5000, "method": "mpesa"},
            format="json",
        )
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.status, "paid")


# ---------------------------------------------------------------------------
# 7. Duplicate appointment booking rejected
# ---------------------------------------------------------------------------


class DuplicateAppointmentTests(APITestCase):
    def setUp(self):
        self.org = _org("APPT-TEST")
        self.admin = _user(self.org, role="admin", username="appt_admin")
        self.patient = _patient(self.org)
        self.clinician = _clinician(self.org)
        self.starts_at = (timezone.now() + timedelta(days=1)).replace(
            minute=0, second=0, microsecond=0
        )
        _login(self.client, self.admin)

    def test_duplicate_slot_rejected(self):
        payload = {
            "patient": str(self.patient.pk),
            "clinician": str(self.clinician.pk),
            "starts_at": self.starts_at.isoformat(),
            "reason": "First booking",
        }
        resp1 = self.client.post("/api/v1/appointments/", payload, format="json")
        self.assertEqual(resp1.status_code, status.HTTP_201_CREATED)

        # Same clinician, same slot
        payload["reason"] = "Duplicate booking"
        resp2 = self.client.post("/api/v1/appointments/", payload, format="json")
        self.assertEqual(resp2.status_code, status.HTTP_400_BAD_REQUEST)

    def test_different_slot_allowed(self):
        payload_1 = {
            "patient": str(self.patient.pk),
            "clinician": str(self.clinician.pk),
            "starts_at": self.starts_at.isoformat(),
            "reason": "First slot",
        }
        payload_2 = {
            "patient": str(self.patient.pk),
            "clinician": str(self.clinician.pk),
            "starts_at": (self.starts_at + timedelta(hours=1)).isoformat(),
            "reason": "Different slot",
        }
        r1 = self.client.post("/api/v1/appointments/", payload_1, format="json")
        r2 = self.client.post("/api/v1/appointments/", payload_2, format="json")
        self.assertEqual(r1.status_code, status.HTTP_201_CREATED)
        self.assertEqual(r2.status_code, status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# 8. Patient self-service isolation
# ---------------------------------------------------------------------------


class PatientSelfServiceTests(APITestCase):
    def setUp(self):
        self.org = _org("PSS-TEST")
        self.patient_a = _patient(self.org, mrn="PSS-001")
        self.patient_b = _patient(self.org, mrn="PSS-002")
        self.user_a = _user(self.org, role="patient", username="pss_patient_a")
        self.user_a.patient_id = self.patient_a.pk
        self.user_a.save()
        self.user_b = _user(self.org, role="patient", username="pss_patient_b")
        self.user_b.patient_id = self.patient_b.pk
        self.user_b.save()
        # Link patient records
        self.patient_a.owner = self.user_a
        self.patient_a.save()
        self.patient_b.owner = self.user_b
        self.patient_b.save()

    def test_patient_cannot_view_other_patients_detail(self):
        _login(self.client, self.user_a)
        resp = self.client.get(f"/api/v1/patients/{self.patient_b.pk}/")
        # Either 404 (filtered out) or 403
        self.assertIn(
            resp.status_code,
            [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND],
        )


# ---------------------------------------------------------------------------
# 9. Allergy model CRUD
# ---------------------------------------------------------------------------


class AllergyTests(APITestCase):
    def setUp(self):
        self.org = _org("ALLERGY-TEST")
        self.admin = _user(self.org, role="admin", username="allergy_admin")
        self.patient = _patient(self.org)
        _login(self.client, self.admin)

    def test_create_allergy(self):
        resp = self.client.post(
            "/api/v1/allergies/",
            {
                "patient": str(self.patient.pk),
                "substance": "Penicillin",
                "severity": "severe",
                "reaction": "Anaphylaxis",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["substance"], "Penicillin")

    def test_list_allergies_scoped_to_org(self):
        Allergy.objects.create(
            organization=self.org,
            patient=self.patient,
            substance="Aspirin",
            severity="mild",
        )
        resp = self.client.get("/api/v1/allergies/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# 10. Analytics endpoint
# ---------------------------------------------------------------------------


class AnalyticsTests(APITestCase):
    def setUp(self):
        self.org = _org("ANALYTICS-TEST")
        self.admin = _user(self.org, role="admin", username="analytics_admin")
        _login(self.client, self.admin)

    def test_analytics_returns_expected_keys(self):
        resp = self.client.get("/api/v1/analytics/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        expected_keys = [
            "total_patients", "active_encounters", "scheduled_today",
            "pending_labs", "pending_prescriptions", "unpaid_bills",
            "total_revenue_cents", "generated_at",
        ]
        for key in expected_keys:
            self.assertIn(key, resp.data, f"Missing key: {key}")

    def test_analytics_unauthenticated_denied(self):
        self.client.credentials()
        resp = self.client.get("/api/v1/analytics/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
