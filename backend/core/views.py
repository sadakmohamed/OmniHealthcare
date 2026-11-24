import uuid

from django.contrib.auth import get_user_model
from django.db import transaction
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
    Consent,
    Diagnosis,
    DischargeNote,
    Encounter,
    FollowUp,
    LabOrder,
    LabResult,
    MedicalHistory,
    Organization,
    Patient,
    Payment,
    Prescription,
    ProxyGrant,
    Referral,
    VirtualSession,
    Vital,
    Ward,
)
from .serializers import (
    AllergySerializer,
    AppointmentSerializer,
    AuditEventSerializer,
    BedSerializer,
    BillSerializer,
    CarePlanSerializer,
    ClinicalNoteSerializer,
    ClinicianSerializer,
    ConsentSerializer,
    DiagnosisSerializer,
    DischargeNoteSerializer,
    EncounterSerializer,
    FollowUpSerializer,
    LabOrderSerializer,
    LabResultSerializer,
    MedicalHistorySerializer,
    PatientRegistrationSerializer,
    PatientSerializer,
    PaymentSerializer,
    PrescriptionSerializer,
    ProxyGrantSerializer,
    ReferralSerializer,
    UserSerializer,
    VirtualSessionSerializer,
    VitalSerializer,
    WardSerializer,
)

User = get_user_model()


# ── Base viewset ──────────────────────────────────────────────────────────────


class TenantViewSet(viewsets.ModelViewSet):
    """
    Base viewset that enforces:
    - Authentication required
    - All queries scoped to the requesting user's organization
    - Patient-role users can only see their own patient-linked records
    """

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        # Tenant isolation: always filter by organization
        qs = qs.filter(organization=user.organization)
        # Patient self-service: only see their own records
        if user.role == "patient":
            if qs.model == Patient:
                cond = Q(owner=user)
                if user.patient_id:
                    cond |= Q(id=user.patient_id)
                qs = qs.filter(cond)
            elif hasattr(qs.model, "patient"):
                cond = Q(patient__owner=user)
                if user.patient_id:
                    cond |= Q(patient_id=user.patient_id)
                qs = qs.filter(cond)
        return qs

    def perform_create(self, serializer):
        serializer.save(organization=self.request.user.organization)


# ── Core viewsets ─────────────────────────────────────────────────────────────


class PatientViewSet(TenantViewSet):
    """
    Provides full patient search by name, MRN, and email.
    Patient-role users are restricted to their own record.
    """

    queryset = Patient.objects.all().order_by("-created_at")
    serializer_class = PatientSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["first_name", "last_name", "medical_record_number", "email"]
    ordering_fields = ["last_name", "created_at", "date_of_birth"]

    def get_queryset(self):
        qs = super().get_queryset()
        # Additional manual search param (backward-compatible)
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(medical_record_number__icontains=search)
                | Q(email__icontains=search)
            )
        return qs


class ClinicianViewSet(TenantViewSet):
    queryset = Clinician.objects.all().select_related("user")
    serializer_class = ClinicianSerializer


class AppointmentViewSet(TenantViewSet):
    """
    Supports filtering by patient, clinician, status, and date range.
    Enforces duplicate booking rejection via SELECT FOR UPDATE.
    """

    queryset = Appointment.objects.all().order_by("starts_at")
    serializer_class = AppointmentSerializer
    filter_backends = [filters.OrderingFilter]
    ordering_fields = ["starts_at", "status"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if params.get("patient"):
            qs = qs.filter(patient_id=params["patient"])
        if params.get("clinician"):
            qs = qs.filter(clinician_id=params["clinician"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("date"):
            qs = qs.filter(starts_at__date=params["date"])
        if params.get("date_from"):
            qs = qs.filter(starts_at__date__gte=params["date_from"])
        if params.get("date_to"):
            qs = qs.filter(starts_at__date__lte=params["date_to"])
        return qs

    def perform_create(self, serializer):
        with transaction.atomic():
            if Appointment.objects.select_for_update().filter(
                organization=self.request.user.organization,
                clinician_id=serializer.validated_data["clinician"].pk,
                starts_at=serializer.validated_data["starts_at"],
            ).exists():
                raise ValidationError(
                    {"starts_at": "This clinician slot is already booked."}
                )
            serializer.save(organization=self.request.user.organization)

    @action(detail=True, methods=["post"])
    def checkin(self, request, pk=None):
        """Check in a scheduled appointment (reception / admin only)."""
        appointment = self.get_object()
        if request.user.role not in ("receptionist", "admin"):
            raise PermissionDenied("Only reception can check in appointments.")
        if appointment.status != Appointment.Status.SCHEDULED:
            raise ValidationError("Only scheduled appointments can be checked in.")
        appointment.status = Appointment.Status.CHECKED_IN
        appointment.save(update_fields=["status", "updated_at"])
        return Response(AppointmentSerializer(appointment).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Cancel an appointment (reception / admin only)."""
        appointment = self.get_object()
        if request.user.role not in ("receptionist", "admin"):
            raise PermissionDenied("Only reception can cancel appointments.")
        if appointment.status == Appointment.Status.CANCELLED:
            raise ValidationError("Appointment is already cancelled.")
        appointment.status = Appointment.Status.CANCELLED
        appointment.save(update_fields=["status", "updated_at"])
        return Response(AppointmentSerializer(appointment).data)


class EncounterViewSet(TenantViewSet):
    """
    Encounter with full state-machine transition validation.
    """

    queryset = Encounter.objects.all().order_by("-created_at")
    serializer_class = EncounterSerializer

    # Valid state transitions
    TRANSITIONS = {
        Encounter.Status.SCHEDULED: [
            Encounter.Status.CHECKED_IN,
            Encounter.Status.IN_PROGRESS,
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

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """
        Advance or revert an encounter's status through the state machine.
        Completing an encounter requires at least one clinical note.
        """
        encounter = self.get_object()
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

        encounter.status = target
        encounter.save(update_fields=["status", "updated_at"])
        AuditEvent.objects.create(
            organization=encounter.organization,
            actor=request.user,
            action="encounter.transition",
            resource_type="Encounter",
            resource_id=str(encounter.pk),
            details={"from": encounter.status, "to": target},
        )
        return Response(EncounterSerializer(encounter).data)


class VitalViewSet(TenantViewSet):
    queryset = Vital.objects.all().order_by("-created_at")
    serializer_class = VitalSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("nurse", "clinician", "admin"):
            raise PermissionDenied("Only nursing or clinical staff can record vitals.")
        serializer.save(
            organization=self.request.user.organization,
            recorded_by=self.request.user,
        )


class ClinicalNoteViewSet(TenantViewSet):
    queryset = ClinicalNote.objects.all().order_by("-created_at")
    serializer_class = ClinicalNoteSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may author clinical notes.")
        serializer.save(
            organization=self.request.user.organization, author=self.request.user
        )


class DiagnosisViewSet(TenantViewSet):
    queryset = Diagnosis.objects.all().order_by("-created_at")
    serializer_class = DiagnosisSerializer


class CarePlanViewSet(TenantViewSet):
    queryset = CarePlan.objects.all().order_by("-created_at")
    serializer_class = CarePlanSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may create care plans.")
        serializer.save(
            organization=self.request.user.organization,
            approved_by=self.request.user,
        )


class LabOrderViewSet(TenantViewSet):
    queryset = LabOrder.objects.all().order_by("-created_at")
    serializer_class = LabOrderSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may order laboratory tests.")
        serializer.save(
            organization=self.request.user.organization, ordered_by=self.request.user
        )


class LabResultViewSet(TenantViewSet):
    queryset = LabResult.objects.all().order_by("-created_at")
    serializer_class = LabResultSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("lab", "admin"):
            raise PermissionDenied("Only laboratory staff may enter results.")
        order = serializer.validated_data["order"]
        patient = serializer.validated_data["patient"]
        if (
            order.patient_id != patient.id
            or order.organization_id != self.request.user.organization_id
        ):
            raise ValidationError(
                "Lab result must match the ordered patient and tenant."
            )
        serializer.save(
            organization=self.request.user.organization, entered_by=self.request.user
        )


class PrescriptionViewSet(TenantViewSet):
    queryset = Prescription.objects.all().order_by("-created_at")
    serializer_class = PrescriptionSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may authorize prescriptions.")
        serializer.save(
            organization=self.request.user.organization,
            authorized_by=self.request.user,
        )

    @action(detail=True, methods=["post"])
    def dispense(self, request, pk=None):
        """Mark a prescription as dispensed (pharmacist / admin only)."""
        if request.user.role not in ("pharmacist", "admin"):
            raise PermissionDenied("Only pharmacy staff may dispense prescriptions.")
        prescription = self.get_object()
        if prescription.status == "dispensed":
            raise ValidationError("Prescription already dispensed.")
        prescription.status = "dispensed"
        prescription.dispensed_at = timezone.now()
        prescription.save(update_fields=["status", "dispensed_at", "updated_at"])
        return Response(PrescriptionSerializer(prescription).data)


class ReferralViewSet(TenantViewSet):
    queryset = Referral.objects.all().order_by("-created_at")
    serializer_class = ReferralSerializer


class WardViewSet(TenantViewSet):
    queryset = Ward.objects.all().order_by("name")
    serializer_class = WardSerializer


class BedViewSet(TenantViewSet):
    queryset = Bed.objects.all().order_by("label")
    serializer_class = BedSerializer

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        """Assign or unassign a patient to/from a bed."""
        bed = self.get_object()
        patient_id = request.data.get("patient")
        bed.patient_id = patient_id if patient_id else None
        bed.status = "occupied" if bed.patient_id else "available"
        bed.save(update_fields=["patient", "status", "updated_at"])
        return Response(BedSerializer(bed).data)


class BillViewSet(TenantViewSet):
    queryset = Bill.objects.all().order_by("-created_at")
    serializer_class = BillSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("billing", "admin"):
            raise PermissionDenied("Only billing staff may create invoices.")
        items = serializer.validated_data.get("items") or []
        total = sum(int(item.get("amount_cents", 0)) for item in items)
        if total < 0:
            raise ValidationError("Invoice items cannot have a negative total.")
        serializer.save(
            organization=self.request.user.organization, total_cents=total
        )


class PaymentViewSet(TenantViewSet):
    queryset = Payment.objects.all().order_by("-created_at")
    serializer_class = PaymentSerializer

    def perform_create(self, serializer):
        if self.request.user.role not in ("billing", "admin"):
            raise PermissionDenied("Only billing staff may record payments.")
        bill = serializer.validated_data["bill"]
        paid = (
            Payment.objects.filter(bill=bill).aggregate(total=Sum("amount_cents"))[
                "total"
            ]
            or 0
        )
        amount = serializer.validated_data["amount_cents"]
        if paid + amount > bill.total_cents:
            raise ValidationError(
                {"amount_cents": "Payment exceeds outstanding balance."}
            )
        serializer.save(
            organization=self.request.user.organization, recorded_by=self.request.user
        )
        bill.status = "paid" if paid + amount >= bill.total_cents else "partial"
        bill.save(update_fields=["status", "updated_at"])


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

    TRANSITIONS = {
        VirtualSession.Status.BOOKED: [
            VirtualSession.Status.INTAKE,
            VirtualSession.Status.CANCELLED,
        ],
        VirtualSession.Status.INTAKE: [
            VirtualSession.Status.WAITING,
            VirtualSession.Status.CANCELLED,
        ],
        VirtualSession.Status.WAITING: [
            VirtualSession.Status.CONSULTING,
            VirtualSession.Status.CANCELLED,
        ],
        VirtualSession.Status.CONSULTING: [
            VirtualSession.Status.COMPLETED,
            VirtualSession.Status.WAITING,
        ],
        VirtualSession.Status.COMPLETED: [],
        VirtualSession.Status.CANCELLED: [],
    }

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        visit = self.get_object()
        target = request.data.get("status")
        allowed = self.TRANSITIONS.get(visit.status, [])
        if target not in allowed:
            raise ValidationError({"status": "Invalid virtual care transition."})
        visit.status = target
        visit.save(update_fields=["status", "updated_at"])
        return Response(VirtualSessionSerializer(visit).data)


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

    def perform_create(self, serializer):
        if self.request.user.role not in ("clinician", "admin"):
            raise PermissionDenied("Only clinicians may author discharge notes.")
        serializer.save(
            organization=self.request.user.organization, author=self.request.user
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
        # Patients can only see their own proxy grants
        if user.role == "patient":
            qs = qs.filter(patient_id=user.patient_id)
        return qs

    def perform_create(self, serializer):
        if self.request.user.role not in ("admin", "receptionist", "clinician"):
            raise PermissionDenied("Only admin or clinical staff may grant proxy access.")
        serializer.save(organization=self.request.user.organization)


class MedicalHistoryViewSet(TenantViewSet):
    """Persistent medical history entries per patient."""

    queryset = MedicalHistory.objects.all().order_by("-created_at")
    serializer_class = MedicalHistorySerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("patient"):
            qs = qs.filter(patient_id=self.request.query_params["patient"])
        return qs


# ── Standalone API views ──────────────────────────────────────────────────────


class MeView(APIView):
    """Return the authenticated user's profile."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class HealthView(APIView):
    """Public health check endpoint."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"status": "ok", "synthetic": True})


class AnalyticsView(APIView):
    """
    Dashboard statistics for the authenticated user's organization.
    Returns counts and summaries used by the front-end dashboard.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        org = request.user.organization
        if org is None:
            return Response({"detail": "No organization assigned."}, status=400)

        total_patients = Patient.objects.filter(organization=org).count()
        active_encounters = Encounter.objects.filter(
            organization=org, status__in=["checked_in", "in_progress"]
        ).count()
        scheduled_today = Appointment.objects.filter(
            organization=org,
            status=Appointment.Status.SCHEDULED,
            starts_at__date=timezone.now().date(),
        ).count()
        pending_labs = LabOrder.objects.filter(
            organization=org, status=LabOrder.Status.ORDERED
        ).count()
        pending_prescriptions = Prescription.objects.filter(
            organization=org, status="authorized"
        ).count()
        unpaid_bills = Bill.objects.filter(
            organization=org, status__in=["unpaid", "partial"]
        ).count()
        total_revenue_cents = (
            Payment.objects.filter(organization=org).aggregate(
                total=Sum("amount_cents")
            )["total"]
            or 0
        )

        return Response(
            {
                "total_patients": total_patients,
                "active_encounters": active_encounters,
                "scheduled_today": scheduled_today,
                "pending_labs": pending_labs,
                "pending_prescriptions": pending_prescriptions,
                "unpaid_bills": unpaid_bills,
                "total_revenue_cents": total_revenue_cents,
                "generated_at": timezone.now().isoformat(),
            }
        )


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
        if not org_code:
            raise ValidationError({"org": "Organization code is required."})
        try:
            org = Organization.objects.get(code=org_code)
        except Organization.DoesNotExist:
            raise ValidationError({"org": f"Organization '{org_code}' not found."})

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

        return Response(
            {
                "detail": "Registration successful.",
                "patient_id": str(patient.pk),
                "mrn": mrn,
                "username": user.username,
            },
            status=status.HTTP_201_CREATED,
        )
