# OmniHealth

> Local records are for development only. Do not enter real patient information or use this system for clinical decisions.

A healthcare operations platform built with React, Django REST Framework, PostgreSQL, and Nginx.

---

## Architecture

```
Browser (React SPA)
       |
  Nginx (port 80/443)
  ├── /           → serves React dist/
  ├── /api/       → proxies to Django
  ├── /virtual-api/ → proxies to Virtual Care
  └── /static/    → Django static files
       |
       ├── Hospital API (Django, PostgreSQL)
       └── Virtual Care API (separate Django runtime, PostgreSQL)
```

Virtual Care has its own persistent database, API process, audit trail, and optional standalone
accounts. Standalone sign-in, patient/clinician directory, booking, consent, and simulated
consultation do not call the hospital API. The integrated mode can also accept hospital-issued
tokens and synchronize linked visits when the hospital API is available.

**Technology stack:**
- Frontend: React 19, Vite, Axios, Lucide icons
- Backend: Python 3.12, Django 6.1, Django REST Framework 3.18, SimpleJWT
- Database: PostgreSQL 16 (SQLite for local dev)
- Proxy: Nginx 1.27
- Docs: drf-spectacular (OpenAPI 3)
- Containers: Docker Compose

---

## Modules (F01–F13)

| Module | Description | Roles |
|--------|-------------|-------|
| F01 | OPD registration, assigned clinician and patient chart | Receptionist (register), assigned Clinician/Nurse (chart), Admin |
| F02 | Appointment Booking & Scheduling (30-minute slots, clinician weekly availability, duplicate protection) | Receptionist, Clinician, Patient |
| F03 | Triage & Vitals | Nurse (record), assigned Clinician (view), Admin |
| F04 | Encounter Notes | Clinician |
| F05 | Diagnosis & Care Plans | Clinician |
| F06 | Lab Orders & Results | Clinician (order), Billing (release by payment), Lab (paid order/result) |
| F07 | Medication Prescriptions | Clinician (authorize multiple), Pharmacist (dispense) |
| F08 | Referral Tracking | Clinician |
| F09 | Ward & Bed Status | Nurse, Clinician, Admin |
| F10 | Billing and simulated insurance claim lifecycle (draft, submitted, decision) | Billing Admin |
| F11 | Follow-up Reminders | Receptionist, Clinician |
| F12 | Clinical Audit History | Admin |
| F13 | Inpatient Admissions, bedside records and room charges | Nurse (admit/vitals/medication given), Clinician (diagnosis/plans/notes), Admin |

## Inpatient workflow

The Inpatients page lists active admissions and opens each patient's history, vitals, medication
administrations, lab results, medication plan, and doctor notes. Administrators set each bed's room
rate in Ward & Beds; the admission snapshots that rate. Each completed 24-hour period adds one
itemized room-charge invoice. Charges are reconciled on inpatient and billing requests and by the
scheduled management command below.

Lab investigations ordered from an inpatient chart are linked to that active admission and billed
as IPD. Outpatient encounter investigations are billed as OPD. Billing and Pharmacy show these
queues in separate sections; laboratory staff only receive a paid order, with its OPD/IPD source
visible alongside the patient.

Administrators can create wards and beds, inactivate unoccupied beds, reactivate them, and delete unused resources. Bed and ward records with
admission history cannot be deleted, preserving the inpatient audit trail. The attending clinician
can access and manage the inpatient chart, including multi-test orders and multi-drug plans.

## OPD patient workflow

1. Reception registers the patient's name, sex, age, phone, visit date, and assigned consultant. The consultant's configured OPD fee is copied to an invoice.
2. The OPD nurse records vitals. Reception can see triage progress but cannot open the vital-entry action or retrieve clinical measurements.
3. The assigned clinician sees only patients assigned to their profile. Consultation opens after triage and presents demographics, vitals, medical/surgical history, laboratory results, and follow-up scheduling.
4. The clinician can add/remove multiple laboratory investigations. Each order is linked to an itemized invoice and remains hidden from the lab queue until billing records full payment.
5. Paid investigations appear in the lab queue. Entered results are linked back to the patient's chart and refresh in the clinician workspace.
6. The clinician can add/remove multiple prescriptions in the consultation. Authorized rows immediately appear in the pharmacist queue for dispensing.

Role restrictions are enforced by the API as well as by navigation controls. Review local records before use.

## User accounts and laboratory catalog

Administrators can create, edit, inactivate and reactivate accounts in **User Accounts**.
Create a patient record first to link a manually created patient account; creating a clinician
account also creates a clinician profile that can be edited in **Consultants Directory**.
Changing a patient record's phone number does not change its account username; administrators
can update that separately in **User Accounts**. Account roles cannot be changed after creation.
The Accounts list can be searched by name or username and filtered by role and active status.
Users can edit their own name and email and change their password in **My Profile**.
Password changes require the current password and invalidate existing hospital sessions; sign in
again with the new password.
Dashboard metrics are restricted by role in both the API and interface. Administrators see the
facility overview, receptionists see OPD registration and scheduling totals, clinicians see their
assigned patients, own schedule and encounters, and relevant pending lab orders. Nurses see the
OPD triage queue and active bed occupancy; laboratory, pharmacy and billing staff see their
respective work queues. Patients see only appointments available through their own account or
authorized proxy access. The administrator's pending lab count includes orders awaiting payment,
processing or clinical review; reviewed and cancelled orders are excluded. Dashboard search and
date filters apply to the displayed appointment list, not the summary counts.
The "today" schedule count uses the organization's configured time zone.
Hospital tokens used in Virtual Care are checked against the hospital identity endpoint on each
request, so deactivation or password changes revoke access there too. Set `HOSPITAL_IDENTITY_URL`
to the trusted hospital `/api/v1/me/` endpoint when the services run on different hosts. Hospital
identity requests fail closed if that endpoint is unavailable; standalone Virtual Care accounts
do not depend on the hospital service.
The legacy hospital `/api/v1/virtual-sessions/` records are read-only; active virtual workflows
use the separate Virtual Care service.

Reception or an administrator registering a patient creates a linked portal account. The username
is the phone number with spaces, parentheses and hyphens removed (a leading `+` is retained);
the initial password is randomly generated and displayed once to the registering staff member.
Deliver it privately to the patient, who must change it before receiving an access token.
Five failed temporary-password attempts lock that account for 15 minutes; administrators can
reset its password. Migration 0014 invalidates existing, unchanged phone-derived temporary
passwords; an administrator must reset those accounts' passwords before they can sign in.
Use fictional patient data only.

Administrators and billing staff can create, edit, inactivate and reactivate tests in **Lab Test
Catalog**. The consultation screen lists active catalog tests and uses their current price; existing
orders and invoices retain their recorded names and prices. Existing organizations receive the
previous built-in tests during migration; tests for newly created organizations must be configured.
Orders require an active catalog test and use the server-side catalog price.
Lab staff record results; clinicians review them separately. Corrections create a new result and
require a new review. Previously auto-reviewed results are returned to the review queue by migration.

Administrators and pharmacists can manage the **Medication Catalog**; clinicians see active entries
in the consultation form. Existing prescriptions retain their recorded names. Free-text prescriptions
are still allowed when they do not match a catalog entry; this is not a stock-control system.
Users can update their own name and email under **My Profile**.
Reception-entered allergy notes are saved on the patient record and shown to authorized clinical
staff and the patient. Clinicians can read and reply to assigned patients in **Patient Messages**;
use Refresh to check for new messages.

## Scheduling and patient portal

Administrators configure weekly clinician availability from **Consultants → Availability** before
patients can book. Slots are returned in the organization's time zone (default `Africa/Nairobi`);
the API rechecks availability and double-booking during creation.

Patients can choose a clinician, visit type, date, and returned 30-minute slot in the portal.
The portal also exposes chart history, allergies, results, prescriptions, care plans, invoices,
and secure messages to the assigned clinician. Patients can grant scoped, revocable, read-only
proxy access to another patient account in the same organization.

Insurance claims are a simulated internal workflow only. Claims have their own status and audit
history; no insurer is contacted and claim decisions do not create payments.

---

## Prerequisites

- Python 3.12+
- Node.js 22+ and npm 10+
- PostgreSQL 16+ (optional for dev, SQLite default)
- Git

---

## Quick Start (Local Development)

### 1. Clone / extract

```bash
git clone <repo-url> OmniHealthcare
cd OmniHealthcare
```

### 2. Backend setup

```powershell
# Windows PowerShell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

cd backend
..\\.venv\Scripts\python.exe manage.py migrate
..\\.venv\Scripts\python.exe manage.py bootstrap_admin
..\\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

```bash
# Linux / macOS
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cd backend
python manage.py migrate
python manage.py bootstrap_admin
python manage.py runserver 127.0.0.1:8000
```

### 3. Virtual Care service (separate terminal)

```powershell
cd backend
..\.venv\Scripts\python.exe virtualcare_service\manage.py migrate
..\.venv\Scripts\python.exe virtualcare_service\manage.py runserver 127.0.0.1:8001
```

In Linux/macOS, use `python virtualcare_service/manage.py migrate` and
`python virtualcare_service/manage.py runserver 127.0.0.1:8001` from `backend/`.
For integrated hospital-token mode, both services must use the same `DJANGO_SECRET_KEY`; linked
record synchronization uses the shared `VIRTUALCARE_SYNC_SECRET`. Standalone Virtual Care login
uses only the Virtual Care service and its own database.
The standalone Virtual Care app (requirement scenario E) is served at `/virtual-care`
(e.g. `http://127.0.0.1:5173/virtual-care`) and talks only to the Virtual Care service, so it
keeps working while the hospital backend is stopped. It has separate administrator, doctor and
patient sign-ins with their own dashboards. The administrator creates, edits, resets passwords
of, inactivates and reactivates doctors, patients and staff (`/api/v1/directory/`; self-inactivation
is refused); every user can edit their own profile and password (`/api/v1/auth/me/`). Patients self-register, book with
any clinician the administrator has added, give consent, complete intake and join the queue; the
clinician then sees the visit in the waiting queue, consults and completes it.Keep the Virtual Care terminal running while using Virtual Care; verify it at
`http://127.0.0.1:8001/health/`. After pulling database changes, apply both migration commands
before restarting the services.

For standalone Virtual Care identities, configure `VIRTUALCARE_BOOTSTRAP_KEY` on the Virtual Care
service, apply its migrations, and initialize one administrator per organization with
`POST /virtual-api/api/v1/auth/bootstrap/`. Keep that one-time key private and remove it from the
runtime environment after bootstrap. The administrator can provision clinician accounts; patients
can register against the initialized organization from the Virtual Care sign-in screen. These
accounts and visits remain in the Virtual Care database and are not linked to hospital patient IDs.

### 4. Frontend setup (new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

---

## Initial administrator

Run `python manage.py bootstrap_admin` interactively after migrations to create an
organization and its first administrator. Docker Compose no longer seeds demo users;
run `docker compose exec backend python manage.py bootstrap_admin` in a terminal.
Existing database accounts are not modified. For a fictional demonstration, migrate a separate,
empty disposable database, then run `python manage.py seed_initial_data --confirm-disposable-database`
instead of bootstrapping an administrator. The command refuses databases containing organizations
or users. Its fictional accounts use the shared password `Password123!`; never expose this demo
publicly or use it for real data.

---

## Inpatient room charges

Set room rates per bed in **Ward & Beds** before admission. A rate of zero disables room charging.
Room charges accrue once per completed 24-hour period and are added as separate invoices.

Run the reconciliation command periodically in production (for example, every 15 minutes):

```cron
*/15 * * * * cd /var/www/omnihealth/backend && /var/www/omnihealth/.venv/bin/python manage.py accrue_inpatient_room_charges
```

The inpatient and billing API requests also reconcile overdue charges, so missed scheduler runs
are caught up without duplicating a charge.

---

## PostgreSQL Setup

```bash
# Create database
createdb omnihealth
createuser omnihealth -P  # set password

# Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL=postgresql://omnihealth:password@localhost:5432/omnihealth

# Apply migrations
export DATABASE_URL=postgresql://omnihealth:password@localhost:5432/omnihealth
python backend/manage.py migrate
python backend/manage.py bootstrap_admin
```

---

## Running Tests

```bash
cd backend
python manage.py test core.tests --verbosity 2
python virtualcare_service/manage.py test virtualcare_service.core --verbosity 2
```

The suites cover the hospital workflows, patient booking and clinician availability, claims,
messaging/proxy access, and standalone Virtual Care identity and consent transitions. Browser
acceptance testing and a clean Linux/PostgreSQL deployment still need to be recorded separately.

---

## Docker Compose (Linux)

```bash
cp .env.example .env
# Set distinct database passwords, DJANGO_SECRET_KEY, VIRTUALCARE_SYNC_SECRET,
# and a one-time VIRTUALCARE_BOOTSTRAP_KEY

docker compose up --build
```

Access: **http://localhost**
API docs: **http://localhost/api/v1/docs/**
Virtual Care health: **http://localhost/virtual-api/health/**

---

## Linux VPS Deployment (Manual)

### 1. Install dependencies

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3-pip nodejs npm postgresql nginx certbot
```

### 2. Database

```bash
sudo -u postgres createuser omnihealth -P
sudo -u postgres createdb omnihealth -O omnihealth
sudo -u postgres createuser virtualcare -P
sudo -u postgres createdb virtualcare -O virtualcare
```

### 3. Backend

```bash
cd /var/www/omnihealth
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt gunicorn

# Set environment
export DATABASE_URL=postgresql://omnihealth:PASS@localhost/omnihealth
export DJANGO_SECRET_KEY=your-secret-key
export VIRTUALCARE_SYNC_SECRET=your-shared-virtualcare-signing-secret
export DJANGO_DEBUG=false
export DJANGO_ALLOWED_HOSTS=your-domain.com

python backend/manage.py migrate
python backend/manage.py bootstrap_admin
python backend/manage.py collectstatic --noinput
export VIRTUALCARE_DATABASE_URL=postgresql://virtualcare:PASS@localhost/virtualcare
python backend/virtualcare_service/manage.py migrate
```

Configure the `accrue_inpatient_room_charges` command in cron after deployment.

### 4. Gunicorn systemd service

```ini
# /etc/systemd/system/omnihealth.service
[Unit]
Description=OmniHealthcare Django
After=network.target

[Service]
WorkingDirectory=/var/www/omnihealth/backend
Environment=DATABASE_URL=postgresql://omnihealth:PASS@localhost/omnihealth
Environment=DJANGO_SECRET_KEY=your-secret-key
Environment=VIRTUALCARE_SYNC_SECRET=your-shared-virtualcare-signing-secret
Environment=DJANGO_DEBUG=false
Environment=DJANGO_ALLOWED_HOSTS=your-domain.com
ExecStart=/var/www/omnihealth/.venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 --workers 2
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable omnihealth
sudo systemctl start omnihealth
```

Create a separate service for Virtual Care, using its own database and the same JWT and sync
secrets. Keep it running independently of the hospital API:

```ini
# /etc/systemd/system/omnihealth-virtualcare.service
[Unit]
Description=OmniHealthcare Virtual Care
After=network.target

[Service]
WorkingDirectory=/var/www/omnihealth/backend
Environment=VIRTUALCARE_DATABASE_URL=postgresql://virtualcare:PASS@localhost/virtualcare
Environment=DJANGO_SECRET_KEY=your-secret-key
Environment=VIRTUALCARE_SYNC_SECRET=your-shared-virtualcare-signing-secret
Environment=DJANGO_DEBUG=false
Environment=DJANGO_ALLOWED_HOSTS=your-domain.com
ExecStart=/var/www/omnihealth/.venv/bin/gunicorn --chdir /var/www/omnihealth/backend \
    virtualcare_service.wsgi:application --bind 127.0.0.1:8001 --workers 2
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable the service with `sudo systemctl enable --now omnihealth-virtualcare`. In Nginx, route
`/virtual-api/` to `127.0.0.1:8001` and strip the `/virtual-api/` prefix.

### 5. Frontend build

```bash
cd /var/www/omnihealth/frontend
npm ci
npm run build
# dist/ folder contains the built SPA
```

### 6. Nginx configuration

```bash
sudo cp deployments/nginx.conf /etc/nginx/sites-available/omnihealth
sudo ln -s /etc/nginx/sites-available/omnihealth /etc/nginx/sites-enabled/
# Update nginx.conf: set the django upstream to 127.0.0.1:8000 and
# the virtualcare upstream to 127.0.0.1:8001
# Update root path to /var/www/omnihealth/frontend/dist
# Update /static/ alias to /var/www/omnihealth/backend/staticfiles/
sudo nginx -t && sudo systemctl reload nginx
```

### 7. HTTPS with Let's Encrypt

```bash
sudo certbot --nginx -d your-domain.com
```

---

## API Documentation

- **Swagger UI**: http://localhost:8000/api/v1/docs/
- **OpenAPI Schema**: http://localhost:8000/api/v1/schema/

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/login/` | Obtain JWT tokens |
| POST | `/api/v1/auth/refresh/` | Refresh access token |
| GET | `/api/v1/me/` | Current user profile |
| PATCH | `/api/v1/me/` | Update own name and email |
| POST | `/api/v1/auth/change-password/` | Change own password using the current password |
| GET | `/api/v1/health/` | Health check (no auth) |
| GET/POST | `/api/v1/patients/` | Patient list / register |
| GET/POST | `/api/v1/appointments/` | Appointments |
| GET | `/api/v1/appointments/availability-slots/?clinician={id}&date=YYYY-MM-DD` | Available 30-minute slots |
| GET/POST/DELETE | `/api/v1/clinician-availability/` | Admin-managed weekly clinician schedule |
| POST | `/api/v1/appointments/{id}/cancel/` | Cancel appointment |
| POST | `/api/v1/appointments/{id}/checkin/` | Check in clinic visit and open OPD encounter |
| POST | `/virtual-api/api/v1/auth/bootstrap/` | One-time standalone Virtual Care administrator setup |
| POST | `/virtual-api/api/v1/auth/login/` | Standalone Virtual Care login |
| POST | `/virtual-api/api/v1/auth/register/` | Patient registration for an initialized Virtual Care organization |
| GET/POST | `/virtual-api/api/v1/directory/` | Standalone Virtual Care people directory |
| GET/POST | `/virtual-api/api/v1/sessions/` | Standalone or integrated Virtual Care sessions |
| POST | `/virtual-api/api/v1/sessions/{id}/consent/` | Grant or revoke patient consent |
| POST | `/virtual-api/api/v1/sessions/{id}/intake/` | Save visit reason and verification |
| POST | `/virtual-api/api/v1/sessions/{id}/transition/` | Advance, hold, resume, or cancel |
| POST | `/virtual-api/api/v1/sessions/{id}/complete/` | Complete with signed hospital sync record |
| GET/POST | `/api/v1/encounters/` | Encounters |
| POST | `/api/v1/encounters/{id}/transition/` | State transition |
| GET/POST | `/api/v1/vitals/` | Vitals / triage |
| GET/POST | `/api/v1/notes/` | Clinical notes |
| GET/POST | `/api/v1/diagnoses/` | Diagnoses |
| GET/POST | `/api/v1/care-plans/` | Care plans |
| GET/POST | `/api/v1/lab-orders/` | Lab orders |
| GET/POST | `/api/v1/lab-results/` | Lab results |
| GET/POST | `/api/v1/prescriptions/` | Prescriptions |
| POST | `/api/v1/prescriptions/{id}/dispense/` | Dispense prescription |
| GET/POST | `/api/v1/referrals/` | Referrals |
| GET/POST | `/api/v1/wards/` | Wards |
| GET/POST | `/api/v1/beds/` | Beds |
| POST | `/api/v1/lab-orders/batch-order/` | Order multiple OPD or admission-linked IPD investigations |
| POST | `/api/v1/inpatient-medication-plans/batch-create/` | Add multiple inpatient medication plans atomically |
| POST | `/api/v1/beds/{id}/assign/` | Admit/discharge patient |
| GET/PATCH | `/api/v1/inpatient-admissions/` | Active admission list and history/diagnosis updates |
| POST | `/api/v1/inpatient-admissions/{id}/discharge/` | Discharge an inpatient |
| GET/POST/PATCH | `/api/v1/inpatient-medication-plans/` | Inpatient medication plan |
| GET/POST | `/api/v1/inpatient-medication-administrations/` | Medication administration record |
| GET/POST | `/api/v1/inpatient-doctor-notes/` | Inpatient doctor notes |
| GET/POST | `/api/v1/bills/` | Invoices |
| GET/POST | `/api/v1/payments/` | Payments |
| GET/POST | `/api/v1/insurance-claims/` | Simulated insurance claim records |
| POST | `/api/v1/insurance-claims/{id}/submit/` | Submit a draft claim to the simulated workflow |
| POST | `/api/v1/insurance-claims/{id}/adjudicate/` | Record a simulated payer decision |
| GET/POST | `/api/v1/patient-messages/` | Patient and assigned-clinician messages |
| GET/POST/PATCH | `/api/v1/proxy-grants/` | Create/revoke scoped, read-only proxy access |
| GET/POST | `/api/v1/follow-ups/` | Follow-up reminders |
| GET | `/api/v1/audit/` | Audit log (admin) |
| GET/POST | `/api/v1/consents/` | Consent records |
| GET/POST | `/api/v1/virtual-sessions/` | Virtual care |
| GET | `/api/v1/analytics/` | Dashboard stats |

### Example booking sequence

The administrator configures a clinician's weekly schedule once:

```json
POST /api/v1/clinician-availability/
{
  "clinician": "<clinician-id>",
  "weekday": 0,
  "starts_at": "09:00:00",
  "ends_at": "17:00:00",
  "active": true
}
```

The patient portal requests available slots and books one returned `starts_at` value:

```http
GET /api/v1/appointments/availability-slots/?clinician=<clinician-id>&date=2026-11-25
```

```json
POST /api/v1/appointments/
{
  "patient": "<patient-id>",
  "clinician": "<clinician-id>",
  "starts_at": "2026-11-25T06:00:00Z",
  "visit_type": "clinic",
  "reason": "Follow-up"
}
```

All authenticated examples require `Authorization: Bearer <access-token>`. Booking is rejected
if the slot is outside the clinician's configured window or already reserved.

---

## Database Schema

**Hospital tables:** Organization, User, Patient, Clinician, ClinicianAvailability, Appointment, Encounter, Vital, ClinicalNote, Diagnosis, CarePlan, LabOrder, LabResult, Prescription, Referral, Ward, Bed, InpatientAdmission, InpatientMedicationPlan, InpatientMedicationAdministration, InpatientDoctorNote, InpatientRoomCharge, Bill, Payment, InsuranceClaim, FollowUp, AuditEvent, Consent, VirtualSession, Allergy, MedicalHistory, DischargeNote, ProxyGrant, PatientMessage.

**Separate Virtual Care tables:** VirtualCareAccount, VirtualVisit, VirtualAuditEvent.

**Encounter state machine:**
```
scheduled → checked_in → in_progress → documentation_pending → completed
scheduled/checked_in → cancelled
in_progress/documentation_pending → entered_in_error
```

**Virtual session states:**
```
booked → intake → waiting → consulting → completed
booked/intake/waiting → cancelled
```

---

## Security Notes

- Passwords hashed with Django's PBKDF2
- JWT tokens (60-minute access, 1-day refresh)
- All API endpoints require authentication (except /health, /auth/login)
- Tenant isolation: users only see records from their organization
- Role-based permissions enforced server-side
- Patient-role users see their own records; active proxy grants are scoped and read-only
- CORS restricted to configured origins
- Security headers via Nginx

---

## Known Limitations

- SQLite default (not recommended for concurrent production use)
- No MFA or OIDC integration (future work)
- SMS/email providers are not configured
- Payment gateway integration is not configured
- Regulatory and clinical safety reviews are required before live use
- Video conferencing integration is not configured
- Audit coverage and role/tenant permissions still need a comprehensive independent review
- Appointment changes to patient, clinician, time or visit type require cancellation and rebooking
- The medication catalog is not enforced for every free-text prescription or inpatient medication plan
- AI features are not included
- FHIR R4-shaped read-only endpoints under `/api/v1/fhir/` (Patient, Appointment, Encounter, Observation, DiagnosticReport) reuse the REST role/tenant scoping; this is not FHIR certification
- Login is rate limited (`DJANGO_LOGIN_THROTTLE`, default `20/min`)

---

## Acceptance Scenarios

| Scenario | Description |
|----------|-------------|
| A | Receptionist registers patient → books appointment → nurse records vitals → clinician completes encounter → lab result on chart |
| B | Clinician creates prescription → pharmacist dispenses → unauthorized role gets 403 |
| C | Ward/bed and billing status changes update dashboard and survive refresh |
| D | Invalid input, duplicate slot, cross-tenant access, and prohibited transitions are rejected |
| E | Follow-up reminders appear on dashboard and can be completed |
| F | Admin views recorded audit events; coverage of all actions remains to be verified |

---

## Checklist

| Requirement | Status |
|-------------|--------|
| React frontend | ✅ Complete |
| Django REST Framework backend | ✅ Complete |
| PostgreSQL support | ✅ Configured; local verified environment is SQLite |
| Nginx configuration | ✅ Template present; VPS deployment not verified |
| Versioned API under /api/v1/ | ✅ Complete |
| F01–F11 clinical modules | ⚠️ Implemented; complete linked browser walkthrough still required |
| F12 Audit history | ⚠️ Available; complete audit coverage not verified |
| F13 Inpatient chart and room charges | ✅ Complete |
| Role-based permissions | ⚠️ Implemented and tested in selected paths; comprehensive review pending |
| Tenant isolation | ⚠️ Tested in selected paths; comprehensive review pending |
| Encounter state machine | ✅ Complete |
| JWT authentication | ✅ Complete |
| Seed data | ✅ Fictional seed for an empty disposable database |
| Migrations | ✅ Complete |
| Docker Compose | ⚠️ Configuration present; not executed in this environment |
| OpenAPI docs | ✅ Complete |
| Automated backend tests | ✅ Hospital and Virtual Care suites |
| Browser acceptance walkthrough | ❌ Not yet recorded |
| Responsive UI | ✅ Implemented; browser acceptance still pending |
| Virtual Care (stretch) | ✅ Separate data/runtime and standalone identity; no real video |
| Patient portal | ⚠️ Booking, chart and messaging implemented; full walkthrough pending. Proxy access is a stretch feature. |
| Linux/Nginx deployment evidence | ❌ Not yet verified |
| PostgreSQL execution evidence | ❌ Not yet verified |
| Recorded 5–10 minute demo | ❌ Not yet recorded |
| Localization (stretch) | ❌ Not implemented |
| FHIR exports (stretch) | ⚠️ Partial: read-only FHIR-shaped demo, not certified |
| Offline AI drafts (stretch) | ❌ Not implemented |

---

*OmniHealth — 23 November 2026*
