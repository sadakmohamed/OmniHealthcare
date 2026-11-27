from django.core.management.base import BaseCommand

from core.models import InpatientAdmission
from core.services import accrue_room_charges


class Command(BaseCommand):
    help = "Add due 24-hour inpatient room charges to patient bills."

    def handle(self, *args, **options):
        created_count = 0
        admissions = InpatientAdmission.objects.filter(
            discharged_at__isnull=True,
            room_rate_cents__gt=0,
        ).iterator()
        for admission in admissions:
            created_count += len(accrue_room_charges(admission))
        self.stdout.write(
            self.style.SUCCESS(f"Created {created_count} inpatient room charges.")
        )
