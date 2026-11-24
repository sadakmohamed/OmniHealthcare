# OmniHealthcare Prototype

> **SYNTHETIC DEMONSTRATION DATA — NOT FOR CLINICAL USE**
> This is an assessment deliverable using fictional patients and fictional data only. No real patient records, live clinical decisions, or production deployment.

A full-stack electronic health record (EHR) prototype built with React, Django REST Framework, PostgreSQL, and Nginx. Demonstrates the complete OmniHealthcare clinical journey from patient registration through billing.

---

## Architecture

```
Browser (React SPA)
       |
  Nginx (port 80/443)
  ├── /           → serves React dist/
  ├── /api/       → proxies to Django
  └── /static/    → Django static files
       |
  Django REST Framework (port 8000)
  ├── JWT Authentication
  ├── Role-based permissions
  ├── Tenant isolation (organization scoping)
  └── OpenAPI documentation (/api/v1/docs/)
       |
  PostgreSQL (port 5432)
```

**Technology stack:**
- Frontend: React 19, Vite, Axios, Lucide icons
- Backend: Python 3.12, Django 6.1, Django REST Framework 3.18, SimpleJWT
- Database: PostgreSQL 16 (SQLite for local dev)
- Proxy: Nginx 1.27
- Docs: drf-spectacular (OpenAPI 3)
- Containers: Docker Compose

---

## Modules (F01–F12)

| Module | Description | Roles |
|--------|-------------|-------|
| F01 | Patient Registration & Chart | Receptionist, Clinician, Admin |
| F02 | Appointment Booking & Scheduling | Receptionist, Clinician, Patient |
| F03 | Triage & Vitals | Nurse, Clinician |
| F04 | Encounter Notes | Clinician |
| F05 | Diagnosis & Care Plans | Clinician |
| F06 | Lab Orders & Results | Clinician (order), Lab (result) |
| F07 | Medication Prescriptions | Clinician (authorize), Pharmacist (dispense) |
| F08 | Referral Tracking | Clinician |
| F09 | Ward & Bed Status | Nurse, Clinician, Admin |
| F10 | Billing & Insurance Claims | Billing Admin |
| F11 | Follow-up Reminders | Receptionist, Clinician |
| F12 | Clinical Audit History | Admin |

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
..\\.venv\Scripts\python.exe manage.py seed_demo
..\\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

```bash
# Linux / macOS
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cd backend
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 127.0.0.1:8000
```

### 3. Frontend setup (new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

---

## Demo Credentials

All accounts use password: **`Password123!`**

| Username | Role | Access |
|----------|------|--------|
| `receptionist` | Receptionist | Patients, Appointments, Follow-ups |
| `clinician` | Clinician | Full clinical workflow |
| `nurse` | Nurse | Triage, Vitals, Wards |
| `lab` | Lab Technician | Lab orders, results |
| `pharmacist` | Pharmacist | Prescriptions |
| `billing` | Billing Admin | Invoices, Payments |
| `patient` | Patient | Own appointments, results, bills |
| `admin` | Administrator | All screens + Audit |

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
python backend/manage.py seed_demo
```

---

## Running Tests

```bash
cd backend
python manage.py test core.tests --verbosity 2
```

Expected output: all tests pass covering authentication, role permissions, tenant isolation, encounter transitions, lab matching, payment limits.

---

## Docker Compose (Linux)

```bash
cp .env.example .env
# Edit .env to set POSTGRES_PASSWORD, DJANGO_SECRET_KEY

docker compose up --build
```

Access: **http://localhost**
API docs: **http://localhost/api/v1/docs/**

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
export DJANGO_DEBUG=false
export DJANGO_ALLOWED_HOSTS=your-domain.com

python backend/manage.py migrate
python backend/manage.py seed_demo
python backend/manage.py collectstatic --noinput
```

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
# Update nginx.conf: change `server backend:8000` to `server 127.0.0.1:8000`
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
| GET | `/api/v1/health/` | Health check (no auth) |
| GET/POST | `/api/v1/patients/` | Patient list / register |
| GET/POST | `/api/v1/appointments/` | Appointments |
| POST | `/api/v1/appointments/{id}/cancel/` | Cancel appointment |
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
| POST | `/api/v1/beds/{id}/assign/` | Assign/discharge bed |
| GET/POST | `/api/v1/bills/` | Invoices |
| GET/POST | `/api/v1/payments/` | Payments |
| GET/POST | `/api/v1/follow-ups/` | Follow-up reminders |
| GET | `/api/v1/audit/` | Audit log (admin) |
| GET/POST | `/api/v1/consents/` | Consent records |
| GET/POST | `/api/v1/virtual-sessions/` | Virtual care |
| GET | `/api/v1/analytics/` | Dashboard stats |

---

## Database Schema

**Core tables:** Organization, User, Patient, Clinician, Appointment, Encounter, Vital, ClinicalNote, Diagnosis, CarePlan, LabOrder, LabResult, Prescription, Referral, Ward, Bed, Bill, Payment, FollowUp, AuditEvent, Consent, VirtualSession, Allergy, MedicalHistory, DischargeNote, ProxyGrant

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
- Patient-role users only see their own records
- CORS restricted to configured origins
- Security headers via Nginx

---

## Known Limitations

- SQLite default (not recommended for concurrent production use)
- No MFA or OIDC integration (future work)
- No real SMS/email notifications (simulated only)
- No real payment processing (fictional amounts only)
- No HIPAA certification (synthetic prototype only)
- Virtual care has no actual video/audio (simulated state machine)
- AI features not implemented in this version
- FHIR export not implemented in this version

---

## Acceptance Scenarios

| Scenario | Description |
|----------|-------------|
| A | Receptionist registers patient → books appointment → nurse records vitals → clinician completes encounter → lab result on chart |
| B | Clinician creates prescription → pharmacist dispenses → unauthorized role gets 403 |
| C | Ward/bed and billing status changes update dashboard and survive refresh |
| D | Invalid input, duplicate slot, cross-tenant access, and prohibited transitions are rejected |
| E | Follow-up reminders appear on dashboard and can be completed |
| F | Admin views audit log of all actions |

---

## Checklist

| Requirement | Status |
|-------------|--------|
| React frontend | ✅ Complete |
| Django REST Framework backend | ✅ Complete |
| PostgreSQL support | ✅ Complete |
| Nginx configuration | ✅ Complete |
| Versioned API under /api/v1/ | ✅ Complete |
| F01 Patient registration | ✅ Complete |
| F02 Appointment booking | ✅ Complete |
| F03 Triage & vitals | ✅ Complete |
| F04 Encounter notes | ✅ Complete |
| F05 Diagnosis & care plans | ✅ Complete |
| F06 Lab orders & results | ✅ Complete |
| F07 Prescriptions | ✅ Complete |
| F08 Referrals | ✅ Complete |
| F09 Ward & bed status | ✅ Complete |
| F10 Billing & insurance | ✅ Complete |
| F11 Follow-up reminders | ✅ Complete |
| F12 Audit history | ✅ Complete |
| Role-based permissions | ✅ Complete |
| Tenant isolation | ✅ Complete |
| Encounter state machine | ✅ Complete |
| JWT authentication | ✅ Complete |
| Seed data | ✅ Complete |
| Migrations | ✅ Complete |
| Docker Compose | ✅ Complete |
| OpenAPI docs | ✅ Complete |
| Automated tests | ✅ Complete |
| Responsive UI | ✅ Complete |
| Virtual Care (stretch) | ✅ Complete |
| Patient portal (stretch) | ✅ Partial |
| Localization (stretch) | ❌ Not implemented |
| FHIR exports (stretch) | ❌ Not implemented |
| Offline AI drafts (stretch) | ❌ Not implemented |

---

*OmniTeckno Assessment — Synthetic data only — 23 November 2026*
