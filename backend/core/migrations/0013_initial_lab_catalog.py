from django.db import migrations


def create_initial_tests(apps, schema_editor):
    Organization = apps.get_model("core", "Organization")
    LabTest = apps.get_model("core", "LabTest")
    database = schema_editor.connection.alias
    tests = [
        ("Complete Blood Count (CBC)", 2500),
        ("Fasting Blood Glucose", 1500),
        ("HbA1c (Glycated Hemoglobin)", 2800),
        ("Lipid Panel (Cholesterol & Triglycerides)", 3000),
        ("Liver Function Tests (LFT)", 3500),
        ("Renal Function Tests (Creatinine/BUN)", 3000),
        ("Urinalysis Routine & Microscopy", 1200),
        ("Rapid Malaria Antigen Test", 1000),
        ("Serum Electrolytes (Na/K/Cl)", 2200),
        ("Thyroid Stimulating Hormone (TSH)", 3200),
    ]
    for organization in Organization.objects.using(database).all().iterator():
        for name, price_cents in tests:
            LabTest.objects.using(database).get_or_create(
                organization=organization, name=name,
                defaults={"price_cents": price_cents},
            )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0012_user_failed_login_attempts_user_login_locked_until_and_more"),
    ]

    operations = [migrations.RunPython(create_initial_tests, migrations.RunPython.noop)]
