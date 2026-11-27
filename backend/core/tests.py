"""
OmniHealthcare – comprehensive test suite.

Run:  python manage.py test core
"""

import uuid
from datetime import date, datetime, time, timedelta
import hashlib
import hmac
import importlib
import json
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from unittest.mock import patch

from django.conf import settings
from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from core.models import (
    Allergy,
    Appointment,
    AuditEvent,
    Bed,
    Bill,
    ClinicalNote,
    Clinician,
    ClinicianAvailability,
    Encounter,
    FollowUp,
    InpatientAdmission,
    InpatientDoctorNote,
    InpatientMedicationAdministration,
    InpatientMedicationPlan,
    InpatientRoomCharge,
    InsuranceClaim,
    LabOrder,
    LabResult,
    LabTest,
    Medication,
    Organization,
    Patient,
    PatientMessage,
    Payment,
    Prescription,
    VirtualSession,
    Vital,
    Ward,
)
from core.services import accrue_room_charges, discharge_admission

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
    cache.clear()
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

    @patch("core.management.commands.bootstrap_admin.getpass", side_effect=["StrongTestPassword!", "StrongTestPassword!"])
    @patch("builtins.input", side_effect=["New Hospital", "NEW-HOSPITAL", "new_admin"])
    def test_bootstrap_creates_organization_and_administrator(self, _input, _getpass):
        call_command("bootstrap_admin")
        user = User.objects.get(username="new_admin")
        self.assertEqual(user.organization.code, "NEW-HOSPITAL")
        self.assertEqual(user.role, "admin")
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.check_password("StrongTestPassword!"))

    @patch("core.management.commands.bootstrap_admin.getpass", side_effect=["FirstPassword!", "DifferentPassword!"])
    @patch("builtins.input", side_effect=["New Hospital", "NEW-HOSPITAL", "new_admin"])
    def test_bootstrap_rejects_mismatched_passwords_without_creating_data(self, _input, _getpass):
        with self.assertRaises(CommandError):
            call_command("bootstrap_admin")
        self.assertFalse(Organization.objects.filter(code="NEW-HOSPITAL").exists())
        self.assertFalse(User.objects.filter(username="new_admin").exists())

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

    def test_patient_cannot_create_diagnosis_or_care_plan(self):
        self.patient_user.patient = self.patient
        self.patient_user.save(update_fields=["patient"])
        _login(self.client, self.patient_user)
        base = {"encounter": self.encounter.pk, "patient": self.patient.pk}
        diagnosis = self.client.post(
            "/api/v1/diagnoses/", {**base, "code": "TEST", "description": "Synthetic"},
            format="json",
        )
        care_plan = self.client.post(
            "/api/v1/care-plans/", {**base, "description": "Synthetic"},
            format="json",
        )
        self.assertEqual(diagnosis.status_code, 403)
        self.assertEqual(care_plan.status_code, 403)

    def test_clinical_records_must_match_encounter_and_assigned_clinician(self):
        clinician_user = self.clinician.user
        self.patient.assigned_clinician = self.clinician
        self.patient.save(update_fields=["assigned_clinician"])
        other_patient = _patient(self.org)
        _login(self.client, clinician_user)
        for endpoint, extra in (
            ("diagnoses", {"code": "TEST", "description": "Synthetic"}),
            ("care-plans", {"description": "Synthetic"}),
        ):
            payload = {"encounter": self.encounter.pk, "patient": other_patient.pk, **extra}
            response = self.client.post(f"/api/v1/{endpoint}/", payload, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            payload["patient"] = self.patient.pk
            response = self.client.post(f"/api/v1/{endpoint}/", payload, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            self.assertTrue(AuditEvent.objects.filter(resource_id=str(response.data["id"])).exists())

    def test_patient_cannot_write_referrals_or_delete_patient_record(self):
        self.patient_user.patient = self.patient
        self.patient_user.save(update_fields=["patient"])
        _login(self.client, self.patient_user)
        referral = self.client.post("/api/v1/referrals/", {
            "patient": self.patient.pk, "encounter": self.encounter.pk,
            "specialty": "Synthetic", "destination": "Synthetic",
        }, format="json")
        self.assertEqual(referral.status_code, 403, referral.data)
        self.assertEqual(self.client.delete(f"/api/v1/patients/{self.patient.pk}/").status_code, 403)

    def test_clinical_record_rejects_cross_tenant_patient(self):
        _login(self.client, self.admin)
        other_patient = _patient(_org("REFERRAL-OTHER"))
        response = self.client.post("/api/v1/referrals/", {
            "patient": other_patient.pk, "specialty": "Synthetic", "destination": "Synthetic",
        }, format="json")
        self.assertEqual(response.status_code, 400, response.data)

    def test_legacy_hospital_virtual_sessions_are_read_only(self):
        visit = VirtualSession.objects.create(
            organization=self.org, patient=self.patient, clinician=self.clinician,
            scheduled_at=timezone.now(),
        )
        _login(self.client, self.admin)
        response = self.client.patch(f"/api/v1/virtual-sessions/{visit.pk}/", {
            "status": "completed",
        }, format="json")
        self.assertEqual(response.status_code, 405, response.data)

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

    def test_prescription_cannot_be_created_as_dispensed(self):
        self.patient.assigned_clinician = self.clinician
        self.patient.save(update_fields=["assigned_clinician"])
        _login(self.client, self.clinician.user)
        payload = {
            "patient": self.patient.pk, "encounter": self.encounter.pk,
            "medication": "Synthetic", "dosage": "As directed", "status": "dispensed",
        }
        response = self.client.post("/api/v1/prescriptions/", payload, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        payload.pop("status")
        response = self.client.post("/api/v1/prescriptions/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], "authorized")
        pharmacist = _user(self.org, role="pharmacist")
        _login(self.client, pharmacist)
        response = self.client.post(f"/api/v1/prescriptions/{response.data['id']}/dispense/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(AuditEvent.objects.filter(action="prescription.dispensed").exists())

    def test_blank_note_cannot_satisfy_completion(self):
        _login(self.client, self.admin)
        response = self.client.post("/api/v1/notes/", {
            "patient": self.patient.pk, "encounter": self.encounter.pk, "content": " ",
        }, format="json")
        self.assertEqual(response.status_code, 400, response.data)

    def test_audit_log_is_read_only(self):
        _login(self.client, self.admin)
        resp = self.client.post("/api/v1/audit/", {"action": "test"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_clinical_note_lists_are_limited_to_requested_encounter(self):
        other = _patient(self.org)
        other_encounter = _encounter(self.org, other, self.clinician)
        note = ClinicalNote.objects.create(
            organization=self.org, patient=self.patient, encounter=self.encounter,
            author=self.admin, content="First encounter",
        )
        ClinicalNote.objects.create(
            organization=self.org, patient=other, encounter=other_encounter,
            author=self.admin, content="Other encounter",
        )
        _login(self.client, self.admin)
        response = self.client.get("/api/v1/notes/", {"encounter": self.encounter.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["id"] for row in response.data["results"]], [note.pk])

    def test_registration_update_cannot_bypass_triage_status(self):
        _login(self.client, self.admin)
        response = self.client.patch(f"/api/v1/patients/{self.patient.pk}/",
                                     {"opd_status": "completed"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.patient.refresh_from_db()
        self.assertEqual(self.patient.opd_status, "registered")

    def test_note_amendment_preserves_original_and_checks_encounter(self):
        _login(self.client, self.admin)
        original = self.client.post("/api/v1/notes/", {
            "patient": self.patient.pk, "encounter": self.encounter.pk, "content": "Original",
        }, format="json")
        self.assertEqual(original.status_code, 201, original.data)
        correction = self.client.post("/api/v1/notes/", {
            "patient": self.patient.pk, "encounter": self.encounter.pk, "content": "Correction",
            "amended_from": original.data["id"],
        }, format="json")
        self.assertEqual(correction.status_code, 201, correction.data)
        self.assertEqual(correction.data["amended_from"], original.data["id"])
        self.assertEqual(ClinicalNote.objects.get(pk=original.data["id"]).content, "Original")
        other_encounter = _encounter(self.org, self.patient, self.clinician)
        wrong = self.client.post("/api/v1/notes/", {
            "patient": self.patient.pk, "encounter": other_encounter.pk, "content": "Wrong",
            "amended_from": original.data["id"],
        }, format="json")
        self.assertEqual(wrong.status_code, 400, wrong.data)

    def test_patient_registration_update_is_audited_without_values(self):
        _login(self.client, self.admin)
        response = self.client.patch(f"/api/v1/patients/{self.patient.pk}/",
                                     {"first_name": "Updated"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        event = AuditEvent.objects.get(action="patient.updated", resource_id=str(self.patient.pk))
        self.assertEqual(event.actor, self.admin)
        self.assertIn("first_name", event.details["fields"])
        self.assertNotIn("Updated", str(event.details))


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

    def test_direct_status_changes_and_skipped_checkin_are_rejected(self):
        enc = self._create_encounter("scheduled")
        for payload in ({"status": "in_progress"}, {"status": "completed"}):
            resp = self.client.patch(f"/api/v1/encounters/{enc.pk}/", payload, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self.client.post(
            f"/api/v1/encounters/{enc.pk}/transition/", {"status": "in_progress"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        enc.refresh_from_db()
        self.assertEqual(enc.status, "scheduled")

    def test_encounter_creation_cannot_set_completed_status(self):
        response = self.client.post("/api/v1/encounters/", {
            "patient": self.patient.pk, "clinician": self.clinician.pk, "status": "completed",
        }, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)

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

    def test_result_review_and_correction_preserve_history(self):
        self.patient_a.assigned_clinician = self.clinician
        self.patient_a.save(update_fields=["assigned_clinician"])
        payload = {
            "order": self.order.pk, "patient": self.patient_a.pk,
            "result": "Original", "status": "final",
        }
        result = self.client.post("/api/v1/lab-results/", payload, format="json")
        self.assertEqual(result.status_code, 201, result.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "resulted")
        denied = self.client.post(f"/api/v1/lab-orders/{self.order.pk}/review/", {}, format="json")
        self.assertEqual(denied.status_code, 403)

        _login(self.client, self.clinician.user)
        reviewed = self.client.post(f"/api/v1/lab-orders/{self.order.pk}/review/", {}, format="json")
        self.assertEqual(reviewed.status_code, 200, reviewed.data)
        self.assertEqual(reviewed.data["status"], "reviewed")

        _login(self.client, self.lab_user)
        amended = self.client.post("/api/v1/lab-results/", {
            **payload, "result": "Corrected", "amended_from": result.data["id"],
        }, format="json")
        self.assertEqual(amended.status_code, 201, amended.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, "resulted")
        self.assertEqual(LabResult.objects.filter(order=self.order).count(), 2)
        self.assertEqual(LabResult.objects.get(pk=result.data["id"]).result, "Original")
        _login(self.client, self.clinician.user)
        encounter = self.client.get(f"/api/v1/encounters/{self.encounter.pk}/")
        self.assertEqual(encounter.status_code, 200, encounter.data)
        self.assertEqual(encounter.data["lab_orders"][0]["result"], "Corrected")
        _login(self.client, self.lab_user)
        stale = self.client.post("/api/v1/lab-results/", {
            **payload, "result": "Stale", "amended_from": result.data["id"],
        }, format="json")
        self.assertEqual(stale.status_code, 400, stale.data)
        self.assertTrue(AuditEvent.objects.filter(action="lab.result_reviewed", resource_id=str(self.order.pk)).exists())


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
        for weekday in range(7):
            ClinicianAvailability.objects.create(
                organization=self.org,
                clinician=self.clinician,
                weekday=weekday,
                starts_at=time(0, 0),
                ends_at=time(23, 59),
            )
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

    def test_booking_retry_with_same_idempotency_key_returns_existing_appointment(self):
        payload = {
            "patient": str(self.patient.pk),
            "clinician": str(self.clinician.pk),
            "starts_at": self.starts_at.isoformat(),
            "reason": "Routine visit",
            "visit_type": "clinic",
        }
        first = self.client.post(
            "/api/v1/appointments/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="booking-retry-001",
        )
        retry = self.client.post(
            "/api/v1/appointments/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="booking-retry-001",
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(retry.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data["id"], retry.data["id"])
        self.assertEqual(Appointment.objects.count(), 1)

    def test_booking_retry_requires_permission_for_same_patient(self):
        payload = {
            "patient": str(self.patient.pk), "clinician": str(self.clinician.pk),
            "starts_at": self.starts_at.isoformat(), "reason": "Routine visit",
        }
        first = self.client.post(
            "/api/v1/appointments/", payload, format="json", HTTP_IDEMPOTENCY_KEY="private-key"
        )
        self.assertEqual(first.status_code, 201, first.data)
        other_user = _user(self.org, role="patient")
        other_user.patient = _patient(self.org)
        other_user.save(update_fields=["patient"])
        _login(self.client, other_user)
        retry = self.client.post(
            "/api/v1/appointments/", payload, format="json", HTTP_IDEMPOTENCY_KEY="private-key"
        )
        self.assertEqual(retry.status_code, 403, retry.data)

    def test_appointment_cannot_be_rescheduled_or_reopened_by_patch(self):
        appointment = _appointment(self.org, self.patient, self.clinician, starts_at=self.starts_at)
        for data in ({"starts_at": (self.starts_at + timedelta(hours=1)).isoformat()},
                     {"status": "completed"}):
            response = self.client.patch(f"/api/v1/appointments/{appointment.pk}/", data, format="json")
            self.assertEqual(response.status_code, 400, response.data)

    def test_booking_rejects_non_half_hour_start_time(self):
        payload = {
            "patient": str(self.patient.pk),
            "clinician": str(self.clinician.pk),
            "starts_at": self.starts_at.replace(minute=15).isoformat(),
            "reason": "Routine visit",
        }

        response = self.client.post("/api/v1/appointments/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("starts_at", response.data)

    def test_patient_can_discover_clinicians_and_book_available_slot(self):
        patient_user = _user(self.org, role="patient")
        patient_user.patient_id = self.patient.pk
        patient_user.save(update_fields=["patient_id"])
        self.patient.owner = patient_user
        self.patient.save(update_fields=["owner"])
        _login(self.client, patient_user)

        clinicians = self.client.get("/api/v1/clinicians/")
        self.assertEqual(clinicians.status_code, status.HTTP_200_OK)
        records = clinicians.data.get("results", clinicians.data)
        self.assertEqual(str(records[0]["id"]), str(self.clinician.pk))

        local_start = timezone.localtime(self.starts_at, ZoneInfo(self.org.time_zone))
        response = self.client.get(
            "/api/v1/appointments/availability-slots/",
            {"clinician": str(self.clinician.pk), "date": local_start.date().isoformat()},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["slots"])
        payload = {
            "patient": str(self.patient.pk),
            "clinician": str(self.clinician.pk),
            "starts_at": response.data["slots"][0]["starts_at"],
            "reason": "Portal appointment",
        }
        booking = self.client.post("/api/v1/appointments/", payload, format="json")
        self.assertEqual(booking.status_code, status.HTTP_201_CREATED, booking.data)
        self.assertEqual(str(booking.data["patient"]), str(self.patient.pk))

    def test_booking_rejects_a_slot_outside_clinician_schedule(self):
        ClinicianAvailability.objects.filter(clinician=self.clinician).delete()
        payload = {
            "patient": str(self.patient.pk),
            "clinician": str(self.clinician.pk),
            "starts_at": self.starts_at.isoformat(),
            "reason": "Outside hours",
        }

        response = self.client.post("/api/v1/appointments/", payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not available", str(response.data).lower())

    def test_clinic_checkin_links_encounter_and_creates_consultation_bill(self):
        appointment = _appointment(
            self.org,
            self.patient,
            self.clinician,
            starts_at=self.starts_at,
        )
        receptionist = _user(self.org, role="receptionist")
        _login(self.client, receptionist)

        response = self.client.post(
            f"/api/v1/appointments/{appointment.pk}/checkin/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        encounter = Encounter.objects.get(appointment=appointment)
        self.assertEqual(response.data["encounter_id"], str(encounter.pk))
        self.assertEqual(encounter.status, Encounter.Status.CHECKED_IN)
        self.assertEqual(Patient.objects.get(pk=self.patient.pk).opd_status, "registered")
        bill = Bill.objects.get(encounter=encounter, care_type=Bill.CareType.OPD)
        self.assertEqual(bill.total_cents, self.clinician.opd_consultation_price)

    def test_virtual_completion_requires_signature_and_creates_follow_up_actions(self):
        LabTest.objects.create(organization=self.org, name="CBC", price_cents=2500)
        appointment = Appointment.objects.create(
            organization=self.org,
            patient=self.patient,
            clinician=self.clinician,
            starts_at=self.starts_at,
            visit_type=Appointment.VisitType.VIRTUAL,
            virtual_session_ref="virtual-session-1",
        )
        _login(self.client, self.clinician.user)
        payload = {
            "virtual_session_id": "virtual-session-1",
            "consent_revision": 1,
            "note": "Clinical assessment completed.",
            "summary": "Patient is stable.",
            "follow_up_plan": "Review in one week.",
            "follow_up_date": "2027-01-15",
            "lab_orders": [{"test_name": "CBC"}],
            "prescriptions": [
                {"medication": "Paracetamol", "dosage": "500 mg", "instructions": "As needed"}
            ],
        }
        signature_payload = {
            "appointment_id": str(appointment.pk),
            "session_id": "virtual-session-1",
            "patient_id": str(self.patient.pk),
            "clinician_id": str(self.clinician.pk),
            "consent_revision": 1,
            "note": payload["note"],
            "summary": payload["summary"],
            "follow_up_plan": payload["follow_up_plan"],
            "follow_up_date": payload["follow_up_date"],
            "lab_orders": payload["lab_orders"],
            "prescriptions": payload["prescriptions"],
        }
        payload["completion_signature"] = hmac.new(
            settings.VIRTUALCARE_SYNC_SECRET.encode("utf-8"),
            json.dumps(signature_payload, sort_keys=True, separators=(",", ":")).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        invalid = {**payload, "completion_signature": "invalid"}
        invalid_response = self.client.post(
            f"/api/v1/appointments/{appointment.pk}/complete-virtual/",
            invalid,
            format="json",
        )
        self.assertEqual(invalid_response.status_code, status.HTTP_403_FORBIDDEN)

        response = self.client.post(
            f"/api/v1/appointments/{appointment.pk}/complete-virtual/",
            payload,
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        encounter = Encounter.objects.get(appointment=appointment)
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, Appointment.Status.COMPLETED)
        self.assertTrue(ClinicalNote.objects.filter(encounter=encounter, note_type="virtual_care").exists())
        self.assertEqual(LabOrder.objects.filter(encounter=encounter).count(), 1)
        self.assertEqual(Prescription.objects.filter(encounter=encounter).count(), 1)
        self.assertEqual(Bill.objects.get(encounter=encounter).care_type, Bill.CareType.OPD)
        self.assertTrue(FollowUp.objects.filter(encounter=encounter).exists())

    def test_appointment_list_includes_patient_name(self):
        appointment = _appointment(
            self.org,
            self.patient,
            self.clinician,
            starts_at=self.starts_at,
        )

        response = self.client.get("/api/v1/appointments/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get("results", response.data)
        record = next(
            (item for item in results if str(item["id"]) == str(appointment.pk)),
            None,
        )
        self.assertIsNotNone(record, response.data)
        self.assertEqual(record["patient_name"], "Test Patient")

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

    def test_public_registration_uses_only_organization_when_code_omitted(self):
        payload = {
            "username": "self_reg", "password": "SelfRegPass12345",
            "first_name": "Self", "last_name": "Reg", "date_of_birth": "1990-01-01",
            "sex": "Female", "phone": "+252611111111",
        }
        resp = self.client.post("/api/v1/register/", payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(User.objects.get(username="self_reg").organization, self.org)
        _org("PSS-SECOND")
        payload["username"] = "self_reg2"
        self.assertEqual(
            self.client.post("/api/v1/register/", payload, format="json").status_code, 400
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

    def test_dashboard_facilities_and_outstanding_balance_are_tenant_scoped(self):
        patient = _patient(self.org)
        clinician = _clinician(self.org)
        ward = Ward.objects.create(organization=self.org, name="Test ward")
        Bed.objects.create(organization=self.org, ward=ward, label="1", status="occupied", patient=patient)
        Bed.objects.create(organization=self.org, ward=ward, label="2", status="available")
        Bed.objects.create(organization=self.org, ward=ward, label="3", status="inactive")
        LabOrder.objects.create(organization=self.org, patient=patient, test_name="Test",
                                ordered_by=self.admin, status=LabOrder.Status.ORDERED)
        LabOrder.objects.create(organization=self.org, patient=patient, test_name="Completed",
                                ordered_by=self.admin, status=LabOrder.Status.REVIEWED)
        LabOrder.objects.create(organization=self.org, patient=patient, test_name="In progress",
                                ordered_by=self.admin, status=LabOrder.Status.IN_PROGRESS)
        LabOrder.objects.create(organization=self.org, patient=patient, test_name="Awaiting review",
                                ordered_by=self.admin, status=LabOrder.Status.RESULTED)
        bill = Bill.objects.create(organization=self.org, patient=patient, invoice_number="ANALYTICS-1",
                                   total_cents=5000, status="partial")
        Payment.objects.create(organization=self.org, bill=bill, amount_cents=1200, recorded_by=self.admin)
        _encounter(self.org, patient, clinician, enc_status="in_progress")
        _appointment(self.org, patient, clinician, starts_at=timezone.now())

        other = _org("ANALYTICS-OTHER")
        other_ward = Ward.objects.create(organization=other, name="Other ward")
        Bed.objects.create(organization=other, ward=other_ward, label="1", status="occupied")

        response = self.client.get("/api/v1/analytics/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["total_patients"], 1)
        self.assertEqual(response.data["scheduled_today"], 1)
        self.assertEqual(response.data["active_encounters"], 1)
        self.assertEqual(response.data["occupied_beds"], 1)
        self.assertEqual(response.data["total_beds"], 2)
        self.assertEqual(response.data["pending_labs"], 1)
        self.assertEqual(response.data["pending_lab_orders"], 3)
        self.assertEqual(response.data["outstanding_bills_cents"], 3800)

    def test_clinician_dashboard_only_contains_own_work(self):
        doctor = _user(self.org, role="clinician")
        clinician = _clinician(self.org, user=doctor)
        other_clinician = _clinician(self.org)
        patient = _patient(self.org)
        patient.assigned_clinician = clinician
        patient.save(update_fields=["assigned_clinician"])
        other_patient = _patient(self.org)
        other_patient.assigned_clinician = other_clinician
        other_patient.save(update_fields=["assigned_clinician"])
        for person, practitioner in ((patient, clinician), (other_patient, other_clinician)):
            _appointment(self.org, person, practitioner, starts_at=timezone.now())
            _encounter(self.org, person, practitioner, enc_status="in_progress")
            LabOrder.objects.create(
                organization=self.org, patient=person, test_name="Test",
                ordered_by=self.admin, status=LabOrder.Status.ORDERED,
            )
        _login(self.client, doctor)
        response = self.client.get("/api/v1/analytics/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {
            "total_patients", "scheduled_today", "active_encounters",
            "pending_lab_orders", "generated_at",
        })
        for key in ("total_patients", "scheduled_today", "active_encounters", "pending_lab_orders"):
            self.assertEqual(response.data[key], 1)
        appointments = self.client.get("/api/v1/appointments/")
        self.assertEqual(appointments.status_code, 200)
        self.assertEqual(appointments.data["count"], 1)
        self.assertEqual(str(appointments.data["results"][0]["patient"]), str(patient.pk))

    def test_dashboard_metric_access_is_limited_by_role(self):
        expected = {
            "receptionist": {"total_patients", "scheduled_today"},
            "nurse": {"awaiting_triage", "occupied_beds", "total_beds"},
            "lab": {"pending_labs"},
            "pharmacist": {"pending_prescriptions"},
            "billing": {"unpaid_bills", "outstanding_bills_cents"},
            "patient": set(),
        }
        for role, keys in expected.items():
            with self.subTest(role=role):
                _login(self.client, _user(self.org, role=role))
                response = self.client.get("/api/v1/analytics/")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(set(response.data), keys | {"generated_at"})

    def test_clinician_without_profile_has_no_dashboard_work(self):
        _login(self.client, _user(self.org, role="clinician"))
        response = self.client.get("/api/v1/analytics/")
        self.assertEqual(response.status_code, 200)
        for key in ("total_patients", "scheduled_today", "active_encounters", "pending_lab_orders"):
            self.assertEqual(response.data[key], 0)

    def test_triage_and_lab_counts_only_include_relevant_work_in_organization(self):
        awaiting = _patient(self.org)
        ready = _patient(self.org)
        ready.opd_status = "vitals_recorded"
        ready.save(update_fields=["opd_status"])
        inpatient = _patient(self.org)
        inpatient.is_opd = False
        inpatient.save(update_fields=["is_opd"])
        LabOrder.objects.create(
            organization=self.org, patient=awaiting, test_name="Ready",
            ordered_by=self.admin, status=LabOrder.Status.ORDERED,
        )
        LabOrder.objects.create(
            organization=self.org, patient=ready, test_name="Awaiting payment",
            ordered_by=self.admin, status=LabOrder.Status.AWAITING_PAYMENT,
        )
        other = _org("ANALYTICS-WORK-OTHER")
        other_patient = _patient(other)
        LabOrder.objects.create(
            organization=other, patient=other_patient, test_name="Other",
            ordered_by=_user(other), status=LabOrder.Status.ORDERED,
        )
        _login(self.client, _user(self.org, role="nurse"))
        self.assertEqual(self.client.get("/api/v1/analytics/").data["awaiting_triage"], 1)
        _login(self.client, _user(self.org, role="lab"))
        self.assertEqual(self.client.get("/api/v1/analytics/").data["pending_labs"], 1)
        _login(self.client, _user(self.org, role="receptionist"))
        self.assertEqual(self.client.get("/api/v1/analytics/").data["total_patients"], 2)

    def test_schedule_today_uses_organization_timezone(self):
        patient = _patient(self.org)
        clinician = _clinician(self.org)
        utc = ZoneInfo("UTC")
        _appointment(self.org, patient, clinician, starts_at=datetime(2026, 1, 1, 22, 30, tzinfo=utc))
        _appointment(self.org, patient, clinician, starts_at=datetime(2026, 1, 2, 22, 30, tzinfo=utc))
        self.client.force_authenticate(user=self.admin)
        with patch("core.views.timezone.now", return_value=datetime(2026, 1, 2, 0, 30, tzinfo=utc)):
            response = self.client.get("/api/v1/analytics/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scheduled_today"], 1)


class OPDWorkflowHandoffTests(APITestCase):
    def setUp(self):
        self.org = _org("OPD-HANDOFF")
        self.clinician_user = _user(self.org, role="clinician", username="opd_doctor")
        self.nurse = _user(self.org, role="nurse", username="opd_nurse")
        self.receptionist = _user(self.org, role="receptionist", username="opd_reception")
        self.billing = _user(self.org, role="billing", username="opd_billing")
        self.lab = _user(self.org, role="lab", username="opd_lab")
        self.pharmacist = _user(self.org, role="pharmacist", username="opd_pharmacy")
        self.patient = _patient(self.org, mrn="OPD-HANDOFF-001")
        self.clinician = _clinician(self.org, user=self.clinician_user)
        self.patient.assigned_clinician = self.clinician
        self.patient.save(update_fields=["assigned_clinician"])
        self.encounter = _encounter(self.org, self.patient, self.clinician)

    def test_receptionist_cannot_record_vitals(self):
        _login(self.client, self.receptionist)
        response = self.client.post(
            "/api/v1/vitals/",
            {"patient": self.patient.pk, "encounter": self.encounter.pk, "heart_rate": 72},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Vital.objects.count(), 0)

    def test_lab_only_sees_investigations_after_payment_and_result_flows_back(self):
        LabTest.objects.create(organization=self.org, name="CBC", price_cents=2500)
        LabTest.objects.create(organization=self.org, name="Glucose", price_cents=1500)
        _login(self.client, self.clinician_user)
        response = self.client.post(
            "/api/v1/lab-orders/batch-order/",
            {
                "patient": self.patient.pk,
                "encounter": self.encounter.pk,
                "investigations": [
                    {"test_name": "CBC", "price_cents": 2500},
                    {"test_name": "Glucose", "price_cents": 1500},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        orders = response.data["orders"]
        self.assertEqual(len(orders), 2)
        self.assertTrue(all(order["status"] == "awaiting_payment" for order in orders))
        bill_id = response.data["bill_id"]

        _login(self.client, self.lab)
        response = self.client.get("/api/v1/lab-orders/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"], [])

        _login(self.client, self.billing)
        response = self.client.post(
            "/api/v1/payments/",
            {"bill": bill_id, "amount_cents": 4000, "method": "simulated"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        _login(self.client, self.lab)
        response = self.client.get("/api/v1/lab-orders/")
        released_orders = response.data["results"]
        self.assertEqual(len(released_orders), 2)
        response = self.client.post(
            "/api/v1/lab-results/",
            {
                "order": released_orders[0]["id"],
                "patient": self.patient.pk,
                "result": "Synthetic result",
                "reference_range": "Synthetic range",
                "status": "final",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        _login(self.client, self.clinician_user)
        response = self.client.get(
            f"/api/v1/lab-results/?patient={self.patient.pk}"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"][0]["result"], "Synthetic result")

    def test_batch_prescriptions_are_visible_to_pharmacist(self):
        _login(self.client, self.clinician_user)
        response = self.client.post(
            "/api/v1/prescriptions/batch-prescribe/",
            {
                "patient": self.patient.pk,
                "encounter": self.encounter.pk,
                "prescriptions": [
                    {"medication": "Demo medicine A", "dosage": "As directed"},
                    {"medication": "Demo medicine B", "dosage": "As directed"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(len(response.data["prescriptions"]), 2)

        _login(self.client, self.pharmacist)
        response = self.client.get("/api/v1/prescriptions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 2)

    def test_clinician_can_only_list_assigned_patients(self):
        unassigned = _patient(self.org, mrn="OPD-HANDOFF-002")
        _login(self.client, self.clinician_user)
        response = self.client.get("/api/v1/patients/?is_opd=true")
        ids = [patient["id"] for patient in response.data["results"]]
        self.assertIn(self.patient.pk, ids)
        self.assertNotIn(unassigned.pk, ids)

    def test_reception_registration_assigns_doctor_and_consultation_price(self):
        self.clinician.opd_consultation_price = 7250
        self.clinician.save(update_fields=["opd_consultation_price", "updated_at"])
        _login(self.client, self.receptionist)
        response = self.client.post(
            "/api/v1/patients/",
            {
                "medical_record_number": "OPD-NEW-001",
                "first_name": "Synthetic",
                "last_name": "Registrant",
                "sex": "Female",
                "age": 31,
                "date_of_birth": "1994-01-01",
                "phone": "+000-000-001",
                "registration_date": "2026-11-24",
                "is_opd": True,
                "assigned_clinician": self.clinician.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        patient = Patient.objects.get(medical_record_number="OPD-NEW-001")
        bill = Bill.objects.get(patient=patient)
        self.assertEqual(patient.assigned_clinician_id, self.clinician.pk)
        self.assertEqual(bill.total_cents, 7250)
        self.assertTrue(Encounter.objects.filter(patient=patient, clinician=self.clinician).exists())
        self.assertTrue(AuditEvent.objects.filter(resource_id=str(patient.pk), action="patient.registered").exists())

    def test_consultation_requires_vitals_from_current_encounter(self):
        prior = Encounter.objects.create(
            organization=self.org,
            patient=self.patient,
            clinician=self.clinician,
            status=Encounter.Status.COMPLETED,
        )
        Vital.objects.create(
            organization=self.org, patient=self.patient, encounter=prior,
            heart_rate=70, recorded_by=self.nurse,
        )
        self.encounter.status = Encounter.Status.CHECKED_IN
        self.encounter.save(update_fields=["status", "updated_at"])
        _login(self.client, self.clinician_user)
        url = f"/api/v1/encounters/{self.encounter.pk}/save-consultation/"
        payload = {"history_of_present_illness": "Synthetic history", "complete": True}
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("vitals", response.data)
        self.assertFalse(ClinicalNote.objects.filter(encounter=self.encounter).exists())

        Vital.objects.create(
            organization=self.org, patient=self.patient, encounter=self.encounter,
            heart_rate=72, recorded_by=self.nurse,
        )
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

    def test_consultation_saves_history_followup_and_completion(self):
        self.encounter.status = Encounter.Status.CHECKED_IN
        self.encounter.save(update_fields=["status", "updated_at"])
        Vital.objects.create(
            organization=self.org,
            patient=self.patient,
            encounter=self.encounter,
            heart_rate=72,
            recorded_by=self.nurse,
        )
        _login(self.client, self.clinician_user)
        response = self.client.post(
            f"/api/v1/encounters/{self.encounter.pk}/save-consultation/",
            {
                "history_of_present_illness": "Synthetic presenting history",
                "past_medical_history": "Synthetic PMH",
                "history_of_surgery": "Synthetic surgical history",
                "follow_up_days": 7,
                "follow_up_message": "Synthetic review",
                "complete": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["status"], Encounter.Status.COMPLETED)
        self.assertTrue(ClinicalNote.objects.filter(encounter=self.encounter, patient=self.patient).exists())
        self.assertTrue(FollowUp.objects.filter(encounter=self.encounter, patient=self.patient).exists())
        self.assertTrue(
            AuditEvent.objects.filter(
                resource_id=str(self.encounter.pk),
                action="encounter.transition",
                details__to=Encounter.Status.COMPLETED,
            ).exists()
        )


class UserAndLabCatalogManagementTests(APITestCase):
    def setUp(self):
        self.org = _org("MANAGEMENT-TEST")
        self.admin = _user(self.org, "admin")
        self.billing = _user(self.org, "billing")
        self.nurse = _user(self.org, "nurse")
        self.reception = _user(self.org, "receptionist")
        self.clinician_user = _user(self.org, "clinician")
        self.clinician = _clinician(self.org, self.clinician_user)

    def test_reception_allergies_are_saved_and_visible_to_clinical_users(self):
        _login(self.client, self.reception)
        response = self.client.post("/api/v1/patients/", {
            "medical_record_number": "ALLERGY-001", "first_name": "Synthetic",
            "last_name": "Patient", "phone": "+254700555111",
            "assigned_clinician": self.clinician.pk, "allergies": "Synthetic allergy",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        patient_id = response.data["id"]
        self.assertNotIn("allergies", response.data)
        self.assertNotIn("allergies", self.client.get(f"/api/v1/patients/{patient_id}/").data)
        _login(self.client, self.clinician_user)
        self.assertEqual(self.client.get(f"/api/v1/patients/{patient_id}/").data["allergies"], "Synthetic allergy")
        patient_user = User.objects.get(patient_id=patient_id)
        patient_user.must_change_password = False
        patient_user.set_password(PASSWORD)
        patient_user.save(update_fields=["must_change_password", "password"])
        _login(self.client, patient_user)
        self.assertEqual(self.client.get(f"/api/v1/patients/{patient_id}/").data["allergies"], "Synthetic allergy")

    def test_admin_manages_users_and_isolation(self):
        _login(self.client, self.admin)
        response = self.client.post(
            "/api/v1/users/",
            {"username": "managed_nurse", "role": "nurse", "password": "SecurePassword123!"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        account_id = response.data["id"]
        response = self.client.patch(
            f"/api/v1/users/{account_id}/", {"first_name": "Updated", "is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["is_active"])
        self.assertEqual(response.data["first_name"], "Updated")
        self.assertEqual(self.client.post(
            "/api/v1/auth/login/", {"username": "managed_nurse", "password": "SecurePassword123!"},
            format="json",
        ).status_code, 401)
        other = _user(_org("OTHER-MANAGEMENT"), "nurse")
        self.assertEqual(self.client.patch(
            f"/api/v1/users/{other.pk}/", {"is_active": False}, format="json"
        ).status_code, 404)
        _login(self.client, self.nurse)
        self.assertEqual(self.client.get("/api/v1/users/").status_code, 403)
        self.assertEqual(self.client.post(
            "/api/v1/users/", {"username": "forbidden", "role": "admin", "password": PASSWORD},
            format="json",
        ).status_code, 403)

    def test_demo_seed_refuses_existing_data_without_changing_users(self):
        old_password = self.admin.password
        with self.assertRaises(CommandError):
            call_command("seed_initial_data", confirm_disposable_database=True, verbosity=0)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.password, old_password)

    def test_self_profile_updates_cannot_change_role_or_other_account_fields(self):
        _login(self.client, self.nurse)
        response = self.client.patch("/api/v1/me/", {
            "first_name": "Updated", "email": "nurse@example.test",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.nurse.refresh_from_db()
        self.assertEqual(self.nurse.first_name, "Updated")
        self.assertTrue(AuditEvent.objects.filter(action="user.profile_updated", actor=self.nurse).exists())
        response = self.client.patch("/api/v1/me/", {"role": "admin"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.nurse.refresh_from_db()
        self.assertEqual(self.nurse.role, "nurse")

    def test_self_password_change_requires_current_password_and_revokes_tokens(self):
        _login(self.client, self.nurse)
        old_token = self.client._credentials["HTTP_AUTHORIZATION"]
        url = "/api/v1/auth/change-password/"
        for current, new in [("wrong", "NewPassword123!"), (PASSWORD, "short"), (PASSWORD, PASSWORD)]:
            response = self.client.post(url, {"current_password": current, "new_password": new}, format="json")
            self.assertEqual(response.status_code, 400, response.data)
            self.nurse.refresh_from_db()
            self.assertTrue(self.nurse.check_password(PASSWORD))
        response = self.client.post(url, {"current_password": PASSWORD, "new_password": "NewPassword123!"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(AuditEvent.objects.filter(action="user.password_changed", actor=self.nurse).exists())
        self.client.credentials(HTTP_AUTHORIZATION=old_token)
        self.assertEqual(self.client.get("/api/v1/me/").status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post(url, {"current_password": PASSWORD, "new_password": "NewPassword123!"}, format="json").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/login/", {
            "username": self.nurse.username, "password": PASSWORD,
        }, format="json").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/login/", {
            "username": self.nurse.username, "password": "NewPassword123!",
        }, format="json").status_code, 200)

    def test_pharmacy_manages_catalog_and_inactive_medications_cannot_be_prescribed(self):
        pharmacist = _user(self.org, "pharmacist")
        patient = _patient(self.org)
        patient.assigned_clinician = self.clinician
        patient.save(update_fields=["assigned_clinician"])
        encounter = _encounter(self.org, patient, self.clinician)
        _login(self.client, pharmacist)
        created = self.client.post("/api/v1/medications/", {
            "name": "Synthetic medication 10mg", "description": "Demo",
        }, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        medication_id = created.data["id"]
        updated = self.client.patch(f"/api/v1/medications/{medication_id}/", {
            "description": "Updated", "active": False,
        }, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        _login(self.client, self.clinician_user)
        self.assertEqual(self.client.get("/api/v1/medications/").data, [])
        prescription = self.client.post("/api/v1/prescriptions/", {
            "patient": patient.pk, "encounter": encounter.pk,
            "medication": "Synthetic medication 10mg", "dosage": "As directed",
        }, format="json")
        self.assertEqual(prescription.status_code, 400, prescription.data)
        self.assertEqual(self.client.post("/api/v1/medications/", {"name": "Denied"}, format="json").status_code, 403)
        _login(self.client, self.admin)
        self.assertEqual(self.client.patch(f"/api/v1/medications/{medication_id}/", {"active": True}, format="json").status_code, 200)
        self.assertTrue(Medication.objects.get(pk=medication_id).active)
        other = Medication.objects.create(organization=_org("OTHER-MEDS"), name="Other")
        self.assertEqual(self.client.patch(f"/api/v1/medications/{other.pk}/", {"active": False}, format="json").status_code, 404)

    def test_password_reset_revokes_existing_hospital_tokens(self):
        _login(self.client, self.nurse)
        old_token = self.client._credentials["HTTP_AUTHORIZATION"]
        _login(self.client, self.admin)
        response = self.client.patch(
            f"/api/v1/users/{self.nurse.pk}/",
            {"password": "ReplacementPassword123!"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.client.credentials(HTTP_AUTHORIZATION=old_token)
        self.assertEqual(self.client.get("/api/v1/me/").status_code, 401)

    def test_patient_registration_requires_password_change_and_blocks_reuse(self):
        _login(self.client, self.reception)
        response = self.client.post(
            "/api/v1/patients/",
            {"medical_record_number": "MANAGEMENT-001", "first_name": "Test", "last_name": "Patient",
             "phone": "+254 700 123456", "assigned_clinician": self.clinician.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(username="+254700123456")
        self.assertEqual(user.patient_id, response.data["id"])
        temporary_password = response.data["temporary_password"]
        self.assertGreaterEqual(len(temporary_password), 20)
        self.assertTrue(user.check_password(temporary_password))
        self.assertFalse(user.check_password("3456"))
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertTrue(user.must_change_password)
        self.client.credentials()
        login = self.client.post("/api/v1/auth/login/", {
            "username": user.username, "password": temporary_password
        }, format="json")
        self.assertEqual(login.status_code, 200, login.data)
        self.assertNotIn("access", login.data)
        token = login.data["password_change_token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
        self.assertEqual(self.client.get("/api/v1/me/").status_code, 401)
        self.client.credentials()
        changed = self.client.post("/api/v1/auth/change-initial-password/", {
            "token": token, "password": "NewPatientPassword123!"
        }, format="json")
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(self.client.post("/api/v1/auth/change-initial-password/", {
            "token": token, "password": "AnotherPassword123!"
        }, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/v1/auth/login/", {
            "username": user.username, "password": "NewPatientPassword123!"
        }, format="json").status_code, 200)

    def test_initial_password_attempts_are_locked(self):
        patient = _patient(self.org)
        user = User.objects.create_user(username="12345678", password="5678", role="patient",
                                        organization=self.org, patient=patient, must_change_password=True)
        for _ in range(5):
            self.client.post("/api/v1/auth/login/", {"username": user.username, "password": "0000"}, format="json")
        response = self.client.post("/api/v1/auth/login/", {"username": user.username, "password": "5678"}, format="json")
        self.assertEqual(response.status_code, 401)
        user.refresh_from_db()
        self.assertIsNotNone(user.login_locked_until)

    def test_migration_invalidates_only_matching_pending_phone_passwords(self):
        patient = _patient(self.org)
        patient.phone = "99998888"
        patient.save(update_fields=["phone"])
        pending = User.objects.create_user(
            username="12345678", password="5678", role="patient",
            organization=self.org, patient=patient, must_change_password=True,
        )
        safe = User.objects.create_user(
            username="safe-patient", password="StrongTemporaryPassword123!",
            role="patient", organization=self.org, patient=patient,
            must_change_password=True,
        )
        completed = User.objects.create_user(
            username="completed-patient", password="8888", role="patient",
            organization=self.org, patient=patient, must_change_password=False,
        )
        migration = importlib.import_module("core.migrations.0014_invalidate_phone_passwords")
        migration.invalidate_phone_passwords(apps, SimpleNamespace(connection=connection))
        pending.refresh_from_db()
        safe.refresh_from_db()
        completed.refresh_from_db()
        self.assertFalse(pending.has_usable_password())
        self.assertTrue(safe.check_password("StrongTemporaryPassword123!"))
        self.assertTrue(completed.check_password("8888"))

    def test_duplicate_phone_does_not_create_patient(self):
        User.objects.create_user(username="+254700123456", password=PASSWORD, role="patient",
                                 organization=self.org)
        _login(self.client, self.reception)
        response = self.client.post("/api/v1/patients/", {
            "medical_record_number": "DUPLICATE-PHONE", "first_name": "Test",
            "last_name": "Patient", "phone": "+254 700 123456",
            "assigned_clinician": self.clinician.pk,
        }, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Patient.objects.filter(medical_record_number="DUPLICATE-PHONE").exists())

    def test_lab_catalog_permissions_updates_and_inactivation(self):
        _login(self.client, self.billing)
        response = self.client.post("/api/v1/lab-tests/", {"name": "Custom test", "price_cents": 4200}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        test_id = response.data["id"]
        response = self.client.patch(f"/api/v1/lab-tests/{test_id}/", {
            "name": "Updated test", "price_cents": 5000, "active": False
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        _login(self.client, self.clinician_user)
        self.assertEqual(self.client.get("/api/v1/lab-tests/").data, [])
        self.assertEqual(self.client.patch(f"/api/v1/lab-tests/{test_id}/", {"active": True}, format="json").status_code, 404)
        _login(self.client, self.admin)
        self.assertEqual(self.client.patch(f"/api/v1/lab-tests/{test_id}/", {"active": True}, format="json").status_code, 200)
        self.assertTrue(LabTest.objects.get(pk=test_id).active)
        _login(self.client, self.nurse)
        self.assertEqual(self.client.get("/api/v1/lab-tests/").status_code, 403)

    def test_catalog_price_and_inactivation_apply_to_orders(self):
        patient = _patient(self.org)
        patient.assigned_clinician = self.clinician
        patient.save(update_fields=["assigned_clinician"])
        encounter = _encounter(self.org, patient, self.clinician)
        test = LabTest.objects.create(organization=self.org, name="Custom test", price_cents=4200)
        _login(self.client, self.clinician_user)
        payload = {
            "patient": patient.pk, "encounter": encounter.pk,
            "investigations": [{"test_name": test.name, "price_cents": 1}],
        }
        response = self.client.post("/api/v1/lab-orders/batch-order/", payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["total_cents"], 4200)
        test.active = False
        test.save(update_fields=["active"])
        response = self.client.post("/api/v1/lab-orders/batch-order/", payload, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        payload["investigations"][0]["test_name"] = "Not in catalog"
        response = self.client.post("/api/v1/lab-orders/batch-order/", payload, format="json")
        self.assertEqual(response.status_code, 400, response.data)


class InpatientWorkflowTestMixin:
    def setUp(self):
        self.org = _org("INPATIENT-TEST")
        self.admin = _user(self.org, role="admin", username="inpatient_admin")
        self.nurse = _user(self.org, role="nurse", username="inpatient_nurse")
        self.billing = _user(self.org, role="billing", username="inpatient_billing")
        self.lab = _user(self.org, role="lab", username="inpatient_lab")
        self.receptionist = _user(
            self.org, role="receptionist", username="inpatient_reception"
        )
        self.doctor_user = _user(
            self.org, role="clinician", username="inpatient_doctor"
        )
        self.doctor = _clinician(self.org, self.doctor_user)
        self.doctor.name = "Dr. Test Clinician"
        self.doctor.department = "Medicine"
        self.doctor.save(update_fields=["name", "department", "updated_at"])
        self.patient = _patient(self.org, mrn="INPATIENT-001")
        self.patient.assigned_clinician = self.doctor
        self.patient.save(update_fields=["assigned_clinician"])
        self.ward = Ward.objects.create(
            organization=self.org, name="General Ward", location="First floor"
        )
        self.bed = Bed.objects.create(
            organization=self.org,
            ward=self.ward,
            label="G-01",
            daily_rate_cents=7500,
        )

    def admit_patient(self):
        _login(self.client, self.nurse)
        response = self.client.post(
            f"/api/v1/beds/{self.bed.pk}/assign/",
            {"patient": str(self.patient.pk), "clinician": str(self.doctor.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return InpatientAdmission.objects.get(patient=self.patient, discharged_at__isnull=True)


class InpatientWorkflowTests(InpatientWorkflowTestMixin, APITestCase):
    def test_admission_list_contains_patient_and_attending_details(self):
        self.admit_patient()

        response = self.client.get("/api/v1/inpatient-admissions/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        item = response.data["results"][0]
        self.assertEqual(item["patient_mrn"], "INPATIENT-001")
        self.assertEqual(item["patient_name"], "Test Patient")
        self.assertEqual(item["doctor_name"], "Dr. Test Clinician")
        self.assertEqual(item["department"], "General Ward")
        self.assertEqual(item["bed_label"], "G-01")
        self.assertEqual(item["room_rate_cents"], 7500)

    def test_patient_cannot_be_admitted_twice_or_across_organizations(self):
        self.admit_patient()
        second_bed = Bed.objects.create(
            organization=self.org, ward=self.ward, label="G-02"
        )
        response = self.client.post(
            f"/api/v1/beds/{second_bed.pk}/assign/",
            {"patient": str(self.patient.pk), "clinician": str(self.doctor.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(InpatientAdmission.objects.filter(patient=self.patient).count(), 1)

        other_org = _org("INPATIENT-OTHER")
        foreign_patient = _patient(other_org)
        response = self.client.post(
            f"/api/v1/beds/{second_bed.pk}/assign/",
            {"patient": str(foreign_patient.pk), "clinician": str(self.doctor.pk)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class InsuranceClaimWorkflowTests(APITestCase):
    def setUp(self):
        self.org = _org("CLAIM-TEST")
        self.billing = _user(self.org, role="billing")
        self.patient = _patient(self.org)
        self.bill = Bill.objects.create(
            organization=self.org,
            patient=self.patient,
            invoice_number="INV-CLAIM-001",
            items=[{"description": "Consultation", "amount_cents": 5000}],
            total_cents=5000,
        )
        _login(self.client, self.billing)

    def test_claim_lifecycle_is_separate_from_payment(self):
        created = self.client.post(
            "/api/v1/insurance-claims/",
            {
                "bill": str(self.bill.pk),
                "payer_name": "Example Cover",
                "member_reference": "SYNTH-100",
                "requested_cents": 4500,
            },
            format="json",
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual(created.data["status"], InsuranceClaim.Status.DRAFT)

        submitted = self.client.post(
            f"/api/v1/insurance-claims/{created.data['id']}/submit/",
            {},
            format="json",
        )
        self.assertEqual(submitted.status_code, status.HTTP_200_OK, submitted.data)
        self.assertEqual(submitted.data["status"], InsuranceClaim.Status.SUBMITTED)

        decided = self.client.post(
            f"/api/v1/insurance-claims/{created.data['id']}/adjudicate/",
            {
                "status": InsuranceClaim.Status.PARTIALLY_APPROVED,
                "approved_cents": 3000,
                "notes": "Synthetic partial approval",
            },
            format="json",
        )
        self.assertEqual(decided.status_code, status.HTTP_200_OK, decided.data)
        self.assertEqual(decided.data["approved_cents"], 3000)
        self.assertEqual(Payment.objects.filter(bill=self.bill).count(), 0)

    def test_claim_amount_cannot_exceed_invoice_total(self):
        response = self.client.post(
            "/api/v1/insurance-claims/",
            {
                "bill": str(self.bill.pk),
                "payer_name": "Example Cover",
                "member_reference": "SYNTH-101",
                "requested_cents": 5001,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PatientPortalWorkflowTests(APITestCase):
    def setUp(self):
        self.org = _org("PORTAL-TEST")
        self.clinician_user = _user(self.org, role="clinician")
        self.clinician = _clinician(self.org, self.clinician_user)
        self.patient = _patient(self.org, "PORTAL-001")
        self.patient.assigned_clinician = self.clinician
        self.patient_user = _user(self.org, role="patient")
        self.patient_user.patient_id = self.patient.pk
        self.patient_user.save(update_fields=["patient_id"])
        self.patient.owner = self.patient_user
        self.patient.save(update_fields=["owner", "assigned_clinician"])

    def test_booking_cors_preflight_allows_idempotency_key(self):
        response = self.client.options(
            "/api/v1/appointments/",
            HTTP_ORIGIN="http://localhost:5173",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type,idempotency-key",
        )
        self.assertIn("idempotency-key", response["Access-Control-Allow-Headers"])

    def test_patient_can_message_assigned_clinician(self):
        _login(self.client, self.patient_user)
        sent = self.client.post(
            "/api/v1/patient-messages/",
            {"patient": str(self.patient.pk), "body": "Please review my follow-up."},
            format="json",
        )
        self.assertEqual(sent.status_code, status.HTTP_201_CREATED, sent.data)
        self.assertEqual(sent.data["recipient"], self.clinician_user.pk)

        _login(self.client, self.clinician_user)
        inbox = self.client.get("/api/v1/patient-messages/")
        self.assertEqual(inbox.status_code, status.HTTP_200_OK)
        self.assertEqual(len(inbox.data["results"]), 1)
        self.assertEqual(inbox.data["results"][0]["patient_name"], f"{self.patient.first_name} {self.patient.last_name}")
        read = self.client.post(f"/api/v1/patient-messages/{sent.data['id']}/mark-read/", {}, format="json")
        self.assertEqual(read.status_code, 200, read.data)
        self.assertIsNotNone(read.data["read_at"])
        reply = self.client.post("/api/v1/patient-messages/", {
            "patient": self.patient.pk, "body": "Synthetic response",
        }, format="json")
        self.assertEqual(reply.status_code, 201, reply.data)
        _login(self.client, self.patient_user)
        inbox = self.client.get("/api/v1/patient-messages/")
        self.assertEqual([item["body"] for item in inbox.data["results"]], [
            "Please review my follow-up.", "Synthetic response",
        ])

    def test_proxy_grant_is_scoped_revocable_and_read_only(self):
        recipient_patient = _patient(self.org, "PORTAL-002")
        recipient = _user(self.org, role="patient")
        recipient.patient_id = recipient_patient.pk
        recipient.save(update_fields=["patient_id"])
        recipient_patient.owner = recipient
        recipient_patient.save(update_fields=["owner"])

        _login(self.client, self.patient_user)
        grant = self.client.post(
            "/api/v1/proxy-grants/",
            {"grantee_username": recipient.username, "scope": "records"},
            format="json",
        )
        self.assertEqual(grant.status_code, status.HTTP_201_CREATED, grant.data)

        _login(self.client, recipient)
        visible = self.client.get(f"/api/v1/patients/{self.patient.pk}/")
        self.assertEqual(visible.status_code, status.HTTP_200_OK)
        blocked_write = self.client.patch(
            f"/api/v1/patients/{self.patient.pk}/",
            {"phone": "changed"},
            format="json",
        )
        self.assertEqual(blocked_write.status_code, status.HTTP_403_FORBIDDEN)

        _login(self.client, self.patient_user)
        revoked = self.client.patch(
            f"/api/v1/proxy-grants/{grant.data['id']}/",
            {"active": False},
            format="json",
        )
        self.assertEqual(revoked.status_code, status.HTTP_200_OK, revoked.data)

        _login(self.client, recipient)
        hidden = self.client.get(f"/api/v1/patients/{self.patient.pk}/")
        self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)

    def test_proxy_cannot_link_virtual_session_to_shared_appointment(self):
        recipient = _user(self.org, role="patient")
        recipient.patient = _patient(self.org, "PORTAL-PROXY")
        recipient.save(update_fields=["patient"])
        appointment = _appointment(self.org, self.patient, self.clinician)
        appointment.visit_type = "virtual"
        appointment.save(update_fields=["visit_type"])
        _login(self.client, self.patient_user)
        grant = self.client.post("/api/v1/proxy-grants/", {
            "grantee_username": recipient.username, "scope": "appointments",
        }, format="json")
        self.assertEqual(grant.status_code, 201, grant.data)
        _login(self.client, recipient)
        self.assertEqual(self.client.get(f"/api/v1/appointments/{appointment.pk}/").status_code, 200)
        response = self.client.post(f"/api/v1/appointments/{appointment.pk}/link-virtual-session/",
                                    {"virtual_session_ref": "not-owned"}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        appointment.refresh_from_db()
        self.assertEqual(appointment.virtual_session_ref, "")


class ExtendedInpatientWorkflowTests(InpatientWorkflowTestMixin, APITestCase):

    def test_only_admin_can_inactivate_and_reactivate_unoccupied_beds(self):
        url = f"/api/v1/beds/{self.bed.pk}/set-active/"
        _login(self.client, self.nurse)
        self.assertEqual(self.client.post(url, {"active": False}, format="json").status_code, 403)
        _login(self.client, self.admin)
        response = self.client.post(url, {"active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "inactive")
        self.assertEqual(
            self.client.post(
                f"/api/v1/beds/{self.bed.pk}/assign/",
                {"patient": str(self.patient.pk), "clinician": str(self.doctor.pk)},
                format="json",
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(f"/api/v1/beds/{self.bed.pk}/assign/", {}, format="json").status_code,
            400,
        )
        self.assertEqual(self.client.post(url, {"active": "false"}, format="json").status_code, 400)
        response = self.client.post(url, {"active": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "available")
        self.admit_patient()

    def test_occupied_bed_cannot_be_inactivated(self):
        self.admit_patient()
        _login(self.client, self.admin)
        response = self.client.post(
            f"/api/v1/beds/{self.bed.pk}/set-active/", {"active": False}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.status, "occupied")

    def test_only_admin_can_change_room_rate(self):
        admission = InpatientAdmission.objects.create(
            organization=self.org,
            patient=self.patient,
            bed=self.bed,
            clinician=self.doctor,
        )
        _login(self.client, self.nurse)
        response = self.client.patch(
            f"/api/v1/beds/{self.bed.pk}/",
            {"daily_rate_cents": 9900},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _login(self.client, self.admin)
        response = self.client.patch(
            f"/api/v1/beds/{self.bed.pk}/",
            {"daily_rate_cents": 9900},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["daily_rate_cents"], 9900)
        admission.refresh_from_db()
        self.assertEqual(admission.room_rate_cents, 9900)
        self.assertGreaterEqual(admission.room_rate_started_at, admission.created_at)

    def test_room_charges_are_added_once_per_completed_24_hours(self):
        admitted_at = timezone.now() - timedelta(hours=23)
        admission = InpatientAdmission.objects.create(
            organization=self.org,
            patient=self.patient,
            bed=self.bed,
            clinician=self.doctor,
            department=self.doctor.department,
            admitted_at=admitted_at,
            room_rate_started_at=admitted_at,
            room_rate_cents=7500,
        )
        self.bed.patient = self.patient
        self.bed.status = "occupied"
        self.bed.save(update_fields=["patient", "status", "updated_at"])

        self.assertEqual(accrue_room_charges(admission, now=admitted_at + timedelta(hours=23)), [])
        first_due = admitted_at + timedelta(days=1)
        self.assertEqual(len(accrue_room_charges(admission, now=first_due)), 1)
        self.assertEqual(accrue_room_charges(admission, now=first_due), [])
        self.assertEqual(InpatientRoomCharge.objects.filter(admission=admission).count(), 1)

        second_due = admitted_at + timedelta(days=2)
        discharge_admission(admission, self.nurse, discharged_at=second_due)
        self.assertEqual(InpatientRoomCharge.objects.filter(admission=admission).count(), 2)
        self.assertEqual(Bill.objects.filter(patient=self.patient).count(), 2)
        self.assertEqual(
            set(Bill.objects.filter(patient=self.patient).values_list("care_type", flat=True)),
            {Bill.CareType.IPD},
        )
        self.bed.refresh_from_db()
        self.assertIsNone(self.bed.patient_id)
        self.assertEqual(self.bed.status, "available")

    def test_billing_list_catches_up_due_room_charges_idempotently(self):
        admission = InpatientAdmission.objects.create(
            organization=self.org,
            patient=self.patient,
            bed=self.bed,
            clinician=self.doctor,
            admitted_at=timezone.now() - timedelta(hours=25),
            room_rate_started_at=timezone.now() - timedelta(hours=25),
            room_rate_cents=7500,
        )

        _login(self.client, self.billing)
        first = self.client.get("/api/v1/bills/")
        second = self.client.get("/api/v1/bills/")

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(InpatientRoomCharge.objects.filter(admission=admission).count(), 1)
        self.assertEqual(Bill.objects.filter(patient=self.patient).count(), 1)

    def test_inpatient_roles_can_only_write_their_records(self):
        admission = self.admit_patient()
        _login(self.client, self.receptionist)
        response = self.client.get("/api/v1/inpatient-admissions/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        _login(self.client, self.doctor_user)
        response = self.client.post(
            "/api/v1/inpatient-medication-plans/",
            {
                "admission": str(admission.pk),
                "medication": "Medication A",
                "dosage": "500 mg",
                "frequency": "Every 8 hours",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        plan = InpatientMedicationPlan.objects.get(admission=admission)

        response = self.client.post(
            "/api/v1/inpatient-doctor-notes/",
            {"admission": str(admission.pk), "content": "Patient is stable."},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(InpatientDoctorNote.objects.filter(admission=admission).exists())

        _login(self.client, self.nurse)
        response = self.client.post(
            "/api/v1/inpatient-medication-administrations/",
            {
                "admission": str(admission.pk),
                "plan": str(plan.pk),
                "medication": plan.medication,
                "dosage": plan.dosage,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertTrue(
            InpatientMedicationAdministration.objects.filter(admission=admission).exists()
        )

    def test_doctor_can_add_multiple_inpatient_plans_atomically(self):
        admission = self.admit_patient()
        _login(self.client, self.doctor_user)
        response = self.client.post(
            "/api/v1/inpatient-medication-plans/batch-create/",
            {
                "admission": str(admission.pk),
                "plans": [
                    {"medication": "Medication A", "dosage": "10 mg", "frequency": "Daily"},
                    {"medication": "Medication B", "dosage": "20 mg", "frequency": "Twice daily"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(len(response.data["plans"]), 2)
        self.assertEqual(
            InpatientMedicationPlan.objects.filter(admission=admission).count(), 2
        )

        response = self.client.post(
            "/api/v1/inpatient-medication-plans/batch-create/",
            {
                "admission": str(admission.pk),
                "plans": [
                    {"medication": "Medication C", "dosage": "5 mg"},
                    {"medication": "", "dosage": ""},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            InpatientMedicationPlan.objects.filter(admission=admission).count(), 2
        )

    def test_inpatient_lab_orders_are_ipd_billed_and_visible_after_payment(self):
        LabTest.objects.create(organization=self.org, name="IPD CBC", price_cents=2500)
        LabTest.objects.create(organization=self.org, name="IPD Chemistry", price_cents=1800)
        admission = self.admit_patient()
        _login(self.client, self.doctor_user)
        response = self.client.post(
            "/api/v1/lab-orders/batch-order/",
            {
                "patient": str(self.patient.pk),
                "admission": str(admission.pk),
                "investigations": [
                    {"test_name": "IPD CBC", "price_cents": 2500},
                    {"test_name": "IPD Chemistry", "price_cents": 1800},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(len(response.data["orders"]), 2)
        self.assertTrue(all(order["care_type"] == "ipd" for order in response.data["orders"]))
        bill = Bill.objects.get(pk=response.data["bill_id"])
        self.assertEqual(bill.care_type, Bill.CareType.IPD)

        _login(self.client, self.lab)
        response = self.client.get("/api/v1/lab-orders/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"], [])

        _login(self.client, self.billing)
        response = self.client.post(
            "/api/v1/payments/",
            {"bill": bill.pk, "amount_cents": bill.total_cents, "method": "cash"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        _login(self.client, self.lab)
        response = self.client.get("/api/v1/lab-orders/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        released_order = response.data["results"][0]
        self.assertEqual(released_order["care_type"], "ipd")
        response = self.client.post(
            "/api/v1/lab-results/",
            {
                "order": released_order["id"],
                "patient": str(self.patient.pk),
                "result": "IPD result",
                "status": "final",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)

        _login(self.client, self.doctor_user)
        response = self.client.get(
            f"/api/v1/lab-results/?patient={self.patient.pk}"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"][0]["care_type"], "ipd")
        self.assertEqual(response.data["results"][0]["result"], "IPD result")

    def test_doctor_can_update_admission_and_admin_can_manage_wards_and_beds(self):
        admission = self.admit_patient()
        _login(self.client, self.doctor_user)
        response = self.client.patch(
            f"/api/v1/inpatient-admissions/{admission.pk}/",
            {"diagnosis": "Updated inpatient diagnosis"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)

        _login(self.client, self.nurse)
        response = self.client.get("/api/v1/inpatient-admissions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        _login(self.client, self.admin)
        ward_response = self.client.post(
            "/api/v1/wards/",
            {"name": "New ICU", "location": "East wing"},
            format="json",
        )
        self.assertEqual(ward_response.status_code, status.HTTP_201_CREATED, ward_response.data)
        new_ward = ward_response.data["id"]
        bed_response = self.client.post(
            "/api/v1/beds/",
            {"ward": new_ward, "label": "ICU-01", "daily_rate_cents": 12000},
            format="json",
        )
        self.assertEqual(bed_response.status_code, status.HTTP_201_CREATED, bed_response.data)
        self.assertEqual(
            self.client.delete(f"/api/v1/beds/{bed_response.data['id']}/").status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertEqual(
            self.client.delete(f"/api/v1/wards/{new_ward}/").status_code,
            status.HTTP_204_NO_CONTENT,
        )

        response = self.client.post(
            "/api/v1/inpatient-medication-administrations/",
            {
                "admission": str(admission.pk),
                "medication": "Medication A",
                "dosage": "500 mg",
                "administered_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class FhirAndThrottleTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.org = _org("ORG-FHIR")
        self.other_org = _org("ORG-FHIR-OTHER")
        self.clinician_user = _user(self.org, "clinician")
        self.clinician = _clinician(self.org, self.clinician_user)
        self.patient = _patient(self.org)
        self.patient.assigned_clinician = self.clinician
        self.patient.save(update_fields=["assigned_clinician", "updated_at"])
        self.other_patient = _patient(self.other_org)
        self.encounter = _encounter(self.org, self.patient, self.clinician, enc_status="checked_in")
        self.vital = Vital.objects.create(
            organization=self.org, patient=self.patient, encounter=self.encounter,
            heart_rate=72, systolic=118, diastolic=76, recorded_by=self.clinician_user,
        )

    def test_fhir_resources_are_read_only_and_tenant_scoped(self):
        _login(self.client, self.clinician_user)
        response = self.client.get("/api/v1/fhir/Patient/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["resourceType"], "Bundle")
        ids = [entry["resource"]["id"] for entry in response.data["entry"]]
        self.assertEqual(ids, [str(self.patient.pk)])
        self.assertEqual(
            self.client.get(f"/api/v1/fhir/Patient/{self.other_patient.pk}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.post("/api/v1/fhir/Patient/", {}, format="json").status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def test_fhir_observation_and_encounter_shapes(self):
        _login(self.client, self.clinician_user)
        observation = self.client.get(f"/api/v1/fhir/Observation/{self.vital.pk}/").data
        self.assertEqual(observation["resourceType"], "Observation")
        self.assertEqual(observation["subject"], {"reference": f"Patient/{self.patient.pk}"})
        codes = {c["code"]["coding"][0]["code"] for c in observation["component"]}
        self.assertEqual(codes, {"8867-4", "8480-6", "8462-4"})
        encounter = self.client.get(f"/api/v1/fhir/Encounter/{self.encounter.pk}/").data
        self.assertEqual(encounter["status"], "arrived")

    def test_fhir_requires_authentication(self):
        self.assertEqual(self.client.get("/api/v1/fhir/Patient/").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_attempts_are_rate_limited(self):
        statuses = [
            self.client.post(
                "/api/v1/auth/login/", {"username": "nobody", "password": "wrong"}, format="json"
            ).status_code
            for _ in range(25)
        ]
        self.assertIn(status.HTTP_429_TOO_MANY_REQUESTS, statuses)
        cache.clear()
