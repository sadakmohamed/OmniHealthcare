import hashlib
import hmac
import json
import secrets
import uuid
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Allergy,
    Appointment,
    AuditEvent,
    Bed,
    Bill,
    CarePlan,
    ClinicalNote,
    Clinician,
    ClinicianAvailability,
    Consent,
    Diagnosis,
    DischargeNote,
    Encounter,
    FollowUp,
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
    Organization,
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
from .services import accrue_room_charges, discharge_admission
from .serializers import (
    AllergySerializer,
    AppointmentSerializer,
    AuditEventSerializer,
    BedSerializer,
    BillSerializer,
    CarePlanSerializer,
    ClinicalNoteSerializer,
    ClinicianSerializer,
    ClinicianAvailabilitySerializer,
    ConsentSerializer,
    DiagnosisSerializer,
    DischargeNoteSerializer,
    EncounterSerializer,
    FollowUpSerializer,
    InpatientAdmissionSerializer,
    InpatientDoctorNoteSerializer,
    InpatientMedicationAdministrationSerializer,
    InpatientMedicationPlanSerializer,
    InsuranceClaimSerializer,
    LabOrderSerializer,
    LabResultSerializer,
    LabTestSerializer,
    MedicationSerializer,
    MedicalHistorySerializer,
    ManagedUserSerializer,
    PatientRegistrationSerializer,
    PatientSerializer,
    PatientMessageSerializer,
    PaymentSerializer,
    PrescriptionSerializer,
    ProxyGrantSerializer,
    ReferralSerializer,
    UserSerializer,
    ProfileSerializer,
    password_version,
    VirtualSessionSerializer,
    VitalSerializer,
    WardSerializer,
)

User = get_user_model()

READ_ROLES = {
    LabTest: {"admin", "billing", "clinician"},
    Medication: {"admin", "pharmacist", "clinician"},
    Patient: {"admin", "receptionist", "clinician", "nurse", "lab", "pharmacist", "billing", "patient"},
    Clinician: {"admin", "receptionist", "nurse", "clinician", "patient"},
    ClinicianAvailability: {"admin", "receptionist", "clinician", "patient"},
    Appointment: {"admin", "receptionist", "clinician", "patient"},
    Encounter: {"admin", "clinician", "nurse", "patient"},
    Vital: {"admin", "nurse", "clinician", "patient"},
    ClinicalNote: {"admin", "clinician", "patient"},
    Diagnosis: {"admin", "clinician", "patient"},
    CarePlan: {"admin", "clinician", "patient"},
    LabOrder: {"admin", "clinician", "nurse", "lab", "patient"},
    LabResult: {"admin", "clinician", "nurse", "lab", "patient"},
    Prescription: {"admin", "clinician", "pharmacist", "patient"},
    Referral: {"admin", "clinician", "patient"},
    Ward: {"admin", "nurse", "clinician"},
    Bed: {"admin", "nurse", "clinician"},
    InpatientAdmission: {"admin", "nurse", "clinician"},
    InpatientMedicationPlan: {"admin", "nurse", "clinician", "pharmacist"},
    InpatientMedicationAdministration: {"admin", "nurse", "clinician"},
    InpatientDoctorNote: {"admin", "nurse", "clinician"},
    Bill: {"admin", "billing", "patient"},
    Payment: {"admin", "billing", "patient"},
    InsuranceClaim: {"admin", "billing", "patient"},
    FollowUp: {"admin", "receptionist", "clinician", "nurse", "patient"},
    AuditEvent: {"admin"},
    Consent: {"admin", "clinician", "patient"},
    VirtualSession: {"admin", "clinician", "receptionist", "patient"},
    Allergy: {"admin", "clinician", "nurse", "patient"},
    DischargeNote: {"admin", "clinician", "patient"},
    ProxyGrant: {"admin", "patient"},
    MedicalHistory: {"admin", "clinician", "nurse", "patient"},
    PatientMessage: {"admin", "clinician", "patient"},
}


def clinician_can_document_admission(user, admission):
    clinician = Clinician.objects.filter(
        user=user, organization=user.organization
    ).first()
    return bool(
        clinician
        and (
            admission.clinician_id == clinician.id
            or admission.patient.assigned_clinician_id == clinician.id
        )
    )


# ── Base viewset ──────────────────────────────────────────────────────────────


class TenantViewSet(viewsets.ModelViewSet):
    """
    Base viewset that enforces:
    - Authentication required
    - All queries scoped to the requesting user's organization
    - Patient-role users can only see their own patient-linked records
    """

    permission_classes = [IsAuthenticated]

    DEFAULT_WRITE_ROLES = {
        Referral: {"admin", "clinician"},
        FollowUp: {"admin", "clinician", "receptionist", "nurse"},
        Consent: {"admin", "patient"},
        Allergy: {"admin", "clinician", "nurse"},
        MedicalHistory: {"admin", "clinician", "nurse"},
    }

    def _ensure_patient_write_is_owned(self, patient):
        user = self.request.user
        if user.role != "patient" or patient is None:
            return
        if patient.owner_id != user.id and str(patient.pk) != str(user.patient_id):
            raise PermissionDenied("Shared patient records are read-only.")

    def _object_patient(self, instance):
        patient = getattr(instance, "patient", None)
        if patient:
            return patient
        related_bill = getattr(instance, "bill", None)
        if related_bill:
            return related_bill.patient
        related_encounter = getattr(instance, "encounter", None)
        if related_encounter:
            return related_encounter.patient
        related_admission = getattr(instance, "admission", None)
        if related_admission:
            return related_admission.patient
        return None

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._ensure_patient_write_is_owned(serializer.validated_data.get("patient"))
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(
            serializer.data, status=status.HTTP_201_CREATED, headers=headers
        )

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        self._ensure_patient_write_is_owned(self._object_patient(instance))
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self._ensure_patient_write_is_owned(self._object_patient(instance))
        return super().destroy(request, *args, **kwargs)

    def get_search_fields(self, request):
        configured_fields = getattr(self, "search_fields", None)
        if configured_fields:
            return configured_fields

        model = self.queryset.model
        fields = [
            field.name
            for field in model._meta.get_fields()
            if field.concrete
            and field.get_internal_type() in ("CharField", "TextField")
            and not field.many_to_one
        ]
        model_fields = {field.name for field in model._meta.get_fields()}
        if "patient" in model_fields:
            fields.extend(
                [
                    "patient__first_name",
                    "patient__last_name",
                    "patient__medical_record_number",
                ]
            )
        if "clinician" in model_fields:
            fields.extend(
                [
                    "clinician__name",
                    "clinician__department",
                    "clinician__specialty",
                ]
            )
        if "admission" in model_fields:
            fields.extend(
                [
                    "admission__patient__first_name",
                    "admission__patient__last_name",
                    "admission__patient__medical_record_number",
                ]
            )
        if "encounter" in model_fields:
            fields.extend(
                [
                    "encounter__patient__first_name",
                    "encounter__patient__last_name",
                    "encounter__patient__medical_record_number",
                ]
            )
        if "ward" in model_fields:
            fields.append("ward__name")
        return list(dict.fromkeys(fields))

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        # Tenant isolation: always filter by organization
        qs = qs.filter(organization=user.organization)
        date_value = self.request.query_params.get("date")
        if date_value:
            date_fields = {
                Patient: "registration_date",
                Appointment: "starts_at",
                InpatientAdmission: "admitted_at",
                FollowUp: "due_at",
                VirtualSession: "scheduled_at",
            }
            date_field = date_fields.get(qs.model)
            if not date_field:
                available_fields = {field.name for field in qs.model._meta.get_fields()}
                date_field = "created_at" if "created_at" in available_fields else None
            if date_field:
                field_type = qs.model._meta.get_field(date_field).get_internal_type()
                lookup = f"{date_field}__date" if field_type == "DateTimeField" else date_field
                qs = qs.filter(**{lookup: date_value})
        patient_filter = self.request.query_params.get("patient")
        if patient_filter:
            if any(field.name == "patient" for field in qs.model._meta.get_fields()):
                qs = qs.filter(patient_id=patient_filter)
            elif qs.model in (Payment, InsuranceClaim):
                qs = qs.filter(bill__patient_id=patient_filter)
        encounter_filter = self.request.query_params.get("encounter")
        if encounter_filter and any(field.name == "encounter" for field in qs.model._meta.get_fields()):
            qs = qs.filter(encounter_id=encounter_filter)
        allowed_roles = READ_ROLES.get(qs.model)
        if user.role != "admin" and allowed_roles and user.role not in allowed_roles:
            raise PermissionDenied("Your role cannot access this module.")
        # Patient self-service: only see their own records
        if user.role == "patient":
            proxy_grants = ProxyGrant.objects.filter(
                organization=user.organization, grantee=user, active=True
            )
            if qs.model == Patient:
                cond = Q(owner=user)
                if user.patient_id:
                    cond |= Q(id=user.patient_id)
                proxy_patient_ids = [
                    grant.patient_id
                    for grant in proxy_grants
                    if "records" in grant.scope.split(",")
                ]
                qs = qs.filter(cond | Q(id__in=proxy_patient_ids))
            elif qs.model == ProxyGrant:
                qs = qs.filter(Q(patient_id=user.patient_id) | Q(grantee=user))
            elif qs.model in (InsuranceClaim, Payment):
                cond = Q(bill__patient__owner=user)
                if user.patient_id:
                    cond |= Q(bill__patient_id=user.patient_id)
                proxy_patient_ids = [
                    grant.patient_id
                    for grant in proxy_grants
                    if "billing" in grant.scope.split(",")
                ]
                qs = qs.filter(cond | Q(bill__patient_id__in=proxy_patient_ids))
            elif hasattr(qs.model, "patient"):
                cond = Q(patient__owner=user)
                if user.patient_id:
                    cond |= Q(patient_id=user.patient_id)
                scope = {
                    Appointment: "appointments",
                    LabOrder: "results",
                    LabResult: "results",
                    Bill: "billing",
                    Payment: "billing",
                    Prescription: "medications",
                    InpatientMedicationPlan: "medications",
                    InpatientMedicationAdministration: "medications",
                }.get(qs.model, "records")
                proxy_patient_ids = [
                    grant.patient_id
                    for grant in proxy_grants
                    if scope in grant.scope.split(",")
                ]
                qs = qs.filter(cond | Q(patient_id__in=proxy_patient_ids))
        elif user.role == "clinician":
            clinician = Clinician.objects.filter(
                user=user, organization=user.organization
            ).first()
            if qs.model is Clinician:
                qs = qs.filter(pk=clinician.pk) if clinician else qs.none()
            elif qs.model is Appointment:
                qs = qs.filter(clinician=clinician) if clinician else qs.none()
            elif qs.model is Encounter:
                qs = qs.filter(clinician=clinician) if clinician else qs.none()
            elif qs.model is Vital:
                qs = qs.filter(patient__assigned_clinician=clinician) if clinician else qs.none()
            elif qs.model is LabOrder:
                scope = Q(patient__assigned_clinician=clinician) | Q(
                    admission__clinician=clinician
                )
                qs = qs.filter(scope).distinct() if clinician else qs.none()
            elif qs.model is LabResult:
                scope = Q(patient__assigned_clinician=clinician) | Q(
                    order__admission__clinician=clinician
                )
                qs = qs.filter(scope).distinct() if clinician else qs.none()
            elif qs.model is InpatientAdmission:
                scope = Q(clinician=clinician) | Q(patient__assigned_clinician=clinician)
                qs = qs.filter(scope).distinct() if clinician else qs.none()
            elif qs.model in (
                InpatientMedicationPlan,
                InpatientMedicationAdministration,
                InpatientDoctorNote,
            ):
                scope = Q(admission__clinician=clinician) | Q(
                    admission__patient__assigned_clinician=clinician
                )
                qs = qs.filter(scope).distinct() if clinician else qs.none()
            elif hasattr(qs.model, "patient"):
                scope = Q(patient__assigned_clinician=clinician)
                qs = qs.filter(scope).distinct() if clinician else qs.none()
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        self._save_default_record(serializer)

    @transaction.atomic
    def perform_update(self, serializer):
        self._save_default_record(serializer)

    def perform_destroy(self, instance):
        raise PermissionDenied("This record cannot be deleted.")

    def _audit_change(self, record, action, details=None):
        AuditEvent.objects.create(
            organization=record.organization, actor=self.request.user, action=action,
            resource_type=record._meta.object_name, resource_id=str(record.pk),
            details=details or {},
        )

    def _save_default_record(self, serializer):
        user = self.request.user
        allowed = self.DEFAULT_WRITE_ROLES.get(self.queryset.model, set())
        if user.role not in allowed:
            raise PermissionDenied("Your role cannot modify this module.")
        instance = serializer.instance
        patient = serializer.validated_data.get("patient", getattr(instance, "patient", None))
        if user.role == "clinician" and patient and (
            not patient.assigned_clinician_id or patient.assigned_clinician.user_id != user.id
        ):
            raise PermissionDenied("You can only manage records for your assigned patients.")
        if instance and patient and getattr(instance, "patient_id", patient.pk) != patient.pk:
            raise ValidationError({"patient": "A record cannot be moved to another patient."})
        record = serializer.save(organization=user.organization)
        AuditEvent.objects.create(
            organization=user.organization, actor=user,
            action=f"{record._meta.model_name}.{'updated' if instance else 'created'}",
            resource_type=record._meta.object_name, resource_id=str(record.pk), details={},
        )


# ── Core viewsets ─────────────────────────────────────────────────────────────


class ManagedUserViewSet(viewsets.ModelViewSet):
    serializer_class = ManagedUserSerializer
    queryset = User.objects.all()
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        if self.request.user.role != "admin" or not self.request.user.organization_id:
            raise PermissionDenied("Only administrators may manage accounts.")
        return User.objects.filter(organization=self.request.user.organization).order_by("username")

    @transaction.atomic
    def perform_create(self, serializer):
        self.get_queryset()
        user = serializer.save(organization=self.request.user.organization)
        AuditEvent.objects.create(
            organization=user.organization, actor=self.request.user,
            action="user.created", resource_type="User", resource_id=str(user.pk),
            details={"role": user.role},
        )

    @transaction.atomic
    def perform_update(self, serializer):
        user = serializer.save()
        AuditEvent.objects.create(
            organization=user.organization, actor=self.request.user,
            action="user.updated", resource_type="User", resource_id=str(user.pk),
            details={"role": user.role, "is_active": user.is_active},
        )


class LabTestViewSet(TenantViewSet):
    queryset = LabTest.objects.all()
    serializer_class = LabTestSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "clinician":
            queryset = queryset.filter(active=True)
        return queryset

    def perform_create(self, serializer):
        if self.request.user.role not in ("admin", "billing"):
            raise PermissionDenied("Only administrators and billing staff can manage lab tests.")
        test = serializer.save(organization=self.request.user.organization)
        AuditEvent.objects.create(
            organization=test.organization, actor=self.request.user,
            action="lab_test.created", resource_type="LabTest", resource_id=str(test.pk),
            details={"name": test.name, "price_cents": test.price_cents, "active": test.active},
        )

    def perform_update(self, serializer):
        if self.request.user.role not in ("admin", "billing"):
            raise PermissionDenied("Only administrators and billing staff can manage lab tests.")
        test = serializer.save()
        AuditEvent.objects.create(
            organization=test.organization, actor=self.request.user,
            action="lab_test.updated", resource_type="LabTest", resource_id=str(test.pk),
            details={"name": test.name, "price_cents": test.price_cents, "active": test.active},
        )


class MedicationViewSet(TenantViewSet):
    queryset = Medication.objects.all()
    serializer_class = MedicationSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    pagination_class = None

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "clinician":
            queryset = queryset.filter(active=True)
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("admin", "pharmacist"):
            raise PermissionDenied("Only administrators and pharmacy staff can manage medications.")
        medication = serializer.save(organization=self.request.user.organization)
        self._audit(medication, "medication.created")

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role not in ("admin", "pharmacist"):
            raise PermissionDenied("Only administrators and pharmacy staff can manage medications.")
        medication = serializer.save()
        self._audit(medication, "medication.updated")

    def _audit(self, medication, action_name):
        AuditEvent.objects.create(
            organization=medication.organization, actor=self.request.user,
            action=action_name, resource_type="Medication", resource_id=str(medication.pk),
            details={"name": medication.name, "active": medication.active},
        )


class PatientViewSet(TenantViewSet):
    """
    Provides full patient search by name, MRN, phone, email, and OPD filtering.
    Clinicians see patients registered to their name.
    """

    queryset = Patient.objects.all().order_by("-created_at")
    serializer_class = PatientSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["first_name", "last_name", "medical_record_number", "email", "phone"]
    ordering_fields = ["last_name", "created_at", "date_of_birth", "registration_date"]

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        response.data["temporary_password"] = self.temporary_password
        response["Cache-Control"] = "no-store"
        return response

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        params = self.request.query_params

        # Filter by OPD status / queue
        if params.get("is_opd") is not None:
            is_opd = params.get("is_opd").lower() in ("true", "1")
            qs = qs.filter(is_opd=is_opd)

        if params.get("opd_status"):
            qs = qs.filter(opd_status=params.get("opd_status"))

        if user.is_authenticated and user.role == "clinician":
            clinician = Clinician.objects.filter(
                user=user, organization=user.organization
            ).first()
            if clinician:
                qs = qs.filter(assigned_clinician=clinician)
            else:
                qs = qs.none()

        # Filter by specific clinician
        if params.get("assigned_clinician"):
            qs = qs.filter(assigned_clinician_id=params["assigned_clinician"])

        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(medical_record_number__icontains=search)
                | Q(email__icontains=search)
                | Q(phone__icontains=search)
            )
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        from datetime import timedelta
        import uuid

        if self.request.user.role not in ("receptionist", "admin"):
            raise PermissionDenied("Only reception or administration can register patients.")

        data = serializer.validated_data
        data.setdefault("registration_date", timezone.localdate())
        clinician = data.get("assigned_clinician")
        if clinician and clinician.organization_id != self.request.user.organization_id:
            raise ValidationError({"assigned_clinician": "Consultant must belong to your organization."})
        # Auto-compute date_of_birth from age if not provided
        if not data.get("date_of_birth") and data.get("age"):
            data["date_of_birth"] = timezone.now().date() - timedelta(days=int(data["age"]) * 365)

        patient = serializer.save(organization=self.request.user.organization, owner=None)
        self.temporary_password = secrets.token_urlsafe(18)
        try:
            account = User.objects.create_user(
                username=patient.phone,
                password=self.temporary_password,
                first_name=patient.first_name,
                last_name=patient.last_name,
                email=patient.email,
                role=User.Role.PATIENT,
                organization=patient.organization,
                patient=patient,
                must_change_password=True,
            )
        except IntegrityError as exc:
            raise ValidationError({"phone": "An account with this phone number already exists."}) from exc
        patient.owner = account
        patient.save(update_fields=["owner", "updated_at"])
        AuditEvent.objects.create(
            organization=patient.organization,
            actor=self.request.user,
            action="patient.registered",
            resource_type="Patient",
            resource_id=str(patient.pk),
            details={"is_opd": patient.is_opd},
        )

        # OPD Integration: If receptionist assigned patient to clinician, create consultation bill & initial encounter
        clinician = patient.assigned_clinician
        if clinician and patient.is_opd:
            price = clinician.opd_consultation_price or 5000
            doc_name = clinician.name or (f"Dr. {clinician.user.get_full_name()}" if clinician.user else "Consultant")
            dept = clinician.department or clinician.specialty or "OPD"
            inv_num = f"INV-OPD-{uuid.uuid4().hex[:10].upper()}"

            # Create initial Encounter
            encounter, _ = Encounter.objects.get_or_create(
                organization=patient.organization,
                patient=patient,
                clinician=clinician,
                defaults={"status": Encounter.Status.CHECKED_IN},
            )

            # Auto-create OPD consultation bill with doctor's price
            Bill.objects.create(
                organization=patient.organization,
                patient=patient,
                encounter=encounter,
                invoice_number=inv_num,
                items=[{
                    "description": f"OPD Consultation - {doc_name} ({dept})",
                    "amount_cents": price,
                }],
                total_cents=price,
                status="unpaid",
            )

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role not in ("receptionist", "admin"):
            raise PermissionDenied("Only reception or administration can update patient registration details.")
        fields = sorted(set(serializer.validated_data) - {"organization"})
        patient = serializer.save()
        self._audit_change(patient, "patient.updated", {"fields": fields})

    @action(detail=True, methods=["post"], url_path="update-opd-status")
    @transaction.atomic
    def update_opd_status(self, request, pk=None):
        if request.user.role not in ("nurse", "admin"):
            raise PermissionDenied("Only nursing staff can update OPD triage status.")
        patient = self.get_object()
        new_status = request.data.get("opd_status")
        if new_status != "vitals_recorded" or patient.opd_status != "registered":
            raise ValidationError({"opd_status": "Only registered patients can be advanced to vitals recorded."})
        if not Vital.objects.filter(patient=patient, organization=patient.organization).exists():
            raise ValidationError({"opd_status": "Record patient vitals before advancing the OPD queue."})
        patient.opd_status = new_status
        patient.save(update_fields=["opd_status", "updated_at"])
        self._audit_change(patient, "patient.triage_status_updated", {"status": new_status})
        return Response(PatientSerializer(patient).data)


class ClinicianViewSet(TenantViewSet):
    queryset = Clinician.objects.all().select_related("user").order_by("name", "id")
    serializer_class = ClinicianSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "department", "specialty", "phone"]
    ordering_fields = ["name", "department", "specialty", "opd_consultation_price"]

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("admin",):
            raise PermissionDenied("Only administrators can register clinical consultants.")
        clinician = serializer.save(organization=self.request.user.organization)
        self._audit_change(clinician, "clinician.created")

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators can update consultant profiles.")
        fields = sorted(set(serializer.validated_data) - {"organization", "password"})
        clinician = serializer.save()
        self._audit_change(clinician, "clinician.updated", {"fields": fields})


class ClinicianAvailabilityViewSet(TenantViewSet):
    queryset = ClinicianAvailability.objects.select_related("clinician").all()
    serializer_class = ClinicianAvailabilitySerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        clinician_id = self.request.query_params.get("clinician")
        if clinician_id:
            qs = qs.filter(clinician_id=clinician_id)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators can manage clinician availability.")
        clinician = serializer.validated_data["clinician"]
        if clinician.organization_id != self.request.user.organization_id:
            raise ValidationError({"clinician": "Clinician must belong to your organization."})
        availability = serializer.save(organization=self.request.user.organization)
        self._audit_change(availability, "clinician_availability.created")

    @transaction.atomic
    def perform_destroy(self, instance):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators can manage clinician availability.")
        self._audit_change(instance, "clinician_availability.deleted")
        instance.delete()


class AppointmentViewSet(TenantViewSet):
    queryset = Appointment.objects.all().order_by("starts_at")
    serializer_class = AppointmentSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "patient__first_name",
        "patient__last_name",
        "patient__medical_record_number",
        "clinician__name",
        "clinician__department",
        "reason",
    ]
    ordering_fields = ["starts_at", "status"]

    @action(detail=False, methods=["get"], url_path="availability-slots")
    def availability_slots(self, request):
        clinician_id = request.query_params.get("clinician")
        date_value = request.query_params.get("date")
        if not clinician_id or not date_value:
            raise ValidationError({"detail": "Clinician and date are required."})
        try:
            target_date = date.fromisoformat(date_value)
        except ValueError as exc:
            raise ValidationError({"date": "Enter a valid date in YYYY-MM-DD format."}) from exc
        clinician = Clinician.objects.filter(
            pk=clinician_id, organization=request.user.organization
        ).first()
        if not clinician:
            raise ValidationError({"clinician": "Choose a clinician in your organization."})
        try:
            local_tz = ZoneInfo(request.user.organization.time_zone)
        except (ZoneInfoNotFoundError, AttributeError) as exc:
            raise ValidationError(
                {"date": "The organization time zone is invalid. Contact an administrator."}
            ) from exc

        local_day_start = datetime.combine(target_date, time.min, tzinfo=local_tz)
        local_day_end = local_day_start + timedelta(days=1)
        occupied = set(
            Appointment.objects.filter(
                organization=request.user.organization,
                clinician=clinician,
                starts_at__gte=local_day_start.astimezone(ZoneInfo("UTC")),
                starts_at__lt=local_day_end.astimezone(ZoneInfo("UTC")),
            )
            .exclude(status=Appointment.Status.CANCELLED)
            .values_list("starts_at", flat=True)
        )
        slots = []
        windows = ClinicianAvailability.objects.filter(
            organization=request.user.organization,
            clinician=clinician,
            weekday=target_date.weekday(),
            active=True,
        )
        for window in windows:
            candidate = datetime.combine(target_date, window.starts_at, tzinfo=local_tz)
            window_end = datetime.combine(target_date, window.ends_at, tzinfo=local_tz)
            while candidate + timedelta(minutes=30) <= window_end:
                starts_at = candidate.astimezone(ZoneInfo("UTC"))
                if starts_at not in occupied:
                    slots.append(
                        {
                            "starts_at": starts_at.isoformat(),
                            "local_time": candidate.strftime("%H:%M"),
                        }
                    )
                candidate += timedelta(minutes=30)
        return Response({"date": target_date.isoformat(), "slots": slots})

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("patient"):
            qs = qs.filter(patient_id=params["patient"])
        if params.get("clinician"):
            qs = qs.filter(clinician_id=params["clinician"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("visit_type"):
            qs = qs.filter(visit_type=params["visit_type"])
        if params.get("date"):
            qs = qs.filter(starts_at__date=params["date"])
        if params.get("date_from"):
            qs = qs.filter(starts_at__date__gte=params["date_from"])
        if params.get("date_to"):
            qs = qs.filter(starts_at__date__lte=params["date_to"])
        return qs

    def create(self, request, *args, **kwargs):
        idempotency_key = (
            request.headers.get("Idempotency-Key")
            or request.data.get("idempotency_key")
            or ""
        ).strip()
        if len(idempotency_key) > 100:
            raise ValidationError({"idempotency_key": "The key must be 100 characters or fewer."})

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self._validate_booking_access(serializer.validated_data)
        if idempotency_key:
            existing = Appointment.objects.filter(
                organization=request.user.organization,
                idempotency_key=idempotency_key,
            ).first()
            if existing:
                self._validate_idempotent_retry(existing, serializer.validated_data)
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                self._create_appointment(serializer, idempotency_key)
        except IntegrityError:
            if idempotency_key:
                existing = Appointment.objects.filter(
                    organization=request.user.organization,
                    idempotency_key=idempotency_key,
                ).first()
                if existing:
                    self._validate_idempotent_retry(existing, serializer.validated_data)
                    return Response(
                        self.get_serializer(existing).data,
                        status=status.HTTP_200_OK,
                    )
            raise ValidationError(
                {"starts_at": "This clinician's 30-minute slot is already booked."}
            )

        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _validate_idempotent_retry(existing, data):
        same_request = (
            existing.patient_id == data["patient"].pk
            and existing.clinician_id == data["clinician"].pk
            and existing.starts_at == data["starts_at"]
            and existing.visit_type == data.get("visit_type", Appointment.VisitType.CLINIC)
            and existing.reason == data.get("reason", "")
        )
        if not same_request:
            raise ValidationError(
                {"idempotency_key": "This key was already used for a different booking."}
            )

    def _create_appointment(self, serializer, idempotency_key):
        user = self.request.user
        self._validate_booking_access(serializer.validated_data)
        clinician = serializer.validated_data["clinician"]
        starts_at = serializer.validated_data["starts_at"]
        try:
            local_tz = ZoneInfo(user.organization.time_zone)
        except (ZoneInfoNotFoundError, AttributeError) as exc:
            raise ValidationError(
                {"starts_at": "The organization time zone is invalid. Contact an administrator."}
            ) from exc
        local_start = starts_at.astimezone(local_tz)
        if (
            local_start.minute not in (0, 30)
            or local_start.second
            or local_start.microsecond
        ):
            raise ValidationError(
                {"starts_at": "Choose a 30-minute time slot (on the hour or half-hour)."}
            )
        local_end = local_start + timedelta(minutes=30)
        available = ClinicianAvailability.objects.filter(
            organization=user.organization,
            clinician=clinician,
            weekday=local_start.weekday(),
            starts_at__lte=local_start.time().replace(tzinfo=None),
            ends_at__gte=local_end.time().replace(tzinfo=None),
            active=True,
        ).exists()
        if local_start.date() != local_end.date() or not available:
            raise ValidationError(
                {"starts_at": "The clinician is not available for this 30-minute slot."}
            )
        if Appointment.objects.select_for_update().filter(
            organization=user.organization,
            clinician=clinician,
            starts_at=starts_at,
        ).exclude(status=Appointment.Status.CANCELLED).exists():
            raise ValidationError(
                {"starts_at": "This clinician's 30-minute slot is already booked."}
            )
        appointment = serializer.save(
            organization=user.organization,
            idempotency_key=idempotency_key,
        )
        self._audit_change(appointment, "appointment.booked")

    def _validate_booking_access(self, data):
        user = self.request.user
        if user.role not in ("receptionist", "admin", "clinician", "patient"):
            raise PermissionDenied("Your role cannot schedule appointments.")
        patient = data["patient"]
        clinician = data["clinician"]
        if (
            patient.organization_id != user.organization_id
            or clinician.organization_id != user.organization_id
        ):
            raise ValidationError("Patient and clinician must belong to your organization.")
        if user.role == "patient" and not (
            patient.owner_id == user.id or patient.pk == user.patient_id
        ):
            raise PermissionDenied("You can only book appointments for your own patient record.")
        if user.role == "clinician" and not (
            clinician.user_id == user.id
            and patient.assigned_clinician_id == clinician.id
        ):
            raise PermissionDenied("You can only book appointments for your assigned patients.")

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role not in ("receptionist", "admin"):
            raise PermissionDenied("Only reception or administration can update appointments.")
        fields = sorted(set(serializer.validated_data) - {"organization"})
        appointment = serializer.save()
        self._audit_change(appointment, "appointment.updated", {"fields": fields})

    @transaction.atomic
    @action(detail=True, methods=["post"])
    def checkin(self, request, pk=None):
        appointment = self.get_object()
        if request.user.role not in ("receptionist", "admin"):
            raise PermissionDenied("Only reception can check in appointments.")
        if appointment.visit_type != Appointment.VisitType.CLINIC:
            raise ValidationError("Virtual appointments must be opened in Virtual Care.")
        if appointment.status != Appointment.Status.SCHEDULED:
            raise ValidationError("Only scheduled appointments can be checked in.")
        patient = appointment.patient
        patient.assigned_clinician = appointment.clinician
        patient.is_opd = True
        patient.opd_status = "registered"
        patient.save(
            update_fields=[
                "assigned_clinician",
                "is_opd",
                "opd_status",
                "updated_at",
            ]
        )
        encounter = Encounter.objects.filter(
            organization=appointment.organization,
            appointment=appointment,
        ).first()
        if not encounter:
            encounter = Encounter.objects.filter(
                organization=appointment.organization,
                patient=patient,
                clinician=appointment.clinician,
                appointment__isnull=True,
                status__in=[
                    Encounter.Status.SCHEDULED,
                    Encounter.Status.CHECKED_IN,
                ],
            ).order_by("-created_at").first()
            if encounter:
                encounter.appointment = appointment
                encounter.status = Encounter.Status.CHECKED_IN
                encounter.save(update_fields=["appointment", "status", "updated_at"])
            else:
                encounter = Encounter.objects.create(
                    organization=appointment.organization,
                    patient=patient,
                    clinician=appointment.clinician,
                    appointment=appointment,
                    status=Encounter.Status.CHECKED_IN,
                )
        elif encounter.status == Encounter.Status.SCHEDULED:
            encounter.status = Encounter.Status.CHECKED_IN
            encounter.save(update_fields=["status", "updated_at"])
        if not Bill.objects.filter(
            organization=appointment.organization,
            encounter=encounter,
            care_type=Bill.CareType.OPD,
        ).exists():
            clinician = appointment.clinician
            clinician_name = clinician.name or (
                f"Dr. {clinician.user.get_full_name()}"
                if clinician.user
                else "Consultant"
            )
            department = clinician.department or clinician.specialty or "OPD"
            fee = clinician.opd_consultation_price
            Bill.objects.create(
                organization=appointment.organization,
                patient=patient,
                encounter=encounter,
                invoice_number=f"INV-OPD-{uuid.uuid4().hex[:10].upper()}",
                items=[{
                    "description": f"OPD Consultation - {clinician_name} ({department})",
                    "amount_cents": fee,
                }],
                total_cents=fee,
                status="unpaid",
                care_type=Bill.CareType.OPD,
            )
        appointment.status = Appointment.Status.CHECKED_IN
        appointment.save(update_fields=["status", "updated_at"])
        AuditEvent.objects.create(
            organization=appointment.organization,
            actor=request.user,
            action="appointment.checked_in",
            resource_type="Appointment",
            resource_id=str(appointment.pk),
            details={"encounter_id": str(encounter.pk)},
        )
        return Response(AppointmentSerializer(appointment).data)

    @transaction.atomic
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        appointment = self.get_object()
        if request.user.role not in ("receptionist", "admin", "patient"):
            raise PermissionDenied("Only reception can cancel appointments.")
        if appointment.status == Appointment.Status.CANCELLED:
            return Response(AppointmentSerializer(appointment).data)
        if request.user.role == "patient" and not (
            appointment.patient.owner_id == request.user.id
            or appointment.patient_id == request.user.patient_id
        ):
            raise PermissionDenied("You can only cancel your own appointments.")
        if appointment.status != Appointment.Status.SCHEDULED:
            raise ValidationError("Only scheduled appointments can be cancelled.")
        appointment.status = Appointment.Status.CANCELLED
        appointment.save(update_fields=["status", "updated_at"])
        AuditEvent.objects.create(
            organization=appointment.organization,
            actor=request.user,
            action="appointment.cancelled",
            resource_type="Appointment",
            resource_id=str(appointment.pk),
            details={"visit_type": appointment.visit_type},
        )
        return Response(AppointmentSerializer(appointment).data)

    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="link-virtual-session")
    def link_virtual_session(self, request, pk=None):
        appointment = self.get_object()
        if request.user.role not in ("admin", "receptionist", "clinician", "patient"):
            raise PermissionDenied("Your role cannot link a virtual-care session.")
        if request.user.role == "patient" and not (
            appointment.patient.owner_id == request.user.id
            or appointment.patient_id == request.user.patient_id
        ):
            raise PermissionDenied("Shared patient records are read-only.")
        if appointment.visit_type != Appointment.VisitType.VIRTUAL:
            raise ValidationError("Only virtual appointments can link a virtual-care session.")
        session_ref = str(request.data.get("virtual_session_ref", "")).strip()
        if not session_ref:
            raise ValidationError({"virtual_session_ref": "A virtual session ID is required."})
        if appointment.virtual_session_ref and appointment.virtual_session_ref != session_ref:
            raise ValidationError({"virtual_session_ref": "A session is already linked to this appointment."})
        appointment.virtual_session_ref = session_ref
        appointment.save(update_fields=["virtual_session_ref", "updated_at"])
        self._audit_change(appointment, "appointment.virtual_session_linked")
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=True, methods=["post"], url_path="complete-virtual")
    def complete_virtual(self, request, pk=None):
        appointment = self.get_object()
        if request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only a clinician can complete a virtual appointment.")
        if appointment.visit_type != Appointment.VisitType.VIRTUAL:
            raise ValidationError("This is not a virtual appointment.")
        if request.user.role == "clinician" and appointment.clinician.user_id != request.user.id:
            raise PermissionDenied("You can only complete your own virtual appointments.")
        if appointment.status == Appointment.Status.COMPLETED:
            return Response(AppointmentSerializer(appointment).data)
        if appointment.status != Appointment.Status.SCHEDULED:
            raise ValidationError({"status": "Only scheduled virtual appointments can be completed."})
        note = str(request.data.get("note", "")).strip()
        summary = str(request.data.get("summary", "")).strip()
        if not note or not summary:
            raise ValidationError({"note": "A consultation note and visit summary are required."})
        lab_orders = request.data.get("lab_orders", [])
        prescriptions = request.data.get("prescriptions", [])
        session_id = str(request.data.get("virtual_session_id", "")).strip()
        completion_signature = str(request.data.get("completion_signature", "")).strip()
        consent_revision = request.data.get("consent_revision")
        if not appointment.virtual_session_ref or session_id != appointment.virtual_session_ref:
            raise ValidationError({"virtual_session_id": "The linked Virtual Care session is required."})
        try:
            consent_revision = int(consent_revision)
        except (TypeError, ValueError):
            raise ValidationError({"consent_revision": "A valid consent revision is required."})
        if consent_revision < 1:
            raise ValidationError({"consent_revision": "The session must have active patient consent."})
        if not isinstance(lab_orders, list) or not isinstance(prescriptions, list):
            raise ValidationError({"follow_up_actions": "Lab orders and prescriptions must be lists."})
        normalized_lab_orders = []
        for index, item in enumerate(lab_orders):
            if not isinstance(item, dict) or not str(item.get("test_name", "")).strip():
                raise ValidationError({"lab_orders": f"Lab order {index + 1} needs a test name."})
            normalized_lab_orders.append({"test_name": str(item["test_name"]).strip()})
        normalized_prescriptions = []
        for index, item in enumerate(prescriptions):
            if (
                not isinstance(item, dict)
                or not str(item.get("medication", "")).strip()
                or not str(item.get("dosage", "")).strip()
            ):
                raise ValidationError(
                    {"prescriptions": f"Prescription {index + 1} needs a medication and dose."}
                )
            normalized_prescriptions.append({
                "medication": str(item["medication"]).strip(),
                "dosage": str(item["dosage"]).strip(),
                "instructions": str(item.get("instructions", "")).strip(),
            })
        follow_up_date = request.data.get("follow_up_date")
        follow_up_date_value = str(follow_up_date or "")
        follow_up_plan = str(request.data.get("follow_up_plan", "")).strip()
        signature_payload = {
            "appointment_id": str(appointment.pk),
            "session_id": session_id,
            "patient_id": str(appointment.patient_id),
            "clinician_id": str(appointment.clinician_id),
            "consent_revision": consent_revision,
            "note": note,
            "summary": summary,
            "follow_up_plan": follow_up_plan,
            "follow_up_date": follow_up_date_value,
            "lab_orders": normalized_lab_orders,
            "prescriptions": normalized_prescriptions,
        }
        signature_json = json.dumps(signature_payload, sort_keys=True, separators=(",", ":"))
        expected_signature = hmac.new(
            settings.VIRTUALCARE_SYNC_SECRET.encode("utf-8"),
            signature_json.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(completion_signature, expected_signature):
            raise PermissionDenied("The Virtual Care completion signature is invalid.")
        with transaction.atomic():
            encounter, _ = Encounter.objects.get_or_create(
                organization=appointment.organization,
                appointment=appointment,
                defaults={
                    "patient": appointment.patient,
                    "clinician": appointment.clinician,
                    "status": Encounter.Status.SCHEDULED,
                },
            )
            encounter = Encounter.objects.select_for_update().get(pk=encounter.pk)
            if (encounter.patient_id != appointment.patient_id
                    or encounter.clinician_id != appointment.clinician_id):
                raise ValidationError({"encounter": "The encounter must match the appointment."})
            paths = {
                Encounter.Status.SCHEDULED: [
                    Encounter.Status.CHECKED_IN, Encounter.Status.IN_PROGRESS,
                    Encounter.Status.DOCUMENTATION_PENDING, Encounter.Status.COMPLETED,
                ],
                Encounter.Status.CHECKED_IN: [
                    Encounter.Status.IN_PROGRESS, Encounter.Status.DOCUMENTATION_PENDING,
                    Encounter.Status.COMPLETED,
                ],
                Encounter.Status.IN_PROGRESS: [
                    Encounter.Status.DOCUMENTATION_PENDING, Encounter.Status.COMPLETED,
                ],
                Encounter.Status.DOCUMENTATION_PENDING: [Encounter.Status.COMPLETED],
            }
            transition_path = paths.get(encounter.status)
            if transition_path is None:
                raise ValidationError({"status": "The encounter is closed and cannot be completed."})
            note_record, note_created = ClinicalNote.objects.get_or_create(
                organization=appointment.organization,
                encounter=encounter,
                patient=appointment.patient,
                note_type="virtual_care",
                defaults={
                    "author": request.user,
                    "content": f"{note}\n\nVisit summary:\n{summary}",
                    "approved": True,
                },
            )
            if note_created:
                AuditEvent.objects.create(
                    organization=appointment.organization, actor=request.user,
                    action="clinical_note.created", resource_type="ClinicalNote",
                    resource_id=str(note_record.pk), details={"encounter_id": str(encounter.pk)},
                )
            if bool(follow_up_date) != bool(follow_up_plan):
                raise ValidationError(
                    {"follow_up_plan": "Enter both a follow-up date and plan, or leave both blank."}
                )
            if follow_up_date and follow_up_plan:
                from datetime import date, datetime, time

                try:
                    parsed_date = date.fromisoformat(follow_up_date)
                except (TypeError, ValueError):
                    raise ValidationError({"follow_up_date": "Enter a valid follow-up date."})
                FollowUp.objects.get_or_create(
                    organization=appointment.organization,
                    patient=appointment.patient,
                    encounter=encounter,
                    due_at=timezone.make_aware(datetime.combine(parsed_date, time.min)),
                    defaults={"message": follow_up_plan, "completed": False},
                )
                encounter.follow_up_date = parsed_date
                encounter.save(update_fields=["follow_up_date", "updated_at"])
            created_orders = []
            bill_items = []
            total_cents = 0
            for item in normalized_lab_orders:
                test_name = str(item["test_name"]).strip()
                catalog_test = LabTest.objects.select_for_update().filter(
                    organization=appointment.organization, name__iexact=test_name, active=True
                ).first()
                if not catalog_test:
                    raise ValidationError({"lab_orders": f"'{test_name}' is not an active catalog test."})
                order = LabOrder.objects.create(
                    organization=appointment.organization,
                    encounter=encounter,
                    patient=appointment.patient,
                    test_name=catalog_test.name,
                    price_cents=catalog_test.price_cents,
                    status=LabOrder.Status.AWAITING_PAYMENT,
                    ordered_by=request.user,
                )
                created_orders.append(order)
                bill_items.append(
                    {"description": f"Lab Investigation: {catalog_test.name}", "amount_cents": catalog_test.price_cents}
                )
                total_cents += catalog_test.price_cents
            if created_orders:
                lab_bill = Bill.objects.create(
                    organization=appointment.organization,
                    patient=appointment.patient,
                    encounter=encounter,
                    invoice_number=f"INV-LAB-{uuid.uuid4().hex[:10].upper()}",
                    items=bill_items,
                    total_cents=total_cents,
                    status="unpaid",
                    care_type=Bill.CareType.OPD,
                )
                LabOrder.objects.filter(pk__in=[order.pk for order in created_orders]).update(
                    bill=lab_bill
                )
            for item in normalized_prescriptions:
                Prescription.objects.create(
                    organization=appointment.organization,
                    encounter=encounter,
                    patient=appointment.patient,
                    medication=str(item["medication"]).strip(),
                    dosage=str(item["dosage"]).strip(),
                    instructions=str(item.get("instructions", "")).strip(),
                    authorized_by=request.user,
                )
            for next_status in transition_path:
                previous_status = encounter.status
                encounter.status = next_status
                encounter.save(update_fields=["status", "updated_at"])
                AuditEvent.objects.create(
                    organization=appointment.organization, actor=request.user,
                    action="encounter.transition", resource_type="Encounter",
                    resource_id=str(encounter.pk), details={"from": previous_status, "to": next_status},
                )
            appointment.patient.assigned_clinician = appointment.clinician
            appointment.patient.is_opd = True
            appointment.patient.opd_status = "completed"
            appointment.patient.save(
                update_fields=["assigned_clinician", "is_opd", "opd_status", "updated_at"]
            )
            appointment.status = Appointment.Status.COMPLETED
            appointment.save(update_fields=["status", "updated_at"])
            AuditEvent.objects.create(
                organization=appointment.organization,
                actor=request.user,
                action="virtual_appointment.completed",
                resource_type="Appointment",
                resource_id=str(appointment.pk),
                details={
                    "encounter_id": str(encounter.pk),
                    "lab_order_count": len(created_orders),
                    "prescription_count": len(prescriptions),
                },
            )
        return Response(AppointmentSerializer(appointment).data)


class EncounterViewSet(TenantViewSet):
    """
    Encounter with full state-machine transition validation.
    """

    queryset = Encounter.objects.all().order_by("-created_at")
    serializer_class = EncounterSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        patient_id = self.request.query_params.get("patient")
        status_filter = self.request.query_params.get("status")
        if patient_id:
            qs = qs.filter(patient_id=patient_id)
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians can open encounters.")
        patient = serializer.validated_data["patient"]
        clinician = serializer.validated_data["clinician"]
        if patient.organization_id != self.request.user.organization_id or clinician.organization_id != self.request.user.organization_id:
            raise ValidationError("Patient and clinician must belong to your organization.")
        if self.request.user.role == "clinician" and clinician.user_id != self.request.user.id:
            raise PermissionDenied("You can only open encounters assigned to you.")
        if self.request.user.role == "clinician" and patient.assigned_clinician_id != clinician.id:
            raise PermissionDenied("You can only open encounters for patients assigned to you.")
        if patient.assigned_clinician_id and patient.assigned_clinician_id != clinician.id:
            raise ValidationError("Encounter clinician must match the patient's assigned clinician.")
        encounter = serializer.save(organization=self.request.user.organization)
        self._audit_change(encounter, "encounter.created")

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians can update encounters.")
        if serializer.instance.status in (
            Encounter.Status.COMPLETED, Encounter.Status.CANCELLED, Encounter.Status.ENTERED_IN_ERROR
        ):
            raise ValidationError({"status": "This encounter is closed and cannot be changed."})
        fields = sorted(set(serializer.validated_data) - {"organization"})
        encounter = serializer.save()
        self._audit_change(encounter, "encounter.updated", {"fields": fields})

    # Valid state transitions
    TRANSITIONS = {
        Encounter.Status.SCHEDULED: [
            Encounter.Status.CHECKED_IN,
            Encounter.Status.CANCELLED,
        ],
        Encounter.Status.CHECKED_IN: [
            Encounter.Status.IN_PROGRESS,
            Encounter.Status.CANCELLED,
        ],
        Encounter.Status.IN_PROGRESS: [
            Encounter.Status.DOCUMENTATION_PENDING,
            Encounter.Status.ENTERED_IN_ERROR,
        ],
        Encounter.Status.DOCUMENTATION_PENDING: [
            Encounter.Status.COMPLETED,
            Encounter.Status.ENTERED_IN_ERROR,
        ],
        Encounter.Status.COMPLETED: [],
        Encounter.Status.CANCELLED: [],
        Encounter.Status.ENTERED_IN_ERROR: [],
    }

    @transaction.atomic
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """
        Advance or revert an encounter's status through the state machine.
        Completing an encounter requires at least one clinical note.
        """
        encounter = self.get_object()
        encounter = Encounter.objects.select_for_update().get(pk=encounter.pk)
        if request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians can change encounter status.")
        if request.user.role == "clinician" and encounter.clinician.user_id != request.user.id:
            raise PermissionDenied("You can only change your assigned encounters.")
        target = request.data.get("status")
        if not target:
            raise ValidationError({"status": "Target status is required."})

        allowed = self.TRANSITIONS.get(encounter.status, [])
        if target not in allowed:
            raise ValidationError(
                {
                    "status": (
                        f"Transition '{encounter.status}' → '{target}' is not allowed. "
                        f"Allowed targets: {allowed or 'none'}"
                    )
                }
            )

        # Completion gate: clinical note required
        if target == Encounter.Status.COMPLETED:
            has_note = ClinicalNote.objects.filter(
                organization=encounter.organization,
                encounter=encounter,
                patient=encounter.patient,
            ).exists()
            if not has_note:
                raise ValidationError(
                    {"status": "A clinical note is required before completing an encounter."}
                )

        previous_status = encounter.status
        encounter.status = target
        encounter.save(update_fields=["status", "updated_at"])
        AuditEvent.objects.create(
            organization=encounter.organization,
            actor=request.user,
            action="encounter.transition",
            resource_type="Encounter",
            resource_id=str(encounter.pk),
            details={"from": previous_status, "to": target},
        )
        return Response(EncounterSerializer(encounter).data)

    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="save-consultation")
    def save_consultation(self, request, pk=None):
        """
        Saves structured clinical history:
        - History of Present Illness (HPI)
        - Past Medical History (PMH)
        - History of Surgery (PSH)
        - Follow-up date / days
        - Automatically creates/updates ClinicalNote and FollowUp reminder
        """
        from datetime import timedelta
        from django.utils.dateparse import parse_date
        encounter = self.get_object()
        encounter = Encounter.objects.select_for_update().get(pk=encounter.pk)
        if request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians can document consultations.")
        if request.user.role == "clinician" and encounter.clinician.user_id != request.user.id:
            raise PermissionDenied("You can only document your assigned encounters.")
        if encounter.status in (Encounter.Status.COMPLETED, Encounter.Status.CANCELLED, Encounter.Status.ENTERED_IN_ERROR):
            raise ValidationError({"status": "This encounter is closed and cannot be changed."})
        if encounter.status == Encounter.Status.SCHEDULED:
            raise ValidationError({"status": "Check in the encounter before documenting the consultation."})
        complete = request.data.get("complete", False)
        if not Vital.objects.filter(
            Q(encounter=encounter)
            | Q(encounter__isnull=True, created_at__gte=encounter.created_at),
            organization=encounter.organization,
            patient=encounter.patient,
        ).exists():
            raise ValidationError({"vitals": "Nursing vitals must be recorded before consultation."})
        data = request.data

        hpi = data.get("history_of_present_illness", "").strip()
        pmh = data.get("past_medical_history", "").strip()
        psh = data.get("history_of_surgery", "").strip()
        follow_up_date_str = data.get("follow_up_date")
        follow_up_days = data.get("follow_up_days")
        encounter.history_of_present_illness = hpi
        encounter.past_medical_history = pmh
        encounter.history_of_surgery = psh

        # Calculate follow_up_date if days provided
        due_at = None
        if follow_up_days not in (None, ""):
            try:
                days = int(follow_up_days)
            except (ValueError, TypeError):
                raise ValidationError({"follow_up_days": "Enter a whole number of days."})
            if days < 0 or days > 3650:
                raise ValidationError({"follow_up_days": "Follow-up days must be between 0 and 3650."})
            encounter.follow_up_days = days
            due_at = timezone.now() + timedelta(days=days)
            encounter.follow_up_date = due_at.date()
        elif follow_up_date_str:
            parsed_d = parse_date(follow_up_date_str)
            if not parsed_d or parsed_d < timezone.localdate():
                raise ValidationError({"follow_up_date": "Enter a valid future follow-up date."})
            encounter.follow_up_date = parsed_d
            due_at = timezone.make_aware(
                timezone.datetime.combine(parsed_d, timezone.datetime.min.time())
            )

        # Create ClinicalNote to satisfy completion gate & persist history
        content = (
            data.get("content")
            or f"Consultation Record:\n"
            f"• History of Present Illness: {hpi or 'Non-contributory'}\n"
            f"• Past Medical History: {pmh or 'None reported'}\n"
            f"• History of Surgery: {psh or 'None'}"
        )

        note = ClinicalNote.objects.create(
            organization=encounter.organization,
            encounter=encounter,
            patient=encounter.patient,
            author=request.user,
            note_type="consultation",
            content=content,
            history_of_present_illness=hpi,
            past_medical_history=pmh,
            history_of_surgery=psh,
            approved=True,
        )
        AuditEvent.objects.create(
            organization=encounter.organization, actor=request.user,
            action="clinical_note.created", resource_type="ClinicalNote",
            resource_id=str(note.pk), details={"encounter_id": str(encounter.pk)},
        )

        # Create FollowUp if follow-up day was entered
        if due_at:
            doc_name = (
                encounter.clinician.name
                or (f"Dr. {encounter.clinician.user.get_full_name()}" if encounter.clinician.user else "Attending Clinician")
            )
            msg = data.get("follow_up_message") or f"OPD Follow-up Consultation with {doc_name}"
            FollowUp.objects.get_or_create(
                organization=encounter.organization,
                patient=encounter.patient,
                encounter=encounter,
                due_at=due_at,
                defaults={"message": msg, "completed": False},
            )

        if complete:
            transition_path = {
                Encounter.Status.CHECKED_IN: [
                    Encounter.Status.IN_PROGRESS,
                    Encounter.Status.DOCUMENTATION_PENDING,
                    Encounter.Status.COMPLETED,
                ],
                Encounter.Status.IN_PROGRESS: [
                    Encounter.Status.DOCUMENTATION_PENDING,
                    Encounter.Status.COMPLETED,
                ],
                Encounter.Status.DOCUMENTATION_PENDING: [Encounter.Status.COMPLETED],
            }
            next_statuses = transition_path.get(encounter.status)
            if next_statuses is None:
                raise ValidationError({"status": "This encounter cannot be completed from its current status."})
            previous_status = encounter.status
            for next_status in next_statuses:
                encounter.status = next_status
                encounter.save(update_fields=["status", "updated_at"])
                AuditEvent.objects.create(
                    organization=encounter.organization,
                    actor=request.user,
                    action="encounter.transition",
                    resource_type="Encounter",
                    resource_id=str(encounter.pk),
                    details={"from": previous_status, "to": next_status},
                )
                previous_status = next_status
            if encounter.patient.is_opd:
                encounter.patient.opd_status = "completed"
                encounter.patient.save(update_fields=["opd_status", "updated_at"])
        elif encounter.status == Encounter.Status.CHECKED_IN:
            previous_status = encounter.status
            encounter.status = Encounter.Status.IN_PROGRESS
            AuditEvent.objects.create(
                organization=encounter.organization,
                actor=request.user,
                action="encounter.transition",
                resource_type="Encounter",
                resource_id=str(encounter.pk),
                details={"from": previous_status, "to": encounter.status},
            )
            if encounter.patient.is_opd and encounter.patient.opd_status in ("registered", "vitals_recorded"):
                encounter.patient.opd_status = "in_consultation"
                encounter.patient.save(update_fields=["opd_status", "updated_at"])

        encounter.save()
        return Response(EncounterSerializer(encounter).data)


class VitalViewSet(TenantViewSet):
    queryset = Vital.objects.all().order_by("-created_at")
    serializer_class = VitalSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("patient"):
            qs = qs.filter(patient_id=self.request.query_params["patient"])
        if self.request.query_params.get("encounter"):
            qs = qs.filter(encounter_id=self.request.query_params["encounter"])
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("nurse", "admin"):
            raise PermissionDenied("Only OPD nursing staff can record vitals.")
        patient = serializer.validated_data["patient"]
        encounter = serializer.validated_data.get("encounter")
        if patient.organization_id != self.request.user.organization_id:
            raise ValidationError({"patient": "Patient must belong to your organization."})
        if encounter and (
            encounter.organization_id != patient.organization_id
            or encounter.patient_id != patient.id
        ):
            raise ValidationError({"encounter": "Encounter must belong to the selected patient and organization."})
        vital = serializer.save(
            organization=self.request.user.organization,
            recorded_by=self.request.user,
        )
        AuditEvent.objects.create(
            organization=vital.organization,
            actor=self.request.user,
            action="vitals.recorded",
            resource_type="Vital",
            resource_id=str(vital.pk),
            details={"patient_id": str(vital.patient_id)},
        )
        # Advance patient OPD status to vitals_recorded
        if vital.patient and vital.patient.is_opd and vital.patient.opd_status == "registered":
            vital.patient.opd_status = "vitals_recorded"
            vital.patient.save(update_fields=["opd_status", "updated_at"])


class ClinicalNoteViewSet(TenantViewSet):
    queryset = ClinicalNote.objects.all().order_by("-created_at")
    serializer_class = ClinicalNoteSerializer
    http_method_names = ["get", "post", "head", "options"]

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may author clinical notes.")
        encounter = serializer.validated_data["encounter"]
        patient = serializer.validated_data["patient"]
        if encounter.organization_id != self.request.user.organization_id or encounter.patient_id != patient.id:
            raise ValidationError("Clinical note must match the patient and encounter in your organization.")
        if self.request.user.role == "clinician" and encounter.clinician.user_id != self.request.user.id:
            raise PermissionDenied("You can only document your assigned encounters.")
        original = serializer.validated_data.get("amended_from")
        if original and (
            original.organization_id != encounter.organization_id
            or original.encounter_id != encounter.id
            or original.patient_id != patient.id
        ):
            raise ValidationError({"amended_from": "The original note must belong to this patient and encounter."})
        note = serializer.save(
            organization=self.request.user.organization, author=self.request.user
        )
        AuditEvent.objects.create(
            organization=note.organization, actor=self.request.user,
            action="clinical_note.created", resource_type="ClinicalNote",
            resource_id=str(note.pk), details={
                "encounter_id": str(encounter.pk),
                "amended_from": str(original.pk) if original else None,
            },
        )


class DiagnosisViewSet(TenantViewSet):
    queryset = Diagnosis.objects.all().order_by("-created_at")
    serializer_class = DiagnosisSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    @transaction.atomic
    def perform_create(self, serializer):
        self._save_clinical_record(serializer, "diagnosis.created")

    @transaction.atomic
    def perform_update(self, serializer):
        self._save_clinical_record(serializer, "diagnosis.updated")

    def _save_clinical_record(self, serializer, action_name):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may manage diagnoses.")
        instance = serializer.instance
        patient = serializer.validated_data.get("patient", getattr(instance, "patient", None))
        encounter = serializer.validated_data.get("encounter", getattr(instance, "encounter", None))
        if (patient.organization_id != self.request.user.organization_id
                or encounter.organization_id != patient.organization_id
                or encounter.patient_id != patient.id):
            raise ValidationError("Diagnosis must match the patient and encounter in your organization.")
        if self.request.user.role == "clinician" and (
            encounter.clinician.user_id != self.request.user.id
            or patient.assigned_clinician_id != encounter.clinician_id
        ):
            raise PermissionDenied("You can only document your assigned encounters.")
        if instance and (instance.patient_id != patient.id or instance.encounter_id != encounter.id):
            raise ValidationError("A diagnosis cannot be moved to another patient or encounter.")
        record = serializer.save(organization=self.request.user.organization)
        AuditEvent.objects.create(
            organization=record.organization, actor=self.request.user, action=action_name,
            resource_type="Diagnosis", resource_id=str(record.pk),
            details={"encounter_id": str(encounter.pk)},
        )


class CarePlanViewSet(TenantViewSet):
    queryset = CarePlan.objects.all().order_by("-created_at")
    serializer_class = CarePlanSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    @transaction.atomic
    def perform_create(self, serializer):
        self._save_care_plan(serializer, "care_plan.created")

    @transaction.atomic
    def perform_update(self, serializer):
        self._save_care_plan(serializer, "care_plan.updated")

    def _save_care_plan(self, serializer, action_name):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may manage care plans.")
        instance = serializer.instance
        patient = serializer.validated_data.get("patient", getattr(instance, "patient", None))
        encounter = serializer.validated_data.get("encounter", getattr(instance, "encounter", None))
        if (patient.organization_id != self.request.user.organization_id
                or encounter.organization_id != patient.organization_id
                or encounter.patient_id != patient.id):
            raise ValidationError("Care plan must match the patient and encounter in your organization.")
        if self.request.user.role == "clinician" and (
            encounter.clinician.user_id != self.request.user.id
            or patient.assigned_clinician_id != encounter.clinician_id
        ):
            raise PermissionDenied("You can only document your assigned encounters.")
        if instance and (instance.patient_id != patient.id or instance.encounter_id != encounter.id):
            raise ValidationError("A care plan cannot be moved to another patient or encounter.")
        plan = serializer.save(
            organization=self.request.user.organization,
            approved_by=self.request.user,
        )
        AuditEvent.objects.create(
            organization=plan.organization, actor=self.request.user, action=action_name,
            resource_type="CarePlan", resource_id=str(plan.pk),
            details={"encounter_id": str(encounter.pk)},
        )


class LabOrderViewSet(TenantViewSet):
    queryset = LabOrder.objects.all().order_by("-created_at")
    serializer_class = LabOrderSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        patient_id = self.request.query_params.get("patient")
        encounter_id = self.request.query_params.get("encounter")
        admission_id = self.request.query_params.get("admission")
        if patient_id:
            qs = qs.filter(patient_id=patient_id)
        if encounter_id:
            qs = qs.filter(encounter_id=encounter_id)
        if admission_id:
            qs = qs.filter(admission_id=admission_id)
        if self.request.user.role == "lab":
            qs = qs.filter(status=LabOrder.Status.ORDERED).filter(
                Q(bill__isnull=True) | Q(bill__status="paid")
            )
        return qs

    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may order laboratory tests.")
        patient = serializer.validated_data["patient"]
        encounter = serializer.validated_data.get("encounter")
        if patient.organization_id != self.request.user.organization_id:
            raise ValidationError({"patient": "Patient must belong to your organization."})
        if not encounter:
            raise ValidationError({"encounter": "An encounter is required for laboratory investigations."})
        if (
            encounter.organization_id != patient.organization_id
            or encounter.patient_id != patient.id
        ):
            raise ValidationError({"encounter": "Encounter must belong to the selected patient and organization."})
        admission = serializer.validated_data.get("admission")
        if admission and (
            admission.organization_id != patient.organization_id or admission.patient_id != patient.id
        ):
            raise ValidationError({"admission": "Admission must belong to the selected patient and organization."})
        if self.request.user.role == "clinician" and (
            encounter.clinician.user_id != self.request.user.id
            or patient.assigned_clinician_id != encounter.clinician_id
        ):
            raise PermissionDenied("You can only order tests for patients assigned to you.")
        import uuid
        with transaction.atomic():
            catalog_test = LabTest.objects.select_for_update().filter(
                organization=self.request.user.organization,
                name__iexact=serializer.validated_data["test_name"].strip(),
            ).first()
            if not catalog_test or not catalog_test.active:
                raise ValidationError({"test_name": "Select an active test from the laboratory catalog."})
            price = catalog_test.price_cents
            bill = Bill.objects.create(
                organization=self.request.user.organization,
                patient=patient,
                encounter=encounter,
                invoice_number=f"INV-LAB-{uuid.uuid4().hex[:10].upper()}",
                items=[{
                    "description": f"Lab Investigation: {serializer.validated_data['test_name']}",
                    "amount_cents": price,
                }],
                total_cents=price,
                status="unpaid",
            )
            order = serializer.save(
                organization=self.request.user.organization,
                ordered_by=self.request.user,
                test_name=catalog_test.name,
                price_cents=price,
                status=LabOrder.Status.AWAITING_PAYMENT,
                bill=bill,
            )
            self._audit_change(order, "lab.ordered", {"bill_id": str(bill.pk)})

    @action(detail=False, methods=["post"], url_path="batch-order")
    def batch_order(self, request):
        """
        Orders multiple laboratory investigations in a single transaction,
        generates the itemized lab test bill, and updates patient status.
        """
        import uuid
        if request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may order laboratory investigations.")

        patient_id = request.data.get("patient")
        encounter_id = request.data.get("encounter")
        admission_id = request.data.get("admission")
        investigations = request.data.get("investigations", [])

        if not patient_id:
            raise ValidationError({"patient": "Patient ID is required."})
        if not investigations:
            raise ValidationError({"investigations": "At least one investigation is required."})

        patient = Patient.objects.filter(id=patient_id, organization=request.user.organization).first()
        if not patient:
            raise ValidationError({"patient": "Patient not found in your organization."})
        encounter = None
        admission = None
        if admission_id:
            admission = InpatientAdmission.objects.filter(
                pk=admission_id,
                patient=patient,
                organization=request.user.organization,
                discharged_at__isnull=True,
            ).first()
            if not admission:
                raise ValidationError({"admission": "Select an active inpatient admission for this patient."})
        elif not encounter_id:
            raise ValidationError({"encounter": "An encounter or inpatient admission is required."})
        if encounter_id:
            encounter = Encounter.objects.filter(
                id=encounter_id, organization=request.user.organization
            ).first()
            if not encounter:
                raise ValidationError({"encounter": "Encounter not found in your organization."})
        if encounter and encounter.patient_id != patient.id:
            raise ValidationError({"encounter": "Encounter must belong to the selected patient."})
        if request.user.role == "clinician":
            if admission:
                if not clinician_can_document_admission(request.user, admission):
                    raise PermissionDenied("You can only order tests for your assigned inpatients.")
            else:
                clinician = Clinician.objects.filter(
                    user=request.user, organization=request.user.organization
                ).first()
                if not clinician or patient.assigned_clinician_id != clinician.id:
                    raise PermissionDenied("Patient is not assigned to you.")
                if encounter.clinician_id != clinician.id:
                    raise PermissionDenied("You can only order tests for your assigned encounters.")

        created_orders = []
        bill_items = []
        total_test_cents = 0

        with transaction.atomic():
            for item in investigations:
                test_name = item.get("test_name", "").strip()
                if not test_name:
                    continue
                catalog_test = LabTest.objects.select_for_update().filter(
                    organization=request.user.organization, name__iexact=test_name
                ).first()
                if not catalog_test or not catalog_test.active:
                    raise ValidationError({"investigations": f"'{test_name}' is not an active catalog test."})
                test_name = catalog_test.name
                price_cents = catalog_test.price_cents
                order = LabOrder.objects.create(
                    organization=request.user.organization,
                    patient=patient,
                    encounter=encounter,
                    admission=admission,
                    test_name=test_name,
                    price_cents=price_cents,
                    status=LabOrder.Status.AWAITING_PAYMENT,
                    ordered_by=request.user,
                )
                created_orders.append(order)
                bill_items.append({
                    "description": f"Lab Investigation: {test_name}",
                    "amount_cents": price_cents,
                })
                total_test_cents += price_cents

            # Generate itemized bill for tests
            bill = None
            if bill_items:
                inv_num = f"INV-LAB-{uuid.uuid4().hex[:10].upper()}"
                bill = Bill.objects.create(
                    organization=request.user.organization,
                    patient=patient,
                    encounter=encounter,
                    invoice_number=inv_num,
                    items=bill_items,
                    total_cents=total_test_cents,
                    status="unpaid",
                    care_type=Bill.CareType.IPD if admission else Bill.CareType.OPD,
                )
                LabOrder.objects.filter(pk__in=[o.pk for o in created_orders]).update(bill=bill)

            # Update patient OPD status to investigations_pending
            if not created_orders:
                raise ValidationError({"investigations": "Enter at least one valid investigation."})
            if not admission and patient.is_opd:
                patient.opd_status = "investigations_pending"
                patient.save(update_fields=["opd_status", "updated_at"])

            # Audit Event
            AuditEvent.objects.create(
                organization=request.user.organization,
                actor=request.user,
                action="lab.batch_order",
                resource_type="LabOrder",
                resource_id=str(patient.id),
                details={
                    "tests": [o.test_name for o in created_orders],
                    "total_cents": total_test_cents,
                    "bill_id": str(bill.id) if bill else None,
                },
            )

        return Response({
            "status": "success",
            "message": f"{len(created_orders)} investigations ordered and billed successfully.",
            "orders": LabOrderSerializer(created_orders, many=True).data,
            "bill_id": str(bill.id) if bill else None,
            "total_cents": total_test_cents,
        })

    @transaction.atomic
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        if request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may review results.")
        visible_order = self.get_object()
        order = LabOrder.objects.select_for_update().get(pk=visible_order.pk)
        if request.user.role == "clinician":
            if order.encounter_id and order.encounter.clinician.user_id != request.user.id:
                raise PermissionDenied("You can only review your assigned encounters.")
            if order.admission_id and not clinician_can_document_admission(request.user, order.admission):
                raise PermissionDenied("You can only review your assigned admissions.")
        if order.status != LabOrder.Status.RESULTED or not order.labresult_set.exists():
            raise ValidationError({"status": "An unreviewed result is required."})
        order.status = LabOrder.Status.REVIEWED
        order.save(update_fields=["status", "updated_at"])
        AuditEvent.objects.create(
            organization=order.organization, actor=request.user,
            action="lab.result_reviewed", resource_type="LabOrder",
            resource_id=str(order.pk), details={"patient_id": str(order.patient_id)},
        )
        return Response(self.get_serializer(order).data)


class LabResultViewSet(TenantViewSet):
    queryset = LabResult.objects.all().order_by("-created_at")
    serializer_class = LabResultSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("patient"):
            qs = qs.filter(patient_id=self.request.query_params["patient"])
        if self.request.query_params.get("order"):
            qs = qs.filter(order_id=self.request.query_params["order"])
        if self.request.query_params.get("encounter"):
            qs = qs.filter(order__encounter_id=self.request.query_params["encounter"])
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("lab", "admin"):
            raise PermissionDenied("Only laboratory staff may enter results.")
        order = LabOrder.objects.select_for_update().get(pk=serializer.validated_data["order"].pk)
        patient = serializer.validated_data["patient"]
        if (
            order.patient_id != patient.id
            or order.organization_id != self.request.user.organization_id
        ):
            raise ValidationError(
                "Lab result must match the ordered patient and tenant."
            )
        original = serializer.validated_data.get("amended_from")
        if original:
            latest = order.labresult_set.order_by("-created_at", "-pk").first()
            if (order.status not in (LabOrder.Status.RESULTED, LabOrder.Status.REVIEWED)
                    or not latest or original.pk != latest.pk
                    or original.patient_id != patient.pk
                    or original.organization_id != order.organization_id):
                raise ValidationError({"amended_from": "Select the latest result for this order and patient."})
        elif order.status != LabOrder.Status.ORDERED:
            raise ValidationError({"order": "The investigation must be paid and released before result entry."})
        serializer.save(
            organization=self.request.user.organization, entered_by=self.request.user
        )
        order.status = LabOrder.Status.RESULTED
        order.save(update_fields=["status", "updated_at"])
        AuditEvent.objects.create(
            organization=order.organization,
            actor=self.request.user,
            action="lab.result_entered",
            resource_type="LabResult",
            resource_id=str(serializer.instance.pk),
            details={"order_id": str(order.pk), "patient_id": str(patient.pk),
                     "amended_from": str(original.pk) if original else None},
        )


class PrescriptionViewSet(TenantViewSet):
    queryset = Prescription.objects.all().order_by("-created_at")
    serializer_class = PrescriptionSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("patient"):
            qs = qs.filter(patient_id=self.request.query_params["patient"])
        if self.request.query_params.get("encounter"):
            qs = qs.filter(encounter_id=self.request.query_params["encounter"])
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may authorize prescriptions.")
        patient = serializer.validated_data["patient"]
        encounter = serializer.validated_data["encounter"]
        if (
            patient.organization_id != self.request.user.organization_id
            or encounter.organization_id != self.request.user.organization_id
            or encounter.patient_id != patient.id
        ):
            raise ValidationError("Prescription encounter and patient must match within your organization.")
        if self.request.user.role == "clinician" and encounter.clinician.user_id != self.request.user.id:
            raise PermissionDenied("You can only prescribe for your assigned encounters.")
        if self.request.user.role == "clinician" and patient.assigned_clinician_id != encounter.clinician_id:
            raise PermissionDenied("Patient is not assigned to this clinician.")
        medication = serializer.validated_data["medication"].strip()
        if Medication.objects.filter(
            organization=self.request.user.organization, name__iexact=medication, active=False
        ).exists():
            raise ValidationError({"medication": "This medication is inactive."})
        prescription = serializer.save(
            organization=self.request.user.organization,
            authorized_by=self.request.user,
            medication=medication,
        )
        AuditEvent.objects.create(
            organization=prescription.organization, actor=self.request.user,
            action="prescription.authorized", resource_type="Prescription",
            resource_id=str(prescription.pk), details={"encounter_id": str(encounter.pk)},
        )

    @action(detail=False, methods=["post"], url_path="batch-prescribe")
    def batch_prescribe(self, request):
        if request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may authorize prescriptions.")
        patient = Patient.objects.filter(
            id=request.data.get("patient"),
            organization=request.user.organization,
        ).first()
        encounter = Encounter.objects.filter(
            id=request.data.get("encounter"),
            organization=request.user.organization,
            patient=patient,
        ).first() if patient else None
        if not patient or not encounter:
            raise ValidationError({"encounter": "Select an encounter belonging to this patient and organization."})
        if request.user.role == "clinician" and encounter.clinician.user_id != request.user.id:
            raise PermissionDenied("You can only prescribe for your assigned encounters.")
        if request.user.role == "clinician" and patient.assigned_clinician_id != encounter.clinician_id:
            raise PermissionDenied("Patient is not assigned to this clinician.")
        prescriptions = request.data.get("prescriptions")
        if not isinstance(prescriptions, list) or not prescriptions:
            raise ValidationError({"prescriptions": "Add at least one medication."})
        created = []
        with transaction.atomic():
            for index, item in enumerate(prescriptions):
                if not isinstance(item, dict):
                    raise ValidationError({"prescriptions": f"Medication row {index + 1} is invalid."})
                medication = str(item.get("medication", "")).strip()
                dosage = str(item.get("dosage", "")).strip()
                if not medication or not dosage:
                    raise ValidationError({"prescriptions": f"Medication and dosage are required on row {index + 1}."})
                if Medication.objects.filter(
                    organization=request.user.organization, name__iexact=medication, active=False
                ).exists():
                    raise ValidationError({"prescriptions": f"Medication on row {index + 1} is inactive."})
                created.append(Prescription.objects.create(
                    organization=request.user.organization,
                    patient=patient,
                    encounter=encounter,
                    medication=medication,
                    dosage=dosage,
                    instructions=str(item.get("instructions", "")).strip(),
                    authorized_by=request.user,
                ))
            AuditEvent.objects.create(
                organization=request.user.organization,
                actor=request.user,
                action="prescription.batch_authorized",
                resource_type="Prescription",
                resource_id=str(encounter.id),
                details={"prescription_ids": [str(item.id) for item in created]},
            )
        return Response(
            {"prescriptions": PrescriptionSerializer(created, many=True).data},
            status=status.HTTP_201_CREATED,
        )

    @transaction.atomic
    @action(detail=True, methods=["post"])
    def dispense(self, request, pk=None):
        """Mark a prescription as dispensed (pharmacist / admin only)."""
        if request.user.role not in ("pharmacist", "admin"):
            raise PermissionDenied("Only pharmacy staff may dispense prescriptions.")
        prescription = self.get_object()
        prescription = Prescription.objects.select_for_update().get(pk=prescription.pk)
        if prescription.status != "authorized":
            raise ValidationError("Only authorized prescriptions may be dispensed.")
        prescription.status = "dispensed"
        prescription.dispensed_at = timezone.now()
        prescription.save(update_fields=["status", "dispensed_at", "updated_at"])
        AuditEvent.objects.create(
            organization=prescription.organization, actor=request.user,
            action="prescription.dispensed", resource_type="Prescription",
            resource_id=str(prescription.pk), details={},
        )
        return Response(PrescriptionSerializer(prescription).data)


class ReferralViewSet(TenantViewSet):
    queryset = Referral.objects.all().order_by("-created_at")
    serializer_class = ReferralSerializer


class InpatientAdmissionViewSet(TenantViewSet):
    queryset = InpatientAdmission.objects.all().order_by("-admitted_at")
    serializer_class = InpatientAdmissionSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            "patient", "bed__ward", "clinician__user"
        ).prefetch_related("room_charges")
        patient_id = self.request.query_params.get("patient")
        if patient_id:
            qs = qs.filter(patient_id=patient_id)
        admission_status = self.request.query_params.get("status")
        if admission_status == "discharged":
            qs = qs.filter(discharged_at__isnull=False)
        elif admission_status != "all":
            qs = qs.filter(discharged_at__isnull=True)
        return qs

    def list(self, request, *args, **kwargs):
        for admission in self.filter_queryset(self.get_queryset()).iterator(chunk_size=100):
            if admission.discharged_at is None:
                accrue_room_charges(admission)
        return super().list(request, *args, **kwargs)

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may update inpatient history or diagnosis.")
        if self.request.user.role == "clinician" and not clinician_can_document_admission(
            self.request.user, serializer.instance
        ):
            raise PermissionDenied("You can only update records for your assigned patients.")
        fields = sorted(set(serializer.validated_data) - {"organization"})
        admission = serializer.save()
        self._audit_change(admission, "inpatient.updated", {"fields": fields})

    @action(detail=True, methods=["post"])
    def discharge(self, request, pk=None):
        if request.user.role not in ("nurse", "clinician", "admin"):
            raise PermissionDenied("Only clinical staff may discharge an inpatient.")
        admission = self.get_object()
        if request.user.role == "clinician" and not clinician_can_document_admission(
            request.user, admission
        ):
            raise PermissionDenied("You can only discharge your assigned patients.")
        admission = discharge_admission(admission, request.user)
        return Response(self.get_serializer(admission).data)


class InpatientMedicationPlanViewSet(TenantViewSet):
    queryset = InpatientMedicationPlan.objects.all().order_by("-created_at")
    serializer_class = InpatientMedicationPlanSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            "admission__patient", "admission__bed__ward", "prescribed_by"
        )
        admission_id = self.request.query_params.get("admission")
        if admission_id:
            qs = qs.filter(admission_id=admission_id)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may add inpatient medication plans.")
        admission = serializer.validated_data["admission"]
        if (
            admission.organization_id != self.request.user.organization_id
            or admission.discharged_at is not None
        ):
            raise ValidationError({"admission": "Select an active admission in your organization."})
        if self.request.user.role == "clinician" and not clinician_can_document_admission(
            self.request.user, admission
        ):
            raise PermissionDenied("You can only prescribe for your assigned patients.")
        plan = serializer.save(
            organization=self.request.user.organization,
            prescribed_by=self.request.user,
        )
        self._audit_change(plan, "inpatient.medication_plan_created")

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may update inpatient medication plans.")
        admission = serializer.validated_data.get(
            "admission", serializer.instance.admission
        )
        if admission != serializer.instance.admission:
            raise ValidationError({"admission": "A medication plan cannot be moved to another admission."})
        if self.request.user.role == "clinician" and not clinician_can_document_admission(
            self.request.user, admission
        ):
            raise PermissionDenied("You can only prescribe for your assigned patients.")
        fields = sorted(set(serializer.validated_data) - {"organization"})
        plan = serializer.save()
        self._audit_change(plan, "inpatient.medication_plan_updated", {"fields": fields})

    @action(detail=False, methods=["post"], url_path="batch-create")
    @transaction.atomic
    def batch_create(self, request):
        if request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may add inpatient medication plans.")
        admission = InpatientAdmission.objects.filter(
            pk=request.data.get("admission"),
            organization=request.user.organization,
            discharged_at__isnull=True,
        ).first()
        if not admission:
            raise ValidationError({"admission": "Select an active admission in your organization."})
        if request.user.role == "clinician" and not clinician_can_document_admission(
            request.user, admission
        ):
            raise PermissionDenied("You can only prescribe for your assigned patients.")
        rows = request.data.get("plans")
        if not isinstance(rows, list) or not rows:
            raise ValidationError({"plans": "Add at least one medication plan."})
        plans = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValidationError({"plans": f"Plan row {index + 1} is invalid."})
            medication = str(row.get("medication", "")).strip()
            dosage = str(row.get("dosage", "")).strip()
            if not medication or not dosage:
                raise ValidationError({"plans": f"Plan row {index + 1} needs a medication and dose."})
            plans.append(InpatientMedicationPlan(
                organization=request.user.organization,
                admission=admission,
                medication=medication,
                dosage=dosage,
                frequency=str(row.get("frequency", "")).strip(),
                instructions=str(row.get("instructions", "")).strip(),
                prescribed_by=request.user,
            ))
        created = InpatientMedicationPlan.objects.bulk_create(plans)
        for plan in created:
            self._audit_change(plan, "inpatient.medication_plan_created")
        return Response(
            {"plans": InpatientMedicationPlanSerializer(created, many=True).data},
            status=status.HTTP_201_CREATED,
        )


class InpatientMedicationAdministrationViewSet(TenantViewSet):
    queryset = InpatientMedicationAdministration.objects.all().order_by(
        "-administered_at"
    )
    serializer_class = InpatientMedicationAdministrationSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            "admission", "plan", "administered_by"
        )
        admission_id = self.request.query_params.get("admission")
        if admission_id:
            qs = qs.filter(admission_id=admission_id)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("nurse", "admin"):
            raise PermissionDenied("Only nursing staff may record drug administrations.")
        admission = serializer.validated_data["admission"]
        plan = serializer.validated_data.get("plan")
        administered_at = serializer.validated_data.get("administered_at") or timezone.now()
        if (
            admission.organization_id != self.request.user.organization_id
            or admission.discharged_at is not None
        ):
            raise ValidationError({"admission": "Select an active admission in your organization."})
        if administered_at < admission.admitted_at or administered_at > timezone.now():
            raise ValidationError(
                {"administered_at": "Administration time must be within this admission and not in the future."}
            )
        if plan and (
            plan.organization_id != admission.organization_id
            or plan.admission_id != admission.id
        ):
            raise ValidationError({"plan": "Medication plan must belong to this admission."})
        administration = serializer.save(
            organization=self.request.user.organization,
            administered_by=self.request.user,
        )
        self._audit_change(administration, "inpatient.medication_administered")


class InpatientDoctorNoteViewSet(TenantViewSet):
    queryset = InpatientDoctorNote.objects.all().order_by("-created_at")
    serializer_class = InpatientDoctorNoteSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset().select_related("admission", "author")
        admission_id = self.request.query_params.get("admission")
        if admission_id:
            qs = qs.filter(admission_id=admission_id)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may write inpatient notes.")
        admission = serializer.validated_data["admission"]
        if (
            admission.organization_id != self.request.user.organization_id
            or admission.discharged_at is not None
        ):
            raise ValidationError({"admission": "Select an active admission in your organization."})
        if self.request.user.role == "clinician" and not clinician_can_document_admission(
            self.request.user, admission
        ):
            raise PermissionDenied("You can only document your assigned patients.")
        note = serializer.save(
            organization=self.request.user.organization,
            author=self.request.user,
        )
        self._audit_change(note, "inpatient.note_created")


class WardViewSet(TenantViewSet):
    queryset = Ward.objects.all().order_by("name")
    serializer_class = WardSerializer

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators may create wards.")
        ward = serializer.save(organization=self.request.user.organization)
        self._audit_change(ward, "ward.created")

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators may update wards.")
        ward = serializer.save()
        self._audit_change(ward, "ward.updated")

    @transaction.atomic
    def perform_destroy(self, instance):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators may delete wards.")
        if Bed.objects.filter(ward=instance).exists():
            raise ValidationError({"ward": "Move or delete its beds before deleting this ward."})
        self._audit_change(instance, "ward.deleted")
        instance.delete()


class BedViewSet(TenantViewSet):
    queryset = Bed.objects.all().order_by("label")
    serializer_class = BedSerializer

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators may create beds.")
        bed = serializer.save(organization=self.request.user.organization)
        self._audit_change(bed, "bed.created")

    @transaction.atomic
    def perform_update(self, serializer):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators may update bed details or room rates.")
        daily_rate_cents = serializer.validated_data.get("daily_rate_cents")
        bed = serializer.save()
        self._audit_change(bed, "bed.updated")
        if daily_rate_cents and daily_rate_cents > 0:
            rate_started_at = timezone.now()
            updated_admissions = InpatientAdmission.objects.filter(
                bed=serializer.instance,
                discharged_at__isnull=True,
                room_rate_cents=0,
            ).update(
                room_rate_cents=daily_rate_cents,
                room_rate_started_at=rate_started_at,
                updated_at=rate_started_at,
            )
            if updated_admissions:
                AuditEvent.objects.create(
                    organization=self.request.user.organization,
                    actor=self.request.user,
                    action="inpatient.room_rate_set",
                    resource_type="Bed",
                    resource_id=str(serializer.instance.pk),
                    details={
                        "daily_rate_cents": daily_rate_cents,
                        "active_admissions_updated": updated_admissions,
                    },
                )

    @transaction.atomic
    def perform_destroy(self, instance):
        if self.request.user.role != "admin":
            raise PermissionDenied("Only administrators may delete beds.")
        if instance.patient_id or instance.status == "occupied":
            raise ValidationError({"bed": "Discharge the patient before deleting this bed."})
        if InpatientAdmission.objects.filter(bed=instance).exists():
            raise ValidationError({"bed": "Beds with admission history cannot be deleted."})
        self._audit_change(instance, "bed.deleted")
        instance.delete()

    @action(detail=True, methods=["post"], url_path="set-active")
    @transaction.atomic
    def set_active(self, request, pk=None):
        if request.user.role != "admin":
            raise PermissionDenied("Only administrators may change bed availability.")
        active = request.data.get("active")
        if not isinstance(active, bool):
            raise ValidationError({"active": "Provide true or false."})
        bed = self.get_object()
        bed = Bed.objects.select_for_update().get(
            pk=bed.pk, organization=request.user.organization
        )
        if bed.patient_id or bed.status == "occupied" or InpatientAdmission.objects.filter(
            bed=bed, discharged_at__isnull=True
        ).exists():
            raise ValidationError({"bed": "Discharge the patient before changing bed availability."})
        bed.status = "available" if active else "inactive"
        bed.save(update_fields=["status", "updated_at"])
        AuditEvent.objects.create(
            organization=request.user.organization,
            actor=request.user,
            action="bed.activated" if active else "bed.inactivated",
            resource_type="Bed",
            resource_id=str(bed.pk),
            details={},
        )
        return Response(BedSerializer(bed, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def assign(self, request, pk=None):
        """Admit a patient to a bed or discharge its current inpatient."""
        if request.user.role not in ("nurse", "clinician", "admin"):
            raise PermissionDenied("Only clinical staff may manage bed admissions.")
        bed = self.get_object()
        bed = Bed.objects.select_for_update().get(
            pk=bed.pk, organization=request.user.organization
        )
        patient_id = request.data.get("patient")
        if not patient_id:
            if bed.status == "inactive":
                raise ValidationError({"bed": "Inactive beds cannot be discharged."})
            admission = InpatientAdmission.objects.filter(
                bed=bed, discharged_at__isnull=True
            ).first()
            if admission:
                if request.user.role == "clinician" and not clinician_can_document_admission(
                    request.user, admission
                ):
                    raise PermissionDenied("You can only discharge your assigned patients.")
                discharge_admission(admission, request.user)
                bed.refresh_from_db()
            else:
                bed.patient = None
                bed.status = "available"
                bed.save(update_fields=["patient", "status", "updated_at"])
            return Response(BedSerializer(bed, context=self.get_serializer_context()).data)

        patient = Patient.objects.filter(
            pk=patient_id, organization=request.user.organization
        ).first()
        if not patient:
            raise ValidationError({"patient": "Select a patient in your organization."})
        active_admission = InpatientAdmission.objects.filter(
            patient=patient, discharged_at__isnull=True
        ).first()
        if active_admission:
            raise ValidationError({"patient": "This patient is already admitted."})
        if bed.status != "available" or bed.patient_id:
            raise ValidationError({"bed": "This bed is not available for admission."})

        clinician_id = request.data.get("clinician") or patient.assigned_clinician_id
        clinician = Clinician.objects.filter(
            pk=clinician_id, organization=request.user.organization
        ).first() if clinician_id else None
        if not clinician:
            raise ValidationError({"clinician": "Select an attending clinician."})
        if request.user.role == "clinician" and clinician.user_id != request.user.id:
            raise PermissionDenied("You can only admit patients under your care.")
        if request.user.role == "clinician" and patient.assigned_clinician_id != clinician.id:
            raise PermissionDenied("Patient is not assigned to this clinician.")

        admission = InpatientAdmission.objects.create(
            organization=request.user.organization,
            patient=patient,
            bed=bed,
            clinician=clinician,
            department=bed.ward.name,
            room_rate_cents=bed.daily_rate_cents,
            admitted_by=request.user,
        )
        bed.patient = patient
        bed.status = "occupied"
        bed.save(update_fields=["patient", "status", "updated_at"])
        AuditEvent.objects.create(
            organization=request.user.organization,
            actor=request.user,
            action="inpatient.admitted",
            resource_type="InpatientAdmission",
            resource_id=str(admission.pk),
            details={
                "patient_id": str(patient.pk),
                "bed_id": str(bed.pk),
                "clinician_id": str(clinician.pk),
            },
        )
        return Response(BedSerializer(bed).data)


class BillViewSet(TenantViewSet):
    queryset = Bill.objects.all().order_by("-created_at")
    serializer_class = BillSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        care_type = self.request.query_params.get("care_type")
        if care_type in (Bill.CareType.OPD, Bill.CareType.IPD):
            qs = qs.filter(care_type=care_type)
        if self.request.user.role in ("billing", "admin"):
            admissions = InpatientAdmission.objects.filter(
                organization=self.request.user.organization,
                discharged_at__isnull=True,
                room_rate_cents__gt=0,
            ).iterator()
            for admission in admissions:
                accrue_room_charges(admission)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("billing", "admin"):
            raise PermissionDenied("Only billing staff may create invoices.")
        patient = serializer.validated_data["patient"]
        encounter = serializer.validated_data.get("encounter")
        if patient.organization_id != self.request.user.organization_id:
            raise ValidationError({"patient": "Patient must belong to your organization."})
        if encounter and (
            encounter.organization_id != patient.organization_id
            or encounter.patient_id != patient.id
        ):
            raise ValidationError({"encounter": "Encounter must belong to the selected patient and organization."})
        items = serializer.validated_data.get("items") or []
        try:
            amounts = [int(item.get("amount_cents", 0)) for item in items]
        except (AttributeError, TypeError, ValueError):
            raise ValidationError({"items": "Each invoice item must contain an integer amount in cents."})
        if any(amount < 0 for amount in amounts):
            raise ValidationError({"items": "Invoice items cannot have a negative amount."})
        total = sum(amounts)
        bill = serializer.save(
            organization=self.request.user.organization, total_cents=total
        )
        self._audit_change(bill, "billing.invoice_created", {"total_cents": total})


class PaymentViewSet(TenantViewSet):
    queryset = Payment.objects.all().order_by("-created_at")
    serializer_class = PaymentSerializer
    http_method_names = ["get", "post", "head", "options"]

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("billing", "admin"):
            raise PermissionDenied("Only billing staff may record payments.")
        bill_ref = serializer.validated_data["bill"]
        if bill_ref.organization_id != self.request.user.organization_id:
            raise ValidationError({"bill": "Invoice must belong to your organization."})
        bill = Bill.objects.select_for_update().get(
            pk=bill_ref.pk, organization=self.request.user.organization
        )
        paid = (
            Payment.objects.filter(bill=bill).aggregate(total=Sum("amount_cents"))[
                "total"
            ]
            or 0
        )
        amount = serializer.validated_data["amount_cents"]
        if amount <= 0:
            raise ValidationError({"amount_cents": "Payment must be greater than zero."})
        if paid + amount > bill.total_cents:
            raise ValidationError(
                {"amount_cents": "Payment exceeds outstanding balance."}
            )
        serializer.save(
            bill=bill,
            organization=self.request.user.organization, recorded_by=self.request.user
        )
        AuditEvent.objects.create(
            organization=self.request.user.organization,
            actor=self.request.user,
            action="billing.payment_recorded",
            resource_type="Payment",
            resource_id=str(serializer.instance.pk),
            details={"bill_id": str(bill.pk), "amount_cents": amount},
        )
        bill.status = "paid" if paid + amount >= bill.total_cents else "partial"
        bill.save(update_fields=["status", "updated_at"])
        if bill.status == "paid":
            bill.lab_orders.filter(status=LabOrder.Status.AWAITING_PAYMENT).update(
                status=LabOrder.Status.ORDERED
            )


class InsuranceClaimViewSet(TenantViewSet):
    queryset = InsuranceClaim.objects.select_related("bill__patient", "created_by").all()
    serializer_class = InsuranceClaimSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        bill_id = self.request.query_params.get("bill")
        if bill_id:
            qs = qs.filter(bill_id=bill_id)
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("billing", "admin"):
            raise PermissionDenied("Only billing staff may submit insurance claims.")
        bill = serializer.validated_data["bill"]
        if bill.organization_id != self.request.user.organization_id:
            raise ValidationError({"bill": "Invoice must belong to your organization."})
        requested = serializer.validated_data["requested_cents"]
        if requested > bill.total_cents:
            raise ValidationError(
                {"requested_cents": "Claim amount cannot exceed the invoice total."}
            )
        claim = serializer.save(
            organization=self.request.user.organization,
            created_by=self.request.user,
            claim_number=f"CLM-{uuid.uuid4().hex[:12].upper()}",
        )
        self._audit_change(claim, "insurance_claim.created", {"bill_id": str(bill.pk)})

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        if request.user.role not in ("billing", "admin"):
            raise PermissionDenied("Only billing staff may submit insurance claims.")
        claim = self.get_object()
        if claim.status != InsuranceClaim.Status.DRAFT:
            raise ValidationError({"status": "Only draft claims can be submitted."})
        claim.status = InsuranceClaim.Status.SUBMITTED
        claim.submitted_at = timezone.now()
        claim.save(update_fields=["status", "submitted_at", "updated_at"])
        AuditEvent.objects.create(
            organization=claim.organization,
            actor=request.user,
            action="insurance_claim.submitted",
            resource_type="InsuranceClaim",
            resource_id=str(claim.pk),
            details={"bill_id": str(claim.bill_id), "requested_cents": claim.requested_cents},
        )
        return Response(self.get_serializer(claim).data)

    @action(detail=True, methods=["post"])
    def adjudicate(self, request, pk=None):
        if request.user.role not in ("billing", "admin"):
            raise PermissionDenied("Only billing staff may record claim decisions.")
        claim = self.get_object()
        if claim.status != InsuranceClaim.Status.SUBMITTED:
            raise ValidationError({"status": "Only submitted claims can be decided."})
        outcome = request.data.get("status")
        if outcome not in (
            InsuranceClaim.Status.APPROVED,
            InsuranceClaim.Status.PARTIALLY_APPROVED,
            InsuranceClaim.Status.DENIED,
        ):
            raise ValidationError({"status": "Choose approved, partially_approved, or denied."})
        try:
            approved = int(request.data.get("approved_cents", 0))
        except (TypeError, ValueError) as exc:
            raise ValidationError({"approved_cents": "Enter a whole amount in cents."}) from exc
        if approved < 0 or approved > claim.requested_cents:
            raise ValidationError(
                {"approved_cents": "Approved amount must be between zero and the requested amount."}
            )
        if outcome == InsuranceClaim.Status.APPROVED and approved != claim.requested_cents:
            raise ValidationError(
                {"approved_cents": "Fully approved claims must match the requested amount."}
            )
        if outcome == InsuranceClaim.Status.PARTIALLY_APPROVED and not (
            0 < approved < claim.requested_cents
        ):
            raise ValidationError(
                {"approved_cents": "A partially approved claim must have a partial amount."}
            )
        if outcome == InsuranceClaim.Status.DENIED and approved != 0:
            raise ValidationError({"approved_cents": "Denied claims cannot have an approved amount."})
        claim.status = outcome
        claim.approved_cents = approved
        claim.notes = str(request.data.get("notes", claim.notes)).strip()
        claim.decided_at = timezone.now()
        claim.save(
            update_fields=[
                "status", "approved_cents", "notes", "decided_at", "updated_at"
            ]
        )
        AuditEvent.objects.create(
            organization=claim.organization,
            actor=request.user,
            action="insurance_claim.adjudicated",
            resource_type="InsuranceClaim",
            resource_id=str(claim.pk),
            details={"status": outcome, "approved_cents": approved},
        )
        return Response(self.get_serializer(claim).data)


class FollowUpViewSet(TenantViewSet):
    queryset = FollowUp.objects.all().order_by("due_at")
    serializer_class = FollowUpSerializer


class AuditEventViewSet(TenantViewSet):
    queryset = AuditEvent.objects.all().order_by("-created_at")
    serializer_class = AuditEventSerializer
    http_method_names = ["get", "head", "options"]  # read-only


class ConsentViewSet(TenantViewSet):
    queryset = Consent.objects.all().order_by("-created_at")
    serializer_class = ConsentSerializer


class VirtualSessionViewSet(TenantViewSet):
    queryset = VirtualSession.objects.all().order_by("-scheduled_at")
    serializer_class = VirtualSessionSerializer
    http_method_names = ["get", "head", "options"]


# ── New Phase-2 viewsets ──────────────────────────────────────────────────────


class AllergyViewSet(TenantViewSet):
    """Record and manage patient allergy entries."""

    queryset = Allergy.objects.all().order_by("-created_at")
    serializer_class = AllergySerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("patient"):
            qs = qs.filter(patient_id=self.request.query_params["patient"])
        return qs


class DischargeNoteViewSet(TenantViewSet):
    """Discharge summaries authored by clinicians upon encounter completion."""

    queryset = DischargeNote.objects.all().order_by("-created_at")
    serializer_class = DischargeNoteSerializer
    http_method_names = ["get", "post", "head", "options"]

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may author discharge notes.")
        encounter = serializer.validated_data["encounter"]
        patient = serializer.validated_data["patient"]
        if self.request.user.role == "clinician" and (
            encounter.clinician.user_id != self.request.user.id
            or patient.assigned_clinician_id != encounter.clinician_id
        ):
            raise PermissionDenied("You can only document your assigned encounters.")
        note = serializer.save(
            organization=self.request.user.organization, author=self.request.user
        )
        AuditEvent.objects.create(
            organization=note.organization, actor=self.request.user,
            action="discharge_note.created", resource_type="DischargeNote",
            resource_id=str(note.pk), details={"encounter_id": str(encounter.pk)},
        )

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("patient"):
            qs = qs.filter(patient_id=self.request.query_params["patient"])
        if self.request.query_params.get("encounter"):
            qs = qs.filter(encounter_id=self.request.query_params["encounter"])
        return qs


class ProxyGrantViewSet(TenantViewSet):
    """Family/caregiver proxy access grants for patient records."""

    queryset = ProxyGrant.objects.all().order_by("-created_at")
    serializer_class = ProxyGrantSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role == "patient":
            qs = qs.filter(Q(patient_id=user.patient_id) | Q(grantee=user))
        return qs

    @transaction.atomic
    def perform_create(self, serializer):
        user = self.request.user
        if user.role != "patient" or not user.patient_id:
            raise PermissionDenied("Only a patient can authorize proxy access for their own record.")
        if ProxyGrant.objects.filter(
            organization=user.organization,
            patient_id=user.patient_id,
            grantee=serializer.validated_data["grantee"],
            active=True,
        ).exists():
            raise ValidationError({"detail": "This patient already has an active grant for that account."})
        grant = serializer.save(
            organization=user.organization,
            patient_id=user.patient_id,
            active=True,
        )
        self._audit_change(grant, "proxy_grant.created", {"scope": grant.scope})

    @transaction.atomic
    def perform_update(self, serializer):
        user = self.request.user
        if (
            user.role != "patient"
            or str(serializer.instance.patient_id) != str(user.patient_id)
        ):
            raise PermissionDenied("Only the grant owner can revoke proxy access.")
        if serializer.validated_data.get("active") is True:
            raise PermissionDenied("Proxy access cannot be reactivated after revocation.")
        grant = serializer.save(active=False)
        self._audit_change(grant, "proxy_grant.revoked")

    def perform_destroy(self, instance):
        raise PermissionDenied("Proxy grants are retained for audit; revoke the grant instead.")


class MedicalHistoryViewSet(TenantViewSet):
    """Persistent medical history entries per patient."""

    queryset = MedicalHistory.objects.all().order_by("-created_at")
    serializer_class = MedicalHistorySerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("patient"):
            qs = qs.filter(patient_id=self.request.query_params["patient"])
        return qs


class PatientMessageViewSet(TenantViewSet):
    queryset = PatientMessage.objects.select_related("patient", "sender", "recipient")
    serializer_class = PatientMessageSerializer
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        patient_id = self.request.query_params.get("patient")
        if patient_id:
            qs = qs.filter(patient_id=patient_id)
        return qs.filter(
            Q(sender=self.request.user) | Q(recipient=self.request.user)
        )

    @transaction.atomic
    def perform_create(self, serializer):
        user = self.request.user
        patient = serializer.validated_data["patient"]
        if user.role not in ("patient", "clinician"):
            raise PermissionDenied("Only patients and their assigned clinicians can message.")
        if patient.organization_id != user.organization_id:
            raise ValidationError({"patient": "Patient must belong to your organization."})
        clinician = patient.assigned_clinician
        if not clinician or not clinician.user_id:
            raise ValidationError(
                {"patient": "This patient does not have a clinician account available for messaging."}
            )
        if user.role == "patient":
            if not (patient.owner_id == user.id or patient.pk == user.patient_id):
                raise PermissionDenied("You can only message about your own patient record.")
            recipient = clinician.user
        else:
            if clinician.user_id != user.id:
                raise PermissionDenied("You can only message patients assigned to you.")
            if not patient.owner_id:
                raise ValidationError(
                    {"patient": "This patient does not have a portal account to receive messages."}
                )
            recipient = patient.owner
        message = serializer.save(
            organization=user.organization,
            sender=user,
            recipient=recipient,
        )
        self._audit_change(message, "patient_message.sent")

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        message = self.get_object()
        if message.recipient_id != request.user.id:
            raise PermissionDenied("Only the message recipient can mark it as read.")
        message.read_at = timezone.now()
        message.save(update_fields=["read_at", "updated_at"])
        return Response(self.get_serializer(message).data)


# ── Standalone API views ──────────────────────────────────────────────────────


class MeView(APIView):
    """Return the authenticated user's profile."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    @transaction.atomic
    def patch(self, request):
        unknown = set(request.data) - {"first_name", "last_name", "email"}
        if unknown:
            raise ValidationError({"detail": "Only first name, last name and email can be updated here."})
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        AuditEvent.objects.create(
            organization=user.organization, actor=user, action="user.profile_updated",
            resource_type="User", resource_id=str(user.pk), details={"fields": list(serializer.validated_data)},
        )
        return Response(UserSerializer(user).data)


class InitialPasswordChangeView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @transaction.atomic
    def post(self, request):
        token = request.data.get("token")
        password = request.data.get("password")
        if not isinstance(token, str) or not isinstance(password, str):
            raise ValidationError({"detail": "A change token and new password are required."})
        try:
            data = signing.loads(token, salt="core.password-change", max_age=600)
        except signing.BadSignature as exc:
            raise ValidationError({"detail": "The password change session is invalid or expired."}) from exc
        user = User.objects.select_for_update().filter(pk=data.get("user_id")).first()
        if (not user or not user.is_active or not user.must_change_password
                or not hmac.compare_digest(data.get("password_version", ""), password_version(user))):
            raise ValidationError({"detail": "The password change session is invalid or expired."})
        try:
            validate_password(password, user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": exc.messages}) from exc
        user.set_password(password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        AuditEvent.objects.create(
            organization=user.organization, actor=user, action="user.password_changed",
            resource_type="User", resource_id=str(user.pk), details={},
        )
        return Response({"detail": "Password changed. Sign in with your new password."})


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        current_password = request.data.get("current_password")
        new_password = request.data.get("new_password")
        if not isinstance(current_password, str) or not isinstance(new_password, str):
            raise ValidationError({"detail": "Current and new passwords are required."})
        user = User.objects.select_for_update().get(pk=request.user.pk)
        if not user.check_password(current_password):
            raise ValidationError({"current_password": ["Current password is incorrect."]})
        if user.check_password(new_password):
            raise ValidationError({"new_password": ["The new password must be different."]})
        try:
            validate_password(new_password, user)
        except DjangoValidationError as exc:
            raise ValidationError({"new_password": exc.messages}) from exc
        user.set_password(new_password)
        user.save(update_fields=["password"])
        AuditEvent.objects.create(
            organization=user.organization, actor=user, action="user.password_changed",
            resource_type="User", resource_id=str(user.pk), details={},
        )
        return Response({"detail": "Password changed. Sign in with your new password."})


class HealthView(APIView):
    """Public health check endpoint."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"status": "ok"})


class AnalyticsView(APIView):
    """Return only dashboard metrics relevant to the authenticated role."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        org = request.user.organization
        if org is None:
            return Response({"detail": "No organization assigned."}, status=400)

        role = request.user.role
        if role not in User.Role.values:
            raise PermissionDenied("Your role cannot access dashboard statistics.")

        data = {"generated_at": timezone.now().isoformat()}
        patients = Patient.objects.filter(organization=org)
        appointments = Appointment.objects.filter(organization=org)
        encounters = Encounter.objects.filter(organization=org)
        lab_orders = LabOrder.objects.filter(organization=org)

        if role == "clinician":
            clinician = Clinician.objects.filter(user=request.user, organization=org).first()
            if clinician:
                patients = patients.filter(assigned_clinician=clinician)
                appointments = appointments.filter(clinician=clinician)
                encounters = encounters.filter(clinician=clinician)
                lab_orders = lab_orders.filter(
                    Q(patient__assigned_clinician=clinician) | Q(admission__clinician=clinician)
                ).distinct()
            else:
                patients = patients.none()
                appointments = appointments.none()
                encounters = encounters.none()
                lab_orders = lab_orders.none()

        if role in ("admin", "receptionist", "clinician"):
            try:
                local_tz = ZoneInfo(org.time_zone)
            except (ZoneInfoNotFoundError, AttributeError) as exc:
                raise ValidationError(
                    {"detail": "The organization time zone is invalid. Contact an administrator."}
                ) from exc
            today = timezone.localtime(timezone.now(), local_tz).date()
            day_start = datetime.combine(today, time.min, tzinfo=local_tz)
            day_end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=local_tz)
            data["total_patients"] = (
                patients.filter(is_opd=True).count() if role == "receptionist" else patients.count()
            )
            data["scheduled_today"] = appointments.filter(
                status=Appointment.Status.SCHEDULED, starts_at__gte=day_start, starts_at__lt=day_end
            ).count()
        if role in ("admin", "clinician"):
            data["active_encounters"] = encounters.filter(
                status__in=["checked_in", "in_progress"]
            ).count()
            data["pending_lab_orders"] = lab_orders.filter(status__in=[
                LabOrder.Status.AWAITING_PAYMENT, LabOrder.Status.ORDERED,
                LabOrder.Status.IN_PROGRESS, LabOrder.Status.RESULTED,
            ]).count()
        if role == "nurse":
            data["awaiting_triage"] = patients.filter(is_opd=True, opd_status="registered").count()
        if role in ("admin", "nurse"):
            active_beds = Bed.objects.filter(organization=org).exclude(status="inactive")
            data["occupied_beds"] = active_beds.filter(status="occupied").count()
            data["total_beds"] = active_beds.count()
        if role in ("admin", "lab"):
            data["pending_labs"] = lab_orders.filter(status=LabOrder.Status.ORDERED).count()
        if role in ("admin", "pharmacist"):
            data["pending_prescriptions"] = Prescription.objects.filter(
                organization=org, status="authorized"
            ).count()
        if role in ("admin", "billing"):
            outstanding_bills = Bill.objects.filter(
                organization=org, status__in=["unpaid", "partial"]
            )
            data["unpaid_bills"] = outstanding_bills.count()
            data["outstanding_bills_cents"] = (
                (outstanding_bills.aggregate(total=Sum("total_cents"))["total"] or 0)
                - (Payment.objects.filter(
                    organization=org, bill__in=outstanding_bills
                ).aggregate(total=Sum("amount_cents"))["total"] or 0)
            )
        if role == "admin":
            data["total_revenue_cents"] = (
                Payment.objects.filter(organization=org).aggregate(total=Sum("amount_cents"))["total"]
                or 0
            )
        return Response(data)


class PatientRegisterView(APIView):
    """
    Public endpoint: self-registration for new patients.
    Creates a Patient record + a linked User account with role='patient'.
    The organization must be supplied as ?org=<code> query param or body field.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PatientRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Resolve organization
        org_code = request.data.get("org") or request.query_params.get("org")
        if org_code:
            try:
                org = Organization.objects.get(code=org_code)
            except Organization.DoesNotExist:
                raise ValidationError({"org": f"Organization '{org_code}' not found."})
        else:
            # A single-hospital deployment needs no organization code on the form.
            organizations = list(Organization.objects.all()[:2])
            if len(organizations) != 1:
                raise ValidationError({"org": "Organization code is required."})
            org = organizations[0]

        with transaction.atomic():
            # Generate MRN
            mrn = f"MRN-{uuid.uuid4().hex[:8].upper()}"

            patient = Patient.objects.create(
                organization=org,
                medical_record_number=mrn,
                first_name=data["first_name"],
                last_name=data["last_name"],
                date_of_birth=data["date_of_birth"],
                sex=data.get("sex", ""),
                phone=data.get("phone", ""),
                email=data.get("email", ""),
            )

            user = User.objects.create_user(
                username=data["username"],
                password=data["password"],
                first_name=data["first_name"],
                last_name=data["last_name"],
                email=data.get("email", ""),
                role=User.Role.PATIENT,
                organization=org,
                patient_id=patient.pk,
            )

            # Back-link the patient to the user account
            patient.owner = user
            patient.save(update_fields=["owner", "updated_at"])
            AuditEvent.objects.create(
                organization=org, actor=user, action="patient.registered",
                resource_type="Patient", resource_id=str(patient.pk),
                details={"self_service": True},
            )

        return Response(
            {
                "detail": "Registration successful.",
                "patient_id": str(patient.pk),
                "mrn": mrn,
                "username": user.username,
            },
            status=status.HTTP_201_CREATED,
        )
