# Generated migration for Imaging models

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0016_medication_catalog'),
    ]

    operations = [
        migrations.CreateModel(
            name='ImagingTest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('price_cents', models.PositiveIntegerField()),
                ('active', models.BooleanField(default=True)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='core.organization')),
            ],
            options={
                'ordering': ['name'],
                'constraints': [models.UniqueConstraint(fields=('organization', 'name'), name='unique_org_imaging_test_name')],
            },
        ),
        migrations.CreateModel(
            name='ImagingOrder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('test_name', models.CharField(max_length=200)),
                ('price_cents', models.PositiveIntegerField(default=10000)),
                ('status', models.CharField(choices=[('awaiting_payment', 'Awaiting Payment'), ('ordered', 'Ordered'), ('in_progress', 'In Progress'), ('resulted', 'Result entered'), ('reviewed', 'Reviewed'), ('cancelled', 'Cancelled')], default='ordered', max_length=20)),
                ('admission', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='imaging_orders', to='core.inpatientadmission')),
                ('bill', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='imaging_orders', to='core.bill')),
                ('encounter', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='core.encounter')),
                ('ordered_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='core.organization')),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='core.patient')),
            ],
        ),
        migrations.CreateModel(
            name='ImagingResult',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('findings', models.TextField()),
                ('impression', models.TextField(blank=True)),
                ('status', models.CharField(default='preliminary', max_length=20)),
                ('amended_from', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to='core.imagingresult')),
                ('entered_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
                ('organization', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='core.organization')),
                ('order', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='core.imagingorder')),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to='core.patient')),
            ],
        ),
    ]
