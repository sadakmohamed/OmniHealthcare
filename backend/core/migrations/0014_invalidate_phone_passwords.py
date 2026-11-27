import re

from django.contrib.auth.hashers import check_password, make_password
from django.db import migrations


def invalidate_phone_passwords(apps, schema_editor):
    User = apps.get_model("core", "User")
    users = User.objects.using(schema_editor.connection.alias).filter(
        role="patient", must_change_password=True, patient__isnull=False
    ).select_related("patient")
    for user in users.iterator():
        phones = (user.patient.phone or "", user.username)
        candidates = {digits[-4:] for phone in phones
                      if len(digits := re.sub(r"\D", "", phone)) >= 4}
        if any(check_password(candidate, user.password) for candidate in candidates):
            user.password = make_password(None)
            user.save(update_fields=["password"], using=schema_editor.connection.alias)


class Migration(migrations.Migration):
    dependencies = [("core", "0013_initial_lab_catalog")]

    operations = [
        migrations.RunPython(invalidate_phone_passwords, migrations.RunPython.noop),
    ]
