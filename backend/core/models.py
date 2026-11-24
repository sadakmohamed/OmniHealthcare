import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=30, unique=True)
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
    organization = models.ForeignKey(
        Organization, null=True, blank=True, on_delete=models.PROTECT
    )
    # Links a patient-role user to their Patient record for self-service access
    patient_id = models.UUIDField(null=True, blank=True)

    def __str__(self):
        return f"{self.username} ({self.role})"


class TenantModel(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Patient(TenantModel):
    medical_record_number = models.CharField(max_length=30, unique=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    date_of_birth = models.DateField()
    sex = models.CharField(max_length=20, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    allergies = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )

    def __str__(self):
        return f"{self.first_name} {self.last_name}"


class Clinician(TenantModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    specialty = models.CharField(max_length=100)

    def __str__(self):
        return f"Dr. {self.user.get_full_name()} ({self.specialty})"


class Appointment(TenantModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        CHECKED_IN = "checked_in", "Checked In"
        CANCELLED = "cancelled", "Cancelled"

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    clinician = models.ForeignKey(Clinician, on_delete=models.PROTECT)
    starts_at = models.DateTimeField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SCHEDULED
    )
    reason = models.CharField(max_length=300, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["clinician", "starts_at"], name="unique_clinician_slot"
            ),
        ]
        indexes = [models.Index(fields=["organization", "starts_at"])]

    def __str__(self):
        return f"{self.patient} @ {self.starts_at:%Y-%m-%d %H:%M}"


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

    def __str__(self):
        return f"Encounter {self.pk} [{self.status}]"


class Vital(TenantModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    temperature_c = models.DecimalField(max_digits=4, decimal_places=1, null=True)
    systolic = models.PositiveIntegerField(null=True)
    diastolic = models.PositiveIntegerField(null=True)
    heart_rate = models.PositiveIntegerField(null=True)
    respiratory_rate = models.PositiveIntegerField(null=True)
    oxygen_saturation = models.PositiveIntegerField(null=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class ClinicalNote(TenantModel):
    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    note_type = models.CharField(max_length=30, default="progress")
    content = models.TextField()
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
        ORDERED = "ordered", "Ordered"
        IN_PROGRESS = "in_progress", "In Progress"
        REVIEWED = "reviewed", "Reviewed"
        CANCELLED = "cancelled", "Cancelled"

    encounter = models.ForeignKey(Encounter, on_delete=models.PROTECT)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    test_name = models.CharField(max_length=200)
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
    patient = models.ForeignKey(
        Patient, null=True, blank=True, on_delete=models.PROTECT
    )

    def __str__(self):
        return f"{self.ward.name} / {self.label}"


class Bill(TenantModel):
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT)
    encounter = models.ForeignKey(
        Encounter, null=True, blank=True, on_delete=models.PROTECT
    )
    invoice_number = models.CharField(max_length=40, unique=True)
    items = models.JSONField(default=list)
    total_cents = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, default="unpaid")

    def __str__(self):
        return self.invoice_number


class Payment(TenantModel):
    bill = models.ForeignKey(Bill, on_delete=models.PROTECT)
    amount_cents = models.PositiveIntegerField()
    method = models.CharField(max_length=30, default="simulated")
    reference = models.CharField(max_length=100, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


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


class MedicalHistory(TenantModel):
    """Persistent medical history entries for a patient."""

    patient = models.ForeignKey(
        Patient, on_delete=models.PROTECT, related_name="medical_histories"
    )
    condition = models.CharField(max_length=300)
    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.patient} – {self.condition}"
