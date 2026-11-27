import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import (
    AuditEvent,
    Bed,
    Bill,
    InpatientAdmission,
    InpatientRoomCharge,
)


@transaction.atomic
def accrue_room_charges(admission, now=None):
    now = now or timezone.now()
    admission = InpatientAdmission.objects.select_for_update().select_related(
        "patient", "bed", "organization"
    ).get(pk=admission.pk)
    charge_until = min(now, admission.discharged_at) if admission.discharged_at else now
    elapsed_seconds = max(
        0, (charge_until - admission.room_rate_started_at).total_seconds()
    )
    due_days = int(elapsed_seconds // timedelta(days=1).total_seconds())
    if admission.room_rate_cents <= 0 or due_days == 0:
        return []

    charged_days = set(
        InpatientRoomCharge.objects.filter(admission=admission).values_list(
            "day_number", flat=True
        )
    )
    created_charges = []
    for day_number in range(1, due_days + 1):
        if day_number in charged_days:
            continue

        description = (
            f"Inpatient room charge - {admission.bed.label} - day {day_number}"
        )
        bill = Bill.objects.create(
            organization=admission.organization,
            patient=admission.patient,
            invoice_number=f"ROOM-{uuid.uuid4().hex[:16].upper()}",
            items=[{
                "description": description,
                "amount_cents": admission.room_rate_cents,
                "admission_id": str(admission.pk),
                "day_number": day_number,
            }],
            total_cents=admission.room_rate_cents,
            status="unpaid",
            care_type=Bill.CareType.IPD,
        )
        charge = InpatientRoomCharge.objects.create(
            organization=admission.organization,
            admission=admission,
            bill=bill,
            day_number=day_number,
            amount_cents=admission.room_rate_cents,
            charged_at=now,
        )
        AuditEvent.objects.create(
            organization=admission.organization,
            action="inpatient.room_charge_created",
            resource_type="InpatientRoomCharge",
            resource_id=str(charge.pk),
            details={
                "admission_id": str(admission.pk),
                "bill_id": str(bill.pk),
                "day_number": day_number,
                "amount_cents": admission.room_rate_cents,
            },
        )
        created_charges.append(charge)
    return created_charges


@transaction.atomic
def discharge_admission(admission, actor, discharged_at=None):
    admission = InpatientAdmission.objects.select_for_update().get(pk=admission.pk)
    if admission.discharged_at:
        return admission

    discharged_at = discharged_at or timezone.now()
    accrue_room_charges(admission, now=discharged_at)

    admission.discharged_at = discharged_at
    admission.discharged_by = actor
    admission.save(update_fields=["discharged_at", "discharged_by", "updated_at"])

    bed = Bed.objects.select_for_update().get(pk=admission.bed_id)
    if bed.patient_id == admission.patient_id:
        bed.patient = None
        bed.status = "available"
        bed.save(update_fields=["patient", "status", "updated_at"])

    AuditEvent.objects.create(
        organization=admission.organization,
        actor=actor,
        action="inpatient.discharged",
        resource_type="InpatientAdmission",
        resource_id=str(admission.pk),
        details={"patient_id": str(admission.patient_id), "bed_id": str(bed.pk)},
    )
    return admission
