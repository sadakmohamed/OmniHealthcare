import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=30, unique=True)
    time_zone = models.CharField(max_length=64, default="Africa/Nairobi")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        RECEPTIONIST = "receptionist", "Receptionist"
        CLINICIAN = "clinician", "Clinician"
        NURSE = "nurse", "Nurse"
        LAB = "lab", "Lab"
        PHARMACIST = "pharmacist", "Pharmacist"
        BILLING = "billing", "Billing Admin"
        PATIENT = "patient", "Patient"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.ADMIN)
    must_change_password = models.BooleanField(default=False)
    failed_login_attempts = models.PositiveIntegerField(default=0)
    login_locked_until = models.DateTimeField(null=True, blank=True)
    organization = models.ForeignKey(
        Organization, null=True, blank=True, on_delete=models.PROTECT
    )
    # Links a patient-role user to their Patient record for self-service access
    patient = models.ForeignKey(
        "Patient",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="portal_accounts",
    )

    def __str__(self):
        return f"{self.username} ({self.role})"


class TenantModel(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class LabTest(TenantModel):
    name = models.CharField(max_length=200)
    price_cents = models.PositiveIntegerField()
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="unique_org_lab_test_name"),
        ]
        ordering = ["name"]


class Medication(TenantModel):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "name"], name="unique_org_medication_name"),
        ]
        ordering = ["name"]


class Patient(TenantModel):
    medical_record_number = models.CharField(max_length=30, unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    date_of_birth = models.DateField(null=True, blank=True)
    age = models.PositiveIntegerField(null=True, blank=True)
    sex = models.CharField(max_length=20, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    registration_date = models.DateField(default=timezone.now)
    allergies = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="owned_patient_records",
    )
    # OPD Specifics
    is_opd = models.BooleanField(default=True)
    opd_status = models.CharField(
        max_length=30,
        default="registered",
        choices=[
            ("registered", "Registered / Awaiting Vitals"),
            ("vitals_recorded", "Vitals Recorded / Ready for Doctor"),
            ("in_consultation", "In Consultation"),
            ("investigations_pending", "Investigations Pending"),
            ("completed", "Consultation Completed"),
        ],
    )
    assigned_clinician = models.ForeignKey(
        "Clinician",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="opd_patients",
    )

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class Clinician(TenantModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True
    )
    name = models.CharField(max_length=150, blank=True)
    department = models.CharField(max_length=100, blank=True)
    specialty = models.CharField(max_length=100)
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    sex = models.CharField(max_length=20, blank=True)
    opd_consultation_price = models.PositiveIntegerField(
        default=5000,
        help_text="OPD consultation fee in cents (e.g. 5000 = $50.00)",
    )

    def __str__(self):
        doc_name = self.name or (f"Dr. {self.user.get_full_name()}" if self.user else "Dr. Consultant")
        dept = self.department or self.specialty
        return f"{doc_name} ({dept})"


class Appointment(TenantModel):
    class VisitType(models.TextChoices):
        CLINIC = "clinic", "Clinic"
        VIRTUAL = "virtual", "Virtual"

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        CHECKED_IN = "checked_in", "Checked In"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    clinician = models.ForeignKey(Clinician, on_delete=models.PROTECT)
    starts_at = models.DateTimeField()
    visit_type = models.CharField(
        max_length=10, choices=VisitType.choices, default=VisitType.CLINIC
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SCHEDULED
    )
    reason = models.CharField(max_length=300, blank=True)
    idempotency_key = models.CharField(max_length=100, blank=True)
    virtual_session_ref = models.CharField(max_length=100, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "clinician", "starts_at"],
                condition=~models.Q(status="cancelled"),
                name="unique_active_clinician_slot",
            ),
            models.UniqueConstraint(
                fields=["organization", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_appointment_idempotency_key",
            ),
        ]
        indexes = [models.Index(fields=["organization", "starts_at"])]

    def __str__(self):
        return f"{self.patient} @ {self.starts_at:%Y-%m-%d %H:%M}"


class ClinicianAvailability(TenantModel):
    clinician = models.ForeignKey(
        Clinician, on_delete=models.CASCADE, related_name="availability_windows"
    )
    weekday = models.PositiveSmallIntegerField()
    starts_at = models.TimeField()
    ends_at = models.TimeField()
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["weekday", "starts_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["clinician", "weekday", "starts_at"],
                name="unique_clinician_availability_start",
            ),
            models.CheckConstraint(
                condition=models.Q(weekday__gte=0, weekday__lte=6),
                name="clinician_availability_valid_weekday",
            ),
            models.CheckConstraint(
                condition=models.Q(ends_at__gt=models.F("starts_at")),
                name="clinician_availability_positive_window",
            ),
        ]


class Encounter(TenantModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        CHECKED_IN = "checked_in", "Checked In"
        IN_PROGRESS = "in_progress", "In Progress"
        DOCUMENTATION_PENDING = "documentation_pending", "Documentation Pending"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        ENTERED_IN_ERROR = "entered_in_error", "Entered in Error"

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    clinician = models.ForeignKey(Clinician, on_delete=models.PROTECT)
    appointment = models.ForeignKey(
        Appointment, null=True, blank=True, on_delete=models.SET_NULL
    )
    status = models.CharField(
        max_length=30, choices=Status.choices, default=Status.SCHEDULED
    )
    # Structured medical history
    history_of_present_illness = models.TextField(blank=True)
    past_medical_history = models.TextField(blank=True)
    history_of_surgery = models.TextField(blank=True)
    follow_up_date = models.DateField(null=True, blank=True)
    follow_up_days = models.PositiveIntegerField(null=True, blank=True)

    def __str__(self):
        return f"Encounter {self.pk} [{self.status}]"


class Vital(TenantModel):
    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.SET_NULL
    )
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    temperature_c = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    systolic = models.PositiveIntegerField(null=True, blank=True)
    diastolic = models.PositiveIntegerField(null=True, blank=True)
    heart_rate = models.PositiveIntegerField(null=True, blank=True)
    respiratory_rate = models.PositiveIntegerField(null=True, blank=True)
    oxygen_saturation = models.PositiveIntegerField(null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    height_cm = models.PositiveIntegerField(null=True, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class ClinicalNote(TenantModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    note_type = models.CharField(max_length=30, default="progress")
    content = models.TextField(blank=True)
    # Structured clinical history
    history_of_present_illness = models.TextField(blank=True)
    past_medical_history = models.TextField(blank=True)
    history_of_surgery = models.TextField(blank=True)
    approved = models.BooleanField(default=False)
    amended_from = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT
    )


class Diagnosis(TenantModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    code = models.CharField(max_length=30)
    description = models.CharField(max_length=300)


class CarePlan(TenantModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    description = models.TextField()
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class LabOrder(TenantModel):
    class Status(models.TextChoices):
        AWAITING_PAYMENT = "awaiting_payment", "Awaiting Payment"
        ORDERED = "ordered", "Ordered"
        IN_PROGRESS = "in_progress", "In Progress"
        RESULTED = "resulted", "Result entered"
        REVIEWED = "reviewed", "Reviewed"
        CANCELLED = "cancelled", "Cancelled"

    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.SET_NULL
    )
    admission = models.ForeignKey(
        "InpatientAdmission", null=True, blank=True, on_delete=models.PROTECT,
        related_name="lab_orders",
    )
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    test_name = models.CharField(max_length=200)
    price_cents = models.PositiveIntegerField(default=2500)
    bill = models.ForeignKey(
        "Bill", null=True, blank=True, on_delete=models.PROTECT, related_name="lab_orders"
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ORDERED
    )
    ordered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class LabResult(TenantModel):
    order = models.ForeignKey(LabOrder, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    result = models.TextField()
    reference_range = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, default="preliminary")
    entered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    amended_from = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT
    )


class Prescription(TenantModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    medication = models.CharField(max_length=200)
    dosage = models.CharField(max_length=100)
    instructions = models.TextField(blank=True)
    authorized_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=20, default="authorized")
    dispensed_at = models.DateTimeField(null=True, blank=True)


class Referral(TenantModel):
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.PROTECT
    )
    specialty = models.CharField(max_length=100)
    destination = models.CharField(max_length=200)
    status = models.CharField(max_length=20, default="requested")
    summary = models.TextField(blank=True)


class Ward(TenantModel):
    name = models.CharField(max_length=100)
    location = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return self.name


class Bed(TenantModel):
    ward = models.ForeignKey(Ward, on_delete=models.PROTECT)
    label = models.CharField(max_length=30)
    status = models.CharField(max_length=20, default="available")
    daily_rate_cents = models.PositiveIntegerField(
        default=0,
        help_text="Room charge for each completed 24-hour stay period, in cents.",
    )
    patient = models.ForeignKey(
        Patient, null=True, blank=True, on_delete=models.PROTECT
    )

    def __str__(self):
        return f"{self.ward.name} / {self.label}"


class Bill(TenantModel):
    class CareType(models.TextChoices):
        OPD = "opd", "Outpatient"
        IPD = "ipd", "Inpatient"

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.PROTECT
    )
    invoice_number = models.CharField(max_length=40, unique=True)
    items = models.JSONField(default=list)
    total_cents = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, default="unpaid")
    care_type = models.CharField(
        max_length=3, choices=CareType.choices, default=CareType.OPD
    )

    def __str__(self):
        return self.invoice_number


class InpatientAdmission(TenantModel):
    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="inpatient_admissions"
    )
    bed = models.ForeignKey(
        Bed, on_delete=models.PROTECT, related_name="admissions"
    )
    clinician = models.ForeignKey(
        Clinician, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="inpatient_admissions",
    )
    department = models.CharField(max_length=100, blank=True)
    admitted_at = models.DateTimeField(default=timezone.now)
    discharged_at = models.DateTimeField(null=True, blank=True)
    diagnosis = models.TextField(blank=True)
    history_of_present_illness = models.TextField(blank=True)
    past_medical_history = models.TextField(blank=True)
    history_of_surgery = models.TextField(blank=True)
    room_rate_cents = models.PositiveIntegerField(default=0)
    room_rate_started_at = models.DateTimeField(default=timezone.now)
    admitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="inpatient_admissions_created",
    )
    discharged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="inpatient_admissions_discharged",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["patient"],
                condition=models.Q(discharged_at__isnull=True),
                name="unique_active_inpatient_patient",
            ),
            models.UniqueConstraint(
                fields=["bed"],
                condition=models.Q(discharged_at__isnull=True),
                name="unique_active_inpatient_bed",
            ),
        ]
        indexes = [models.Index(fields=["organization", "discharged_at"])]

    def __str__(self):
        return f"{self.patient} - {self.bed} ({self.admitted_at:%Y-%m-%d})"


class InpatientMedicationPlan(TenantModel):
    class Status(models.TextChoices):
        CONTINUE = "continue", "Continue"
        STOPPED = "stopped", "Stopped"

    admission = models.ForeignKey(
        InpatientAdmission, on_delete=models.PROTECT, related_name="medication_plans"
    )
    medication = models.CharField(max_length=200)
    dosage = models.CharField(max_length=100)
    frequency = models.CharField(max_length=100, blank=True)
    instructions = models.TextField(blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.CONTINUE
    )
    prescribed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT
    )


class InpatientMedicationAdministration(TenantModel):
    admission = models.ForeignKey(
        InpatientAdmission, on_delete=models.PROTECT, related_name="drug_administrations"
    )
    plan = models.ForeignKey(
        InpatientMedicationPlan, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="administrations",
    )
    medication = models.CharField(max_length=200)
    dosage = models.CharField(max_length=100)
    administered_at = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True)
    administered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class InpatientDoctorNote(TenantModel):
    admission = models.ForeignKey(
        InpatientAdmission, on_delete=models.PROTECT, related_name="doctor_notes"
    )
    content = models.TextField()
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class InpatientRoomCharge(TenantModel):
    admission = models.ForeignKey(
        InpatientAdmission, on_delete=models.PROTECT, related_name="room_charges"
    )
    bill = models.OneToOneField(
        Bill, on_delete=models.PROTECT, related_name="inpatient_room_charge"
    )
    day_number = models.PositiveIntegerField()
    amount_cents = models.PositiveIntegerField()
    charged_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["admission", "day_number"],
                name="unique_inpatient_room_charge_day",
            )
        ]
        ordering = ["day_number"]


class Payment(TenantModel):
    bill = models.ForeignKey(Bill, on_delete=models.PROTECT)
    amount_cents = models.PositiveIntegerField()
    method = models.CharField(max_length=30, default="simulated")
    reference = models.CharField(max_length=100, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class InsuranceClaim(TenantModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        PARTIALLY_APPROVED = "partially_approved", "Partially Approved"
        DENIED = "denied", "Denied"
        WITHDRAWN = "withdrawn", "Withdrawn"

    bill = models.ForeignKey(
        Bill, on_delete=models.PROTECT, related_name="insurance_claims"
    )
    claim_number = models.CharField(max_length=40, unique=True)
    payer_name = models.CharField(max_length=120)
    member_reference = models.CharField(max_length=100)
    requested_cents = models.PositiveIntegerField()
    approved_cents = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=24, choices=Status.choices, default=Status.DRAFT
    )
    notes = models.TextField(blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class FollowUp(TenantModel):
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.PROTECT
    )
    due_at = models.DateTimeField()
    message = models.CharField(max_length=300)
    completed = models.BooleanField(default=False)


class AuditEvent(TenantModel):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL
    )
    action = models.CharField(max_length=100)
    resource_type = models.CharField(max_length=100)
    resource_id = models.CharField(max_length=100)
    details = models.JSONField(default=dict)


class Consent(TenantModel):
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    scope = models.CharField(max_length=100)
    granted = models.BooleanField(default=True)
    expires_at = models.DateTimeField(null=True, blank=True)


class VirtualSession(TenantModel):
    class Status(models.TextChoices):
        BOOKED = "booked", "Booked"
        INTAKE = "intake", "Intake"
        WAITING = "waiting", "Waiting"
        CONSULTING = "consulting", "Consulting"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    clinician = models.ForeignKey(Clinician, on_delete=models.PROTECT)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.BOOKED
    )
    scheduled_at = models.DateTimeField()


# ── New models added in Phase 2 ──────────────────────────────────────────────


class Allergy(TenantModel):
    """Known patient allergies recorded by clinical staff."""

    SEVERITY_CHOICES = [
        ("mild", "Mild"),
        ("moderate", "Moderate"),
        ("severe", "Severe"),
        ("life_threatening", "Life Threatening"),
    ]

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="allergy_records"
    )
    substance = models.CharField(max_length=200)
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default="mild")
    reaction = models.TextField(blank=True)

    def __str__(self):
        return f"{self.patient} – {self.substance} ({self.severity})"


class DischargeNote(TenantModel):
    """Discharge summary note linked to a completed encounter."""

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="discharge_notes"
    )
    encounter = models.ForeignKey(
        Encounter, on_delete=models.PROTECT, related_name="discharge_notes"
    )
    content = models.TextField()
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    def __str__(self):
        return f"Discharge note for {self.patient} (encounter {self.encounter_id})"


class ProxyGrant(TenantModel):
    """Grants a family member or caregiver access to a patient's records."""

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="proxy_grants"
    )
    # The user who is being granted access (grantee)
    grantee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="proxy_access",
    )
    scope = models.CharField(
        max_length=200,
        default="read",
        help_text="Comma-separated permission scopes, e.g. 'read,appointments'",
    )
    active = models.BooleanField(default=True)

    class Meta:
        unique_together = [("patient", "grantee")]

    def __str__(self):
        return f"ProxyGrant: {self.grantee} -> {self.patient} ({'active' if self.active else 'revoked'})"


class PatientMessage(TenantModel):
    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sent_patient_messages"
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="received_patient_messages",
    )
    body = models.TextField(max_length=4000)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "pk"]


class MedicalHistory(TenantModel):
    """Persistent medical history entries for a patient."""

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="medical_histories"
    )
    condition = models.CharField(max_length=300)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.patient} – {self.condition}"
