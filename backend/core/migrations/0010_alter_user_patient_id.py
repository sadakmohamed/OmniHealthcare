import uuid

import django.db.models.deletion
from django.db import migrations, models


def copy_patient_links(apps, schema_editor):
    User = apps.get_model("core", "User")
    Patient = apps.get_model("core", "Patient")
    database = schema_editor.connection.alias

    for user in User.objects.using(database).iterator():
        owned_patient_ids = list(
            Patient.objects.using(database)
            .filter(owner_id=user.pk, organization_id=user.organization_id)
            .order_by("pk")
            .values_list("pk", flat=True)[:2]
        )
        if len(owned_patient_ids) == 1:
            patient_id = owned_patient_ids[0]
        elif user.patient_id is not None:
            try:
                patient_id = int(user.patient_id)
            except (TypeError, ValueError):
                patient_id = uuid.UUID(str(user.patient_id)).int
        else:
            continue

        if Patient.objects.using(database).filter(
            pk=patient_id, organization_id=user.organization_id
        ).exists():
            User.objects.using(database).filter(pk=user.pk).update(
                patient_record_id=patient_id
            )


def restore_patient_links(apps, schema_editor):
    User = apps.get_model("core", "User")
    database = schema_editor.connection.alias
    for user in User.objects.using(database).exclude(
        patient_record_id__isnull=True
    ).iterator():
        User.objects.using(database).filter(pk=user.pk).update(
            patient_id=uuid.UUID(int=user.patient_record_id)
        )


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_organization_time_zone_insuranceclaim_patientmessage_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='patient_record_id',
            field=models.BigIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(copy_patient_links, restore_patient_links),
        migrations.RemoveField(
            model_name='user',
            name='patient_id',
        ),
        migrations.RenameField(
            model_name='user',
            old_name='patient_record_id',
            new_name='patient',
        ),
        migrations.AlterField(
            model_name='user',
            name='patient',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='portal_accounts',
                to='core.patient',
            ),
        ),
    ]
