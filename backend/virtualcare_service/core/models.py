import uuid

from django.db import models


class VirtualCareAccount(models.Model):
    class Role(models.TextChoices):
        ADMIN = "admin", "Administrator"
        RECEPTIONIST = "receptionist", "Receptionist"
        CLINICIAN = "clinician", "Clinician"
        PATIENT = "patient", "Patient"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.CharField(max_length=64, db_index=True)
    username = models.CharField(max_length=150)
    password = models.CharField(max_length=128)
    display_name = models.CharField(max_length=200)
    role = models.CharField(max_length=20, choices=Role.choices)
    patient_id = models.CharField(max_length=64, blank=True)
    clinician_id = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "username"],
                name="unique_virtualcare_org_username",
            )
        ]
class VirtualVisit(models.Model):
    class Status(models.TextChoices):
        BOOKED = "booked", "Booked"
        INTAKE = "intake", "Intake"
        WAITING = "waiting", "Waiting"
        CONSULTING = "consulting", "Consulting"
        INTERRUPTED = "interrupted", "Interrupted"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    organization = models.CharField(max_length=64, db_index=True)
    appointment_id = models.CharField(max_length=64, blank=True)
    idempotency_key = models.CharField(max_length=100, blank=True)
    patient_id = models.CharField(max_length=64)
    patient_name = models.CharField(max_length=200, blank=True)
    patient_mrn = models.CharField(max_length=64, blank=True)
    clinician_id = models.CharField(max_length=64)
    clinician_name = models.CharField(max_length=200, blank=True)
    scheduled_at = models.DateTimeField()
    reason = models.CharField(max_length=500, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.BOOKED
    )
    consent_active = models.BooleanField(default=False)
    consent_updated_at = models.DateTimeField(null=True, blank=True)
    consent_revision = models.PositiveBigIntegerField(default=0)
    verified = models.BooleanField(default=False)
    interpreter_requested = models.BooleanField(default=False)
    language = models.CharField(max_length=100, blank=True)
    call_started_at = models.DateTimeField(null=True, blank=True)
    note = models.TextField(blank=True)
    summary = models.TextField(blank=True)
    follow_up_plan = models.CharField(max_length=500, blank=True)
    follow_up_date = models.DateField(null=True, blank=True)
    lab_orders = models.JSONField(default=list)
    prescriptions = models.JSONField(default=list)
    completion_signature = models.CharField(max_length=64, blank=True)
    hospital_synced_at = models.DateTimeField(null=True, blank=True)
    created_by = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_at", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "clinician_id", "scheduled_at"],
                condition=~models.Q(status="cancelled"),
                name="unique_virtualcare_clinician_slot",
            ),
            models.UniqueConstraint(
                fields=["organization", "appointment_id"],
                condition=~models.Q(appointment_id=""),
                name="unique_virtualcare_appointment",
            ),
            models.UniqueConstraint(
                fields=["organization", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_virtualcare_idempotency_key",
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "status", "scheduled_at"]),
        ]


class VirtualAuditEvent(models.Model):
    organization = models.CharField(max_length=64, db_index=True)
    visit = models.ForeignKey(
        VirtualVisit, on_delete=models.CASCADE, related_name="audit_events"
    )
    actor_id = models.CharField(max_length=64)
    action = models.CharField(max_length=100)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
