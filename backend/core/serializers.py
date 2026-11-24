from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    Allergy,
    Appointment,
    AuditEvent,
    Bed,
    Bill,
    CarePlan,
    ClinicalNote,
    Clinician,
    Consent,
    Diagnosis,
    DischargeNote,
    Encounter,
    FollowUp,
    LabOrder,
    LabResult,
    MedicalHistory,
    Patient,
    Payment,
    Prescription,
    ProxyGrant,
    Referral,
    VirtualSession,
    Vital,
    Ward,
)

User = get_user_model()


# ── Base helpers ──────────────────────────────────────────────────────────────


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "email",
            "role",
            "organization",
            "patient_id",
        ]
        read_only_fields = fields


class TenantSerializer(serializers.ModelSerializer):
    """Base serializer that auto-injects organization from request context."""

    def validate(self, attrs):
        request = self.context.get("request")
        if request and hasattr(request, "user") and request.user.is_authenticated:
            attrs["organization"] = request.user.organization
        return attrs


# ── Core models ───────────────────────────────────────────────────────────────


class PatientSerializer(TenantSerializer):
    class Meta:
        model = Patient
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class ClinicianSerializer(TenantSerializer):
    user_detail = UserSerializer(source="user", read_only=True)

    class Meta:
        model = Clinician
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class AppointmentSerializer(TenantSerializer):
    class Meta:
        model = Appointment
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class EncounterSerializer(TenantSerializer):
    class Meta:
        model = Encounter
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class VitalSerializer(TenantSerializer):
    class Meta:
        model = Vital
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "recorded_by"]


class ClinicalNoteSerializer(TenantSerializer):
    class Meta:
        model = ClinicalNote
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "author"]


class DiagnosisSerializer(TenantSerializer):
    class Meta:
        model = Diagnosis
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class CarePlanSerializer(TenantSerializer):
    class Meta:
        model = CarePlan
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "approved_by"]


class LabOrderSerializer(TenantSerializer):
    class Meta:
        model = LabOrder
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "ordered_by"]


class LabResultSerializer(TenantSerializer):
    class Meta:
        model = LabResult
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "entered_by"]


class PrescriptionSerializer(TenantSerializer):
    class Meta:
        model = Prescription
        fields = "__all__"
        read_only_fields = [
            "organization",
            "created_at",
            "updated_at",
            "authorized_by",
            "dispensed_at",
        ]


class ReferralSerializer(TenantSerializer):
    class Meta:
        model = Referral
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class WardSerializer(TenantSerializer):
    class Meta:
        model = Ward
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class BedSerializer(TenantSerializer):
    class Meta:
        model = Bed
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class BillSerializer(TenantSerializer):
    class Meta:
        model = Bill
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "total_cents"]


class PaymentSerializer(TenantSerializer):
    class Meta:
        model = Payment
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "recorded_by"]


class FollowUpSerializer(TenantSerializer):
    class Meta:
        model = FollowUp
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class AuditEventSerializer(TenantSerializer):
    class Meta:
        model = AuditEvent
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "actor"]


class ConsentSerializer(TenantSerializer):
    class Meta:
        model = Consent
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class VirtualSessionSerializer(TenantSerializer):
    class Meta:
        model = VirtualSession
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


# ── New Phase-2 model serializers ─────────────────────────────────────────────


class AllergySerializer(TenantSerializer):
    class Meta:
        model = Allergy
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class DischargeNoteSerializer(TenantSerializer):
    class Meta:
        model = DischargeNote
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "author"]


class ProxyGrantSerializer(TenantSerializer):
    class Meta:
        model = ProxyGrant
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


class MedicalHistorySerializer(TenantSerializer):
    class Meta:
        model = MedicalHistory
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]


# ── Special-purpose serializers ───────────────────────────────────────────────


class PatientRegistrationSerializer(serializers.Serializer):
    """
    Used by the public /api/v1/register/ endpoint.
    Creates a Patient record and a linked User with role='patient'.
    """

    # Patient fields
    first_name = serializers.CharField(max_length=100)
    last_name = serializers.CharField(max_length=100)
    date_of_birth = serializers.DateField()
    sex = serializers.CharField(max_length=20, required=False, default="")
    phone = serializers.CharField(max_length=30, required=False, default="")
    email = serializers.EmailField(required=False, default="")

    # Account fields
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("A user with that username already exists.")
        return value
