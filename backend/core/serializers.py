import secrets
import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core import signing
from django.db import transaction
from django.utils.crypto import salted_hmac
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.utils import timezone

from .models import (
    Allergy,
    Appointment,
    AuditEvent,
    Bed,
    Bill,
    CarePlan,
    ClinicalNote,
    ClinicianAvailability,
    Clinician,
    Consent,
    Diagnosis,
    DischargeNote,
    Encounter,
    FollowUp,
    ImagingOrder,
    ImagingResult,
    ImagingTest,
    InpatientAdmission,
    InpatientDoctorNote,
    InpatientMedicationAdministration,
    InpatientMedicationPlan,
    InsuranceClaim,
    LabOrder,
    LabResult,
    LabTest,
    Medication,
    MedicalHistory,
    Patient,
    PatientMessage,
    Payment,
    Prescription,
    ProxyGrant,
    Referral,
    VirtualSession,
    Vital,
    Ward,
)

User = get_user_model()


class OmniTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        error = None
        result = None
        with transaction.atomic():
            pending_user = User.objects.select_for_update().filter(
                username=attrs.get("username"), must_change_password=True
            ).first()
            now = timezone.now()
            if pending_user and pending_user.login_locked_until and pending_user.login_locked_until > now:
                error = AuthenticationFailed("Account temporarily locked. Try again later.")
            else:
                try:
                    result = super().validate(attrs)
                except AuthenticationFailed as exc:
                    error = exc
                    if pending_user:
                        if pending_user.login_locked_until and pending_user.login_locked_until <= now:
                            pending_user.failed_login_attempts = 0
                        pending_user.failed_login_attempts += 1
                        if pending_user.failed_login_attempts >= 5:
                            pending_user.login_locked_until = now + timedelta(minutes=15)
                        pending_user.save(update_fields=["failed_login_attempts", "login_locked_until"])
                else:
                    if pending_user:
                        pending_user.failed_login_attempts = 0
                        pending_user.login_locked_until = None
                        pending_user.save(update_fields=["failed_login_attempts", "login_locked_until"])
                        result = {"password_change_token": signing.dumps(
                            {"user_id": pending_user.pk,
                             "password_version": password_version(pending_user)},
                            salt="core.password-change",
                        )}
        if error:
            raise error
        return result

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        clinician_id = Clinician.objects.filter(
            user=user, organization=user.organization
        ).values_list("pk", flat=True).first()
        token["role"] = user.role
        token["organization_id"] = str(user.organization_id or "")
        token["patient_id"] = str(user.patient_id or "")
        token["clinician_id"] = str(clinician_id or "")
        return token


def password_version(user):
    return salted_hmac("core.password-change", user.password).hexdigest()


# ── Base helpers ──────────────────────────────────────────────────────────────


class UserSerializer(serializers.ModelSerializer):
    clinician_id = serializers.SerializerMethodField()

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
            "clinician_id",
        ]
        read_only_fields = fields

    def get_clinician_id(self, obj):
        return Clinician.objects.filter(
            user=obj, organization=obj.organization
        ).values_list("pk", flat=True).first()


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["first_name", "last_name", "email"]


class ManagedUserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "email", "role",
                  "patient", "is_active", "password"]
        read_only_fields = ["id"]

    def validate_password(self, value):
        try:
            validate_password(value, self.instance)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
        return value

    def validate(self, attrs):
        request = self.context["request"]
        role = attrs.get("role", self.instance.role if self.instance else None)
        patient = attrs.get("patient", self.instance.patient if self.instance else None)
        if self.instance and role != self.instance.role:
            raise serializers.ValidationError({"role": "The role of an existing account cannot be changed."})
        if not self.instance and not attrs.get("password"):
            raise serializers.ValidationError({"password": "A password is required."})
        if role == User.Role.PATIENT:
            if not patient or patient.organization_id != request.user.organization_id:
                raise serializers.ValidationError({"patient": "Select a patient in your organization."})
            accounts = User.objects.filter(patient=patient)
            if self.instance:
                accounts = accounts.exclude(pk=self.instance.pk)
            if accounts.exists() or (patient.owner_id and (not self.instance or patient.owner_id != self.instance.pk)):
                raise serializers.ValidationError({"patient": "This patient already has an account."})
        elif patient:
            raise serializers.ValidationError({"patient": "Only patient accounts may be linked to a patient."})
        if self.instance and "patient" in attrs and patient != self.instance.patient:
            raise serializers.ValidationError({"patient": "An existing account cannot be moved to another patient."})
        if self.instance and self.instance.pk == request.user.pk and attrs.get("is_active") is False:
            raise serializers.ValidationError({"is_active": "You cannot inactivate your own account."})
        if self.instance and self.instance.is_superuser and self.instance.pk != request.user.pk:
            raise serializers.ValidationError("Superuser accounts cannot be changed here.")
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        if user.role == User.Role.PATIENT:
            user.must_change_password = True
        user.set_password(password)
        user.save()
        if user.patient:
            user.patient.owner = user
            user.patient.save(update_fields=["owner", "updated_at"])
        if user.role == User.Role.CLINICIAN:
            Clinician.objects.create(
                user=user, organization=user.organization,
                name=user.get_full_name() or user.username, specialty="General",
            )
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.failed_login_attempts = 0
            user.login_locked_until = None
            if user.role == User.Role.PATIENT:
                user.must_change_password = True
            user.save(update_fields=["password", "failed_login_attempts", "login_locked_until", "must_change_password"])
        return user


class TenantSerializer(serializers.ModelSerializer):
    """Base serializer that auto-injects organization from request context."""

    def validate(self, attrs):
        request = self.context.get("request")
        if request and hasattr(request, "user") and request.user.is_authenticated:
            for field, value in attrs.items():
                if hasattr(value, "organization_id") and value.organization_id != request.user.organization_id:
                    raise serializers.ValidationError({field: "Select a record in your organization."})
            patient = attrs.get("patient", getattr(self.instance, "patient", None))
            encounter = attrs.get("encounter", getattr(self.instance, "encounter", None))
            if patient and encounter and encounter.patient_id != patient.pk:
                raise serializers.ValidationError({"encounter": "Encounter must belong to the selected patient."})
            attrs["organization"] = request.user.organization
        return attrs


class LabTestSerializer(TenantSerializer):
    class Meta:
        model = LabTest
        fields = ["id", "name", "price_cents", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_price_cents(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than zero.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        name = attrs.get("name", self.instance.name if self.instance else "").strip()
        if not name:
            raise serializers.ValidationError({"name": "A test name is required."})
        attrs["name"] = name
        org = self.context["request"].user.organization
        matches = LabTest.objects.filter(organization=org, name__iexact=name)
        if self.instance:
            matches = matches.exclude(pk=self.instance.pk)
        if matches.exists():
            raise serializers.ValidationError({"name": "This test already exists."})
        return attrs


class MedicationSerializer(TenantSerializer):
    class Meta:
        model = Medication
        fields = ["id", "name", "description", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        name = attrs.get("name", self.instance.name if self.instance else "").strip()
        if not name:
            raise serializers.ValidationError({"name": "A medication name is required."})
        attrs["name"] = name
        matches = Medication.objects.filter(
            organization=self.context["request"].user.organization, name__iexact=name
        )
        if self.instance:
            matches = matches.exclude(pk=self.instance.pk)
        if matches.exists():
            raise serializers.ValidationError({"name": "This medication already exists."})
        return attrs


# ── Core models ───────────────────────────────────────────────────────────────


class PatientSerializer(TenantSerializer):
    assigned_clinician_name = serializers.SerializerMethodField()
    latest_vitals = serializers.SerializerMethodField()

    class Meta:
        model = Patient
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "owner"]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and getattr(request.user, "role", None) in (
            "receptionist", "lab", "pharmacist", "billing"
        ):
            fields.pop("latest_vitals", None)
            if request.user.role == "receptionist" and request.method in ("POST", "PUT", "PATCH"):
                fields["allergies"].write_only = True
            else:
                fields.pop("allergies", None)
        return fields

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if "opd_status" in attrs:
            expected_status = self.instance.opd_status if self.instance else "registered"
            if attrs["opd_status"] != expected_status:
                raise serializers.ValidationError(
                    {"opd_status": "OPD status is updated by the clinical workflow."}
                )
        clinician = attrs.get("assigned_clinician")
        request = self.context.get("request")
        if clinician and request and clinician.organization_id != request.user.organization_id:
            raise serializers.ValidationError(
                {"assigned_clinician": "Consultant must belong to your organization."}
            )
        if (
            request
            and request.user.role == "receptionist"
            and self.instance is None
            and attrs.get("is_opd", True)
            and not clinician
        ):
            raise serializers.ValidationError(
                {"assigned_clinician": "Assign an OPD consultant before completing registration."}
            )
        if self.instance is None and request and request.user.role in ("admin", "receptionist"):
            phone = attrs.get("phone", "").strip()
            if not re.fullmatch(r"\+?[0-9][0-9 ()-]*", phone):
                raise serializers.ValidationError({"phone": "Enter a valid phone number."})
            digits = re.sub(r"\D", "", phone)
            if len(digits) < 4:
                raise serializers.ValidationError({"phone": "Phone number must contain at least four digits."})
            username = ("+" if phone.startswith("+") else "") + digits
            if User.objects.filter(username=username).exists():
                raise serializers.ValidationError({"phone": "An account with this phone number already exists."})
            attrs["phone"] = username
        return attrs

    def get_assigned_clinician_name(self, obj):
        if obj.assigned_clinician:
            return obj.assigned_clinician.name or (
                f"Dr. {obj.assigned_clinician.user.get_full_name()}"
                if obj.assigned_clinician.user
                else "Dr. Consultant"
            )
        return None

    def get_latest_vitals(self, obj):
        v = obj.vital_set.order_by("-created_at").first()
        if v:
            return {
                "id": str(v.id),
                "temperature_c": str(v.temperature_c) if v.temperature_c else None,
                "systolic": v.systolic,
                "diastolic": v.diastolic,
                "heart_rate": v.heart_rate,
                "respiratory_rate": v.respiratory_rate,
                "oxygen_saturation": v.oxygen_saturation,
                "created_at": v.created_at.isoformat(),
            }
        return None


class ClinicianSerializer(TenantSerializer):
    user_detail = UserSerializer(source="user", read_only=True)
    username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Clinician
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        user = attrs.get("user")
        request = self.context.get("request")
        if user and request and (
            user.organization_id != request.user.organization_id or user.role != User.Role.CLINICIAN
        ):
            raise serializers.ValidationError({"user": "Select a clinician account in your organization."})
        if not self.instance and not user and attrs.get("username"):
            password = attrs.get("password")
            if not password:
                raise serializers.ValidationError({"password": "A password is required for a new account."})
            try:
                validate_password(password)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": exc.messages}) from exc
        return attrs

    def create(self, validated_data):
        username = validated_data.pop("username", None)
        password = validated_data.pop("password", None)
        user = validated_data.get("user")
        name = validated_data.get("name", "")

        if not user and username:
            org = validated_data.get("organization")
            if User.objects.filter(username=username).exists():
                raise serializers.ValidationError(
                    {"username": "This username is already in use."}
                )
            parts = name.removeprefix("Dr. ").split()
            user = User.objects.create_user(
                username=username,
                password=password or secrets.token_urlsafe(24),
                first_name=parts[0] if parts else "Consultant",
                last_name=" ".join(parts[1:]),
                role="clinician",
                organization=org,
            )
            validated_data["user"] = user

        return super().create(validated_data)


class ClinicianAvailabilitySerializer(TenantSerializer):
    clinician_name = serializers.CharField(source="clinician.name", read_only=True)

    class Meta:
        model = ClinicianAvailability
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        clinician = attrs.get("clinician", getattr(self.instance, "clinician", None))
        weekday = attrs.get("weekday", getattr(self.instance, "weekday", None))
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        request = self.context.get("request")
        if request and clinician and clinician.organization_id != request.user.organization_id:
            raise serializers.ValidationError(
                {"clinician": "Clinician must belong to your organization."}
            )
        if clinician and weekday is not None and starts_at and ends_at and starts_at < ends_at:
            overlaps = ClinicianAvailability.objects.filter(
                clinician=clinician,
                weekday=weekday,
                active=True,
                starts_at__lt=ends_at,
                ends_at__gt=starts_at,
            )
            if self.instance:
                overlaps = overlaps.exclude(pk=self.instance.pk)
            if overlaps.exists():
                raise serializers.ValidationError(
                    {"starts_at": "Availability windows for this day cannot overlap."}
                )
        return attrs


class AppointmentSerializer(TenantSerializer):
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(
        source="patient.medical_record_number", read_only=True
    )
    clinician_name = serializers.SerializerMethodField()
    clinician_department = serializers.CharField(
        source="clinician.department", read_only=True
    )
    encounter_id = serializers.SerializerMethodField()

    class Meta:
        model = Appointment
        fields = "__all__"
        read_only_fields = [
            "organization",
            "created_at",
            "updated_at",
            "status",
            "idempotency_key",
            "virtual_session_ref",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if "status" in self.initial_data:
            raise serializers.ValidationError({"status": "Use the appointment actions to change status."})
        if self.instance:
            for field in ("patient", "clinician", "starts_at", "visit_type"):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError(
                        {field: "Cancel and book a new appointment to change this field."}
                    )
        return attrs

    def get_patient_name(self, obj):
        return f"{obj.patient.first_name} {obj.patient.last_name}".strip()

    def get_clinician_name(self, obj):
        return obj.clinician.name or (
            f"Dr. {obj.clinician.user.get_full_name()}"
            if obj.clinician.user
            else "Dr. Consultant"
        )

    def get_encounter_id(self, obj):
        encounter = obj.encounter_set.order_by("-created_at").first()
        return str(encounter.pk) if encounter else None


class EncounterSerializer(TenantSerializer):
    patient_name = serializers.SerializerMethodField()
    clinician_name = serializers.SerializerMethodField()
    latest_vitals = serializers.SerializerMethodField()
    lab_orders = serializers.SerializerMethodField()

    class Meta:
        model = Encounter
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "status"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if "status" in self.initial_data:
            raise serializers.ValidationError(
                {"status": "Use the encounter transition action to change status."}
            )
        if self.instance:
            for field in ("patient", "clinician", "appointment"):
                if field in attrs and attrs[field] != getattr(self.instance, field):
                    raise serializers.ValidationError({field: "This encounter link cannot be changed."})
        appointment = attrs.get("appointment", getattr(self.instance, "appointment", None))
        patient = attrs.get("patient", getattr(self.instance, "patient", None))
        clinician = attrs.get("clinician", getattr(self.instance, "clinician", None))
        if appointment and (
            appointment.organization_id != self.context["request"].user.organization_id
            or appointment.patient_id != patient.pk
            or appointment.clinician_id != clinician.pk
        ):
            raise serializers.ValidationError({"appointment": "Appointment must match the patient, clinician and organization."})
        return attrs

    def get_patient_name(self, obj):
        return (
            f"{obj.patient.first_name} {obj.patient.last_name}"
            if obj.patient
            else None
        )

    def get_clinician_name(self, obj):
        if obj.clinician:
            return obj.clinician.name or (
                f"Dr. {obj.clinician.user.get_full_name()}"
                if obj.clinician.user
                else "Dr. Consultant"
            )
        return None

    def get_latest_vitals(self, obj):
        v = (
            obj.vital_set.order_by("-created_at").first()
            or obj.patient.vital_set.order_by("-created_at").first()
        )
        if v:
            return {
                "id": str(v.id),
                "temperature_c": str(v.temperature_c) if v.temperature_c else None,
                "systolic": v.systolic,
                "diastolic": v.diastolic,
                "heart_rate": v.heart_rate,
                "respiratory_rate": v.respiratory_rate,
                "oxygen_saturation": v.oxygen_saturation,
                "created_at": v.created_at.isoformat(),
            }
        return None

    def get_lab_orders(self, obj):
        orders = obj.laborder_set.order_by("-created_at")
        results = []
        for o in orders:
            res = o.labresult_set.order_by("-created_at", "-pk").first()
            results.append(
                {
                    "id": str(o.id),
                    "test_name": o.test_name,
                    "price_cents": o.price_cents,
                    "status": o.status,
                    "created_at": o.created_at.isoformat(),
                    "result": res.result if res else None,
                    "reference_range": res.reference_range if res else None,
                    "result_status": res.status if res else None,
                }
            )
        return results


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

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not any(str(attrs.get(field, "")).strip() for field in (
            "content", "history_of_present_illness", "past_medical_history", "history_of_surgery"
        )):
            raise serializers.ValidationError({"content": "Enter clinical documentation."})
        return attrs


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
    care_type = serializers.SerializerMethodField()

    class Meta:
        model = LabOrder
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "ordered_by", "bill"]

    def get_care_type(self, obj):
        return "ipd" if obj.admission_id else "opd"


class LabResultSerializer(TenantSerializer):
    care_type = serializers.SerializerMethodField()
    test_name = serializers.CharField(source="order.test_name", read_only=True)
    order_status = serializers.CharField(source="order.status", read_only=True)
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = LabResult
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "entered_by"]

    def get_care_type(self, obj):
        return "ipd" if obj.order.admission_id else "opd"

    def get_is_current(self, obj):
        latest = obj.order.labresult_set.order_by("-created_at", "-pk").values_list("pk", flat=True).first()
        return latest == obj.pk

    def validate_status(self, value):
        if value not in ("preliminary", "final"):
            raise serializers.ValidationError("Result status must be preliminary or final.")
        return value


class ImagingTestSerializer(TenantSerializer):
    class Meta:
        model = ImagingTest
        fields = ["id", "name", "description", "price_cents", "active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_price_cents(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than zero.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        name = attrs.get("name", self.instance.name if self.instance else "").strip()
        if not name:
            raise serializers.ValidationError({"name": "Name cannot be empty."})
        org = self.context.get("organization") or (self.instance.organization if self.instance else None)
        if org:
            matches = ImagingTest.objects.filter(organization=org, name__iexact=name)
            if self.instance:
                matches = matches.exclude(pk=self.instance.pk)
            if matches.exists():
                raise serializers.ValidationError({"name": "An imaging test with this name already exists."})
        return attrs


class ImagingOrderSerializer(TenantSerializer):
    care_type = serializers.SerializerMethodField()

    class Meta:
        model = ImagingOrder
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "ordered_by", "bill"]

    def get_care_type(self, obj):
        return "ipd" if obj.admission_id else "opd"


class ImagingResultSerializer(TenantSerializer):
    care_type = serializers.SerializerMethodField()
    test_name = serializers.CharField(source="order.test_name", read_only=True)
    order_status = serializers.CharField(source="order.status", read_only=True)
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = ImagingResult
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "entered_by"]

    def get_care_type(self, obj):
        return "ipd" if obj.order.admission_id else "opd"

    def get_is_current(self, obj):
        latest = obj.order.imagingresult_set.order_by("-created_at", "-pk").values_list("pk", flat=True).first()
        return latest == obj.pk

    def validate_status(self, value):
        if value not in ("preliminary", "final"):
            raise serializers.ValidationError("Result status must be preliminary or final.")
        return value


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
            "status",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if "status" in self.initial_data:
            raise serializers.ValidationError({"status": "Use the dispense action to change status."})
        return attrs


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
        read_only_fields = [
            "organization", "created_at", "updated_at", "patient", "status"
        ]

    def validate_ward(self, value):
        request = self.context.get("request")
        if request and value.organization_id != request.user.organization_id:
            raise serializers.ValidationError("Ward must belong to your organization.")
        return value


class BillSerializer(TenantSerializer):
    class Meta:
        model = Bill
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "total_cents"]


class InpatientAdmissionSerializer(TenantSerializer):
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source="patient.medical_record_number", read_only=True)
    doctor_name = serializers.SerializerMethodField()
    bed_label = serializers.CharField(source="bed.label", read_only=True)
    ward_name = serializers.CharField(source="bed.ward.name", read_only=True)
    stay_seconds = serializers.SerializerMethodField()
    next_charge_at = serializers.SerializerMethodField()
    room_charge_count = serializers.SerializerMethodField()
    room_charge_total_cents = serializers.SerializerMethodField()

    class Meta:
        model = InpatientAdmission
        fields = "__all__"
        read_only_fields = [
            "organization",
            "created_at",
            "updated_at",
            "patient",
            "bed",
            "clinician",
            "department",
            "admitted_at",
            "discharged_at",
            "room_rate_cents",
            "room_rate_started_at",
            "admitted_by",
            "discharged_by",
        ]

    def get_patient_name(self, obj):
        return f"{obj.patient.first_name} {obj.patient.last_name}".strip()

    def get_doctor_name(self, obj):
        clinician = obj.clinician
        if not clinician:
            return ""
        return clinician.name or (
            f"Dr. {clinician.user.get_full_name()}"
            if clinician.user
            else "Dr. Consultant"
        )

    def get_stay_seconds(self, obj):
        end = obj.discharged_at or timezone.now()
        return max(0, int((end - obj.admitted_at).total_seconds()))

    def get_next_charge_at(self, obj):
        if obj.discharged_at or obj.room_rate_cents <= 0:
            return None
        elapsed = max(0, (timezone.now() - obj.room_rate_started_at).total_seconds())
        next_day = int(elapsed // 86400) + 1
        return (obj.room_rate_started_at + timedelta(days=next_day)).isoformat()

    def get_room_charge_count(self, obj):
        return obj.room_charges.count()

    def get_room_charge_total_cents(self, obj):
        return sum(charge.amount_cents for charge in obj.room_charges.all())


class InpatientMedicationPlanSerializer(TenantSerializer):
    prescribed_by_name = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(
        source="admission.patient.medical_record_number", read_only=True
    )
    ward_name = serializers.CharField(source="admission.bed.ward.name", read_only=True)

    class Meta:
        model = InpatientMedicationPlan
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "prescribed_by"]

    def get_prescribed_by_name(self, obj):
        return obj.prescribed_by.get_full_name() or obj.prescribed_by.username

    def get_patient_name(self, obj):
        return f"{obj.admission.patient.first_name} {obj.admission.patient.last_name}".strip()


class InpatientMedicationAdministrationSerializer(TenantSerializer):
    administered_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InpatientMedicationAdministration
        fields = "__all__"
        read_only_fields = [
            "organization", "created_at", "updated_at", "administered_by"
        ]

    def get_administered_by_name(self, obj):
        return obj.administered_by.get_full_name() or obj.administered_by.username


class InpatientDoctorNoteSerializer(TenantSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = InpatientDoctorNote
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "author"]

    def get_author_name(self, obj):
        return obj.author.get_full_name() or obj.author.username


class PaymentSerializer(TenantSerializer):
    class Meta:
        model = Payment
        fields = "__all__"
        read_only_fields = ["organization", "created_at", "updated_at", "recorded_by"]


class InsuranceClaimSerializer(TenantSerializer):
    claim_number = serializers.CharField(read_only=True)
    patient_name = serializers.SerializerMethodField()
    invoice_number = serializers.CharField(source="bill.invoice_number", read_only=True)

    class Meta:
        model = InsuranceClaim
        fields = "__all__"
        read_only_fields = [
            "organization",
            "created_at",
            "updated_at",
            "status",
            "approved_cents",
            "submitted_at",
            "decided_at",
            "created_by",
            "claim_number",
        ]

    def get_patient_name(self, obj):
        return f"{obj.bill.patient.first_name} {obj.bill.patient.last_name}".strip()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        bill = attrs.get("bill", getattr(self.instance, "bill", None))
        request = self.context.get("request")
        if request and bill and bill.organization_id != request.user.organization_id:
            raise serializers.ValidationError({"bill": "Invoice must belong to your organization."})
        if attrs.get("requested_cents", 1) <= 0:
            raise serializers.ValidationError(
                {"requested_cents": "Claim amount must be greater than zero."}
            )
        return attrs


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
    grantee_username = serializers.CharField(write_only=True)
    patient_name = serializers.SerializerMethodField()
    grantee_name = serializers.SerializerMethodField()

    class Meta:
        model = ProxyGrant
        fields = [
            "id",
            "organization",
            "patient",
            "patient_name",
            "grantee",
            "grantee_name",
            "grantee_username",
            "scope",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "organization",
            "patient",
            "patient_name",
            "grantee",
            "grantee_name",
            "created_at",
            "updated_at",
        ]

    def validate_scope(self, value):
        allowed = {"records", "results", "appointments", "billing", "medications"}
        scopes = {scope.strip() for scope in value.split(",") if scope.strip()}
        if not scopes or not scopes.issubset(allowed):
            raise serializers.ValidationError(
                "Choose one or more valid scopes: records, results, appointments, billing, medications."
            )
        return ",".join(sorted(scopes))

    def validate_grantee_username(self, value):
        try:
            grantee = User.objects.get(
                username=value,
                role=User.Role.PATIENT,
                organization=self.context["request"].user.organization,
            )
        except User.DoesNotExist as exc:
            raise serializers.ValidationError(
                "Choose an existing patient account in your organization."
            ) from exc
        self._grantee = grantee
        return value

    def get_patient_name(self, obj):
        return f"{obj.patient.first_name} {obj.patient.last_name}".strip()

    def get_grantee_name(self, obj):
        return obj.grantee.get_full_name() or obj.grantee.username

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        if request and request.user.role == User.Role.PATIENT:
            if not getattr(request.user, "patient_id", None):
                raise serializers.ValidationError(
                    {"detail": "Your account is not linked to a patient record."}
                )
            if self.instance is None:
                grantee = getattr(self, "_grantee", None)
                attrs.pop("grantee_username", None)
                attrs["grantee"] = grantee
                if not attrs["grantee"]:
                    raise serializers.ValidationError(
                        {"grantee_username": "Choose a patient account to grant access to."}
                    )
                if str(attrs["grantee"].patient_id) == str(request.user.patient_id):
                    raise serializers.ValidationError(
                        {"grantee_username": "You cannot grant proxy access to your own account."}
                    )
        return attrs


class PatientMessageSerializer(TenantSerializer):
    sender_name = serializers.SerializerMethodField()
    sender_role = serializers.CharField(source="sender.role", read_only=True)
    patient_name = serializers.SerializerMethodField()

    class Meta:
        model = PatientMessage
        fields = "__all__"
        read_only_fields = [
            "organization",
            "created_at",
            "updated_at",
            "sender",
            "recipient",
            "read_at",
        ]

    def get_sender_name(self, obj):
        return obj.sender.get_full_name() or obj.sender.username

    def get_patient_name(self, obj):
        return f"{obj.patient.first_name} {obj.patient.last_name}".strip()


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
