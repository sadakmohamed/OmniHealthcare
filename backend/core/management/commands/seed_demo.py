"""
Rich synthetic seed command for OmniHealthcare demo data.

Run:  python manage.py seed_demo
All passwords:  Password123!
"""

import random
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import (
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

User = get_user_model()

PASSWORD = "Password123!"

# ---------------------------------------------------------------------------
# Synthetic patient data
# ---------------------------------------------------------------------------
PATIENT_DATA = [
    ("Amina",    "Hassan",    "1990-04-12", "Female", "+254-700-100001", "amina.hassan@demo.example"),
    ("Fatima",   "Ibrahim",   "1985-07-23", "Female", "+254-700-100002", "fatima.ibrahim@demo.example"),
    ("Yusuf",    "Omondi",    "1978-11-05", "Male",   "+254-700-100003", "yusuf.omondi@demo.example"),
    ("Nadia",    "Kamau",     "1995-02-14", "Female", "+254-700-100004", "nadia.kamau@demo.example"),
    ("Omar",     "Mwangi",    "1963-09-30", "Male",   "+254-700-100005", "omar.mwangi@demo.example"),
    ("Zainab",   "Njoroge",   "2000-05-18", "Female", "+254-700-100006", "zainab.njoroge@demo.example"),
    ("Khalid",   "Otieno",    "1988-12-01", "Male",   "+254-700-100007", "khalid.otieno@demo.example"),
    ("Mariam",   "Wanjiku",   "1972-03-27", "Female", "+254-700-100008", "mariam.wanjiku@demo.example"),
    ("Ibrahim",  "Mutua",     "1992-08-09", "Male",   "+254-700-100009", "ibrahim.mutua@demo.example"),
    ("Halima",   "Chebet",    "1980-06-15", "Female", "+254-700-100010", "halima.chebet@demo.example"),
]

CLINICIAN_DATA = [
    ("dr_waweru",   "James",   "Waweru",    "General Medicine"),
    ("dr_muthoni",  "Grace",   "Muthoni",   "Obstetrics & Gynaecology"),
    ("dr_odhiambo", "Patrick", "Odhiambo",  "Internal Medicine"),
]

STAFF_ROLES = [
    ("admin",        "Admin",       "Staff"),
    ("receptionist", "Reception",   "Staff"),
    ("nurse",        "Nurse",       "Wanjiru"),
    ("lab",          "Lab",         "Tech"),
    ("pharmacist",   "Pharmacy",    "Staff"),
    ("billing",      "Billing",     "Admin"),
]

ALLERGY_DATA = [
    ("Penicillin",  "severe",        "Anaphylaxis"),
    ("Sulfa drugs", "moderate",      "Rash and urticaria"),
    ("Aspirin",     "mild",          "Gastric upset"),
    ("Latex",       "moderate",      "Contact dermatitis"),
    ("Peanuts",     "life_threatening", "Anaphylactic shock"),
    ("Ibuprofen",   "mild",          "Nausea"),
    ("Codeine",     "moderate",      "Severe itching"),
]

CONDITION_DATA = [
    ("Type 2 Diabetes Mellitus",   "Diagnosed 2018, managed with Metformin"),
    ("Hypertension",               "Essential hypertension, on Amlodipine 5mg"),
    ("Asthma",                     "Moderate persistent, uses salbutamol inhaler"),
    ("Chronic Kidney Disease",     "Stage 3, monitored quarterly"),
    ("Hypothyroidism",             "On levothyroxine 50mcg daily"),
    ("Anaemia",                    "Iron-deficiency, corrected with supplements"),
    ("Peptic Ulcer Disease",       "H. pylori eradicated 2021"),
    ("Rheumatoid Arthritis",       "Managed with hydroxychloroquine"),
]

LAB_TESTS = [
    ("Complete Blood Count",           "4.5–11.0 × 10⁹/L"),
    ("Fasting Blood Glucose",          "3.9–6.1 mmol/L"),
    ("HbA1c",                          "< 48 mmol/mol (< 6.5%)"),
    ("Lipid Panel",                    "LDL < 2.6 mmol/L"),
    ("Urine Analysis",                 "No significant findings"),
    ("Liver Function Tests",           "ALT 7–56 U/L"),
    ("Renal Function Tests",           "Creatinine 62–115 µmol/L"),
    ("Thyroid Stimulating Hormone",    "0.4–4.0 mIU/L"),
]

MEDICATIONS = [
    ("Metformin 500mg",   "1 tablet twice daily",    "Take with food"),
    ("Amlodipine 5mg",    "1 tablet once daily",     "Take in the morning"),
    ("Levothyroxine 50mcg","1 tablet once daily",    "Take 30 minutes before breakfast"),
    ("Salbutamol inhaler","2 puffs as needed",       "Max 8 puffs in 24h"),
    ("Omeprazole 20mg",   "1 tablet once daily",     "Take before meals"),
    ("Paracetamol 500mg", "1-2 tablets every 6h",   "Max 8 tablets per day"),
    ("Amoxicillin 500mg", "1 capsule three times daily", "Complete the full course"),
    ("Ibuprofen 400mg",   "1 tablet three times daily with food", "Avoid on empty stomach"),
]

DIAGNOSES = [
    ("E11.9",  "Type 2 diabetes mellitus without complications"),
    ("I10",    "Essential hypertension"),
    ("J45.1",  "Mild intermittent asthma"),
    ("N18.3",  "Chronic kidney disease, stage 3"),
    ("E03.9",  "Hypothyroidism, unspecified"),
    ("D50.9",  "Iron deficiency anaemia, unspecified"),
    ("K27.9",  "Peptic ulcer, unspecified"),
    ("M06.9",  "Rheumatoid arthritis, unspecified"),
    ("J06.9",  "Acute upper respiratory infection, unspecified"),
    ("A09",    "Other and unspecified gastroenteritis"),
]

NOTE_TEMPLATES = [
    "Patient presents with {complaint}. Vitals stable. Plan: {plan}.",
    "Follow-up visit for {condition}. Responding well to treatment. Continue current regimen.",
    "Patient reports improvement in symptoms. Advised to maintain medication schedule and return in 4 weeks.",
    "Reviewed laboratory results. Findings within acceptable range. Adjusted dosage of {medication}.",
    "Clinical assessment completed. Referral to {specialty} recommended for further evaluation.",
]


def _rand_note(complaint="general malaise", plan="monitor and review", condition="hypertension",
               medication="Metformin", specialty="Internal Medicine"):
    tpl = random.choice(NOTE_TEMPLATES)
    return tpl.format(complaint=complaint, plan=plan, condition=condition,
                      medication=medication, specialty=specialty)


class Command(BaseCommand):
    help = "Seed OmniHealthcare with rich synthetic demo data."

    def handle(self, *args, **options):
        self.stdout.write("── Seeding OmniHealthcare demo data ──")

        # ── Organization ──────────────────────────────────────────────────────
        org, _ = Organization.objects.get_or_create(
            code="OMNI-DEMO",
            defaults={"name": "OmniHealthcare Synthetic Demo"},
        )
        self.stdout.write(f"  ✓ Organization: {org.name}")

        # ── Staff users ───────────────────────────────────────────────────────
        staff = {}
        for username, first, last in STAFF_ROLES:
            u, _ = User.objects.get_or_create(
                username=username,
                defaults={
                    "role": username,
                    "organization": org,
                    "first_name": first,
                    "last_name": last,
                    "email": f"{username}@omni.demo",
                },
            )
            u.role = username
            u.organization = org
            u.first_name = first
            u.last_name = last
            u.set_password(PASSWORD)
            u.save()
            staff[username] = u

        self.stdout.write(f"  ✓ Staff users: {len(staff)}")

        # ── Clinician users + Clinician records ───────────────────────────────
        clinicians = []
        for username, first, last, specialty in CLINICIAN_DATA:
            u, _ = User.objects.get_or_create(
                username=username,
                defaults={
                    "role": "clinician",
                    "organization": org,
                    "first_name": first,
                    "last_name": last,
                    "email": f"{username}@omni.demo",
                },
            )
            u.role = "clinician"
            u.organization = org
            u.first_name = first
            u.last_name = last
            u.set_password(PASSWORD)
            u.save()
            clin, _ = Clinician.objects.get_or_create(
                user=u, defaults={"organization": org, "specialty": specialty}
            )
            clin.organization = org
            clin.specialty = specialty
            clin.save()
            clinicians.append(clin)

        self.stdout.write(f"  ✓ Clinicians: {len(clinicians)}")

        # ── 10 Patients + patient user accounts ──────────────────────────────
        patients = []
        for idx, (first, last, dob, sex, phone, email) in enumerate(PATIENT_DATA, start=1):
            mrn = f"MRN-{idx:04d}"
            username = f"patient_{first.lower()}"
            pu, _ = User.objects.get_or_create(
                username=username,
                defaults={
                    "role": "patient",
                    "organization": org,
                    "first_name": first,
                    "last_name": last,
                    "email": email,
                },
            )
            pu.role = "patient"
            pu.organization = org
            pu.first_name = first
            pu.last_name = last
            pu.email = email
            pu.set_password(PASSWORD)

            pt, _ = Patient.objects.get_or_create(
                medical_record_number=mrn,
                defaults={
                    "organization": org,
                    "first_name": f"Demo {first}",
                    "last_name": last,
                    "date_of_birth": dob,
                    "sex": sex,
                    "phone": phone,
                    "email": email,
                    "owner": pu,
                },
            )
            pu.patient_id = pt.pk
            pu.save()
            patients.append(pt)

        self.stdout.write(f"  ✓ Patients: {len(patients)}")

        # ── 5 Extra demo patient users (no linked Patient record – for testing) ──
        for i in range(1, 6):
            u, _ = User.objects.get_or_create(
                username=f"demo_patient_{i}",
                defaults={
                    "role": "patient",
                    "organization": org,
                    "first_name": f"Demo{i}",
                    "last_name": "User",
                    "email": f"demo_patient_{i}@omni.demo",
                },
            )
            u.role = "patient"
            u.organization = org
            u.set_password(PASSWORD)
            u.save()

        # ── Allergies ─────────────────────────────────────────────────────────
        for pt in patients[:7]:
            substance, severity, reaction = random.choice(ALLERGY_DATA)
            Allergy.objects.get_or_create(
                organization=org, patient=pt, substance=substance,
                defaults={"severity": severity, "reaction": reaction},
            )

        self.stdout.write("  ✓ Allergies seeded")

        # ── Medical histories ─────────────────────────────────────────────────
        for pt in patients:
            condition, notes = random.choice(CONDITION_DATA)
            MedicalHistory.objects.get_or_create(
                organization=org, patient=pt, condition=condition,
                defaults={"notes": notes},
            )

        self.stdout.write("  ✓ Medical histories seeded")

        # ── 20 Appointments across different dates/statuses ───────────────────
        appointment_statuses = (
            ["scheduled"] * 10 + ["checked_in"] * 5 + ["cancelled"] * 5
        )
        appointments = []
        now = timezone.now()
        used_slots = set()
        appt_index = 0
        for pt in patients:
            clin = clinicians[appt_index % len(clinicians)]
            offset_days = random.randint(-7, 14)
            offset_hours = random.randint(8, 16)
            starts_at = (now + timedelta(days=offset_days)).replace(
                hour=offset_hours, minute=0, second=0, microsecond=0
            )
            # Ensure unique slot per clinician
            slot_key = (clin.pk, starts_at)
            if slot_key in used_slots:
                starts_at = starts_at + timedelta(minutes=30)
                slot_key = (clin.pk, starts_at)
            used_slots.add(slot_key)

            status = appointment_statuses[appt_index % len(appointment_statuses)]
            appt, _ = Appointment.objects.get_or_create(
                organization=org,
                clinician=clin,
                starts_at=starts_at,
                defaults={
                    "patient": pt,
                    "status": status,
                    "reason": f"Demo visit – {random.choice(['check-up', 'follow-up', 'acute complaint', 'lab review'])}",
                },
            )
            appointments.append(appt)
            appt_index += 1

        # 10 extra appointments
        for i in range(10):
            pt = random.choice(patients)
            clin = clinicians[i % len(clinicians)]
            offset = timedelta(days=random.randint(-30, 30), hours=random.randint(1, 8))
            starts_at = (now + offset).replace(minute=0, second=0, microsecond=0)
            slot_key = (clin.pk, starts_at)
            if slot_key in used_slots:
                starts_at += timedelta(minutes=15)
            used_slots.add((clin.pk, starts_at))
            status = random.choice(["scheduled", "scheduled", "cancelled"])
            appt, _ = Appointment.objects.get_or_create(
                organization=org,
                clinician=clin,
                starts_at=starts_at,
                defaults={"patient": pt, "status": status, "reason": "Synthetic demo booking"},
            )
            appointments.append(appt)

        self.stdout.write(f"  ✓ Appointments: {Appointment.objects.filter(organization=org).count()}")

        # ── 10 Encounters in various states ──────────────────────────────────
        enc_statuses = [
            "scheduled", "checked_in", "in_progress", "in_progress",
            "documentation_pending", "completed", "completed",
            "completed", "cancelled", "entered_in_error",
        ]
        encounters = []
        for idx, pt in enumerate(patients):
            clin = clinicians[idx % len(clinicians)]
            appt = appointments[idx] if idx < len(appointments) else None
            enc_status = enc_statuses[idx % len(enc_statuses)]
            enc, _ = Encounter.objects.get_or_create(
                organization=org,
                patient=pt,
                clinician=clin,
                appointment=appt,
                defaults={"status": enc_status},
            )
            encounters.append(enc)

        self.stdout.write(f"  ✓ Encounters: {len(encounters)}")

        # ── Vitals ────────────────────────────────────────────────────────────
        nurse_user = staff["nurse"]
        for enc in encounters[:8]:
            Vital.objects.get_or_create(
                organization=org,
                encounter=enc,
                patient=enc.patient,
                defaults={
                    "temperature_c": round(random.uniform(36.0, 38.5), 1),
                    "systolic": random.randint(100, 160),
                    "diastolic": random.randint(60, 100),
                    "heart_rate": random.randint(60, 100),
                    "respiratory_rate": random.randint(14, 22),
                    "oxygen_saturation": random.randint(94, 100),
                    "recorded_by": nurse_user,
                },
            )

        self.stdout.write("  ✓ Vitals seeded")

        # ── Clinical notes (required for completed encounters) ────────────────
        clinician_user = clinicians[0].user
        for enc in encounters:
            if enc.status in ("completed", "documentation_pending", "in_progress"):
                ClinicalNote.objects.get_or_create(
                    organization=org,
                    encounter=enc,
                    patient=enc.patient,
                    defaults={
                        "author": clinician_user,
                        "note_type": "progress",
                        "content": _rand_note(),
                        "approved": enc.status == "completed",
                    },
                )

        self.stdout.write("  ✓ Clinical notes seeded")

        # ── Diagnoses ─────────────────────────────────────────────────────────
        for idx, enc in enumerate(encounters[:8]):
            code, desc = DIAGNOSES[idx % len(DIAGNOSES)]
            Diagnosis.objects.get_or_create(
                organization=org, encounter=enc, patient=enc.patient, code=code,
                defaults={"description": desc},
            )

        self.stdout.write("  ✓ Diagnoses seeded")

        # ── Care plans ────────────────────────────────────────────────────────
        for enc in encounters[:6]:
            CarePlan.objects.get_or_create(
                organization=org, encounter=enc, patient=enc.patient,
                defaults={
                    "description": "Continue current medication regimen. Diet and exercise counselling provided. Review in 4 weeks.",
                    "approved_by": clinician_user,
                },
            )

        self.stdout.write("  ✓ Care plans seeded")

        # ── Lab orders & results ──────────────────────────────────────────────
        lab_user = staff["lab"]
        lab_orders = []
        for idx, enc in enumerate(encounters[:8]):
            test, ref = LAB_TESTS[idx % len(LAB_TESTS)]
            order, _ = LabOrder.objects.get_or_create(
                organization=org, encounter=enc, patient=enc.patient, test_name=test,
                defaults={
                    "ordered_by": enc.clinician.user,
                    "status": random.choice(["ordered", "in_progress", "reviewed"]),
                },
            )
            lab_orders.append(order)
            if order.status in ("reviewed",):
                LabResult.objects.get_or_create(
                    organization=org, order=order, patient=enc.patient,
                    defaults={
                        "result": f"Result within normal range. Value: {round(random.uniform(3.5, 7.0), 2)}",
                        "reference_range": ref,
                        "status": "final",
                        "entered_by": lab_user,
                    },
                )

        self.stdout.write("  ✓ Lab orders & results seeded")

        # ── Prescriptions ─────────────────────────────────────────────────────
        pharmacist_user = staff["pharmacist"]
        for idx, enc in enumerate(encounters[:8]):
            med, dosage, instructions = MEDICATIONS[idx % len(MEDICATIONS)]
            status_choice = random.choice(["authorized", "authorized", "dispensed"])
            Prescription.objects.get_or_create(
                organization=org, encounter=enc, patient=enc.patient, medication=med,
                defaults={
                    "dosage": dosage,
                    "instructions": instructions,
                    "authorized_by": enc.clinician.user,
                    "status": status_choice,
                    "dispensed_at": timezone.now() if status_choice == "dispensed" else None,
                },
            )

        self.stdout.write("  ✓ Prescriptions seeded")

        # ── Referrals ─────────────────────────────────────────────────────────
        for idx, enc in enumerate(encounters[:5]):
            Referral.objects.get_or_create(
                organization=org, encounter=enc, patient=enc.patient,
                specialty=random.choice(["Cardiology", "Nephrology", "Endocrinology", "Ophthalmology"]),
                defaults={
                    "destination": "Kenyatta National Hospital",
                    "status": random.choice(["requested", "accepted", "completed"]),
                    "summary": "Referral for specialist review following initial assessment.",
                },
            )

        self.stdout.write("  ✓ Referrals seeded")

        # ── Wards & beds ──────────────────────────────────────────────────────
        ward_data = [
            ("Ward A – General", "Ground Floor"),
            ("Ward B – Maternity", "First Floor"),
            ("ICU",               "Second Floor"),
        ]
        for wname, wloc in ward_data:
            ward, _ = Ward.objects.get_or_create(
                organization=org, name=wname, defaults={"location": wloc}
            )
            for bed_num in range(1, 5):
                label = f"{wname[0]}-{bed_num:02d}"
                is_occupied = bed_num <= 2
                pt = patients[bed_num - 1] if is_occupied else None
                Bed.objects.get_or_create(
                    organization=org, ward=ward, label=label,
                    defaults={
                        "status": "occupied" if is_occupied else "available",
                        "patient": pt,
                    },
                )

        self.stdout.write("  ✓ Wards & beds seeded")

        # ── Bills & payments ──────────────────────────────────────────────────
        billing_user = staff["billing"]
        for idx, enc in enumerate(encounters[:8]):
            inv_no = f"INV-{2026}-{idx + 1:04d}"
            bill, _ = Bill.objects.get_or_create(
                invoice_number=inv_no,
                defaults={
                    "organization": org,
                    "patient": enc.patient,
                    "encounter": enc,
                    "items": [
                        {"description": "Consultation fee", "amount_cents": 3000},
                        {"description": "Laboratory tests", "amount_cents": 2500},
                        {"description": "Medication", "amount_cents": 1500},
                    ],
                    "total_cents": 7000,
                    "status": "unpaid",
                },
            )
            # Some bills partially or fully paid
            if idx % 3 == 0:
                # Fully paid
                Payment.objects.get_or_create(
                    organization=org, bill=bill, amount_cents=bill.total_cents,
                    defaults={"method": "mpesa", "reference": f"MPE{idx:06d}", "recorded_by": billing_user},
                )
                bill.status = "paid"
                bill.save(update_fields=["status"])
            elif idx % 3 == 1:
                # Partial payment
                Payment.objects.get_or_create(
                    organization=org, bill=bill, amount_cents=3000,
                    defaults={"method": "cash", "reference": "", "recorded_by": billing_user},
                )
                bill.status = "partial"
                bill.save(update_fields=["status"])

        self.stdout.write("  ✓ Bills & payments seeded")

        # ── Follow-up reminders ───────────────────────────────────────────────
        for idx, enc in enumerate(encounters[:8]):
            FollowUp.objects.get_or_create(
                organization=org, encounter=enc, patient=enc.patient,
                defaults={
                    "due_at": timezone.now() + timedelta(days=random.randint(7, 30)),
                    "message": random.choice([
                        "Return for lab results review.",
                        "Blood pressure check in 2 weeks.",
                        "Review HbA1c results.",
                        "Post-operative follow-up visit.",
                    ]),
                    "completed": idx < 2,
                },
            )

        self.stdout.write("  ✓ Follow-up reminders seeded")

        # ── Discharge notes (for completed encounters) ────────────────────────
        for enc in encounters:
            if enc.status == "completed":
                DischargeNote.objects.get_or_create(
                    organization=org, encounter=enc, patient=enc.patient,
                    defaults={
                        "content": (
                            "Patient discharged in stable condition. "
                            "All medications dispensed. "
                            "Advised to return for follow-up in 4 weeks or earlier if symptoms worsen."
                        ),
                        "author": enc.clinician.user,
                    },
                )

        self.stdout.write("  ✓ Discharge notes seeded")

        # ── Proxy grants (family access) ──────────────────────────────────────
        # Grant demo_patient_1 proxy access to first 2 patients
        try:
            proxy_user = User.objects.get(username="demo_patient_1")
            for pt in patients[:2]:
                ProxyGrant.objects.get_or_create(
                    organization=org, patient=pt, grantee=proxy_user,
                    defaults={"scope": "read,appointments", "active": True},
                )
        except User.DoesNotExist:
            pass

        self.stdout.write("  ✓ Proxy grants seeded")

        # ── Consents ──────────────────────────────────────────────────────────
        for pt in patients[:6]:
            Consent.objects.get_or_create(
                organization=org, patient=pt, scope="data_sharing",
                defaults={"granted": True, "expires_at": None},
            )

        self.stdout.write("  ✓ Consents seeded")

        # ── Virtual sessions ──────────────────────────────────────────────────
        vs_statuses = ["booked", "completed", "cancelled"]
        for idx, pt in enumerate(patients[:5]):
            clin = clinicians[idx % len(clinicians)]
            VirtualSession.objects.get_or_create(
                organization=org, patient=pt, clinician=clin,
                scheduled_at=timezone.now() + timedelta(days=idx + 1),
                defaults={"status": vs_statuses[idx % len(vs_statuses)]},
            )

        self.stdout.write("  ✓ Virtual sessions seeded")

        # ── Audit events ──────────────────────────────────────────────────────
        events = [
            ("encounter.transition", "Encounter"),
            ("patient.created", "Patient"),
            ("prescription.dispensed", "Prescription"),
            ("bill.paid", "Bill"),
        ]
        for action_name, resource_type in events:
            AuditEvent.objects.create(
                organization=org,
                actor=clinician_user,
                action=action_name,
                resource_type=resource_type,
                resource_id=str(encounters[0].pk),
                details={"synthetic": True},
            )

        self.stdout.write("  ✓ Audit events seeded")

        self.stdout.write(self.style.SUCCESS(
            "\n✅  OmniHealthcare demo data seeded successfully!\n"
            "   Login credentials — username: <role>  |  password: Password123!\n"
            "   Patient logins:    patient_amina, patient_fatima, etc.\n"
            "   Clinician logins:  dr_waweru, dr_muthoni, dr_odhiambo\n"
        ))
