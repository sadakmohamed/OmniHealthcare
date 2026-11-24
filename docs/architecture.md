# OmniHealthcare Architecture

## Runtime

Browser -> React -> Nginx -> Django REST Framework -> PostgreSQL

- React provides the responsive role workspace.
- JWT authentication identifies the user.
- Django enforces tenant and role permissions in API viewsets.
- PostgreSQL persists synthetic clinical, scheduling, billing, and audit records.
- Nginx serves the React build and reverse-proxies `/api/`.

## Data ownership

Organizations are tenants. Patients, clinicians, appointments, encounters, chart records, lab records,
billing records, consents, virtual sessions, and audit events belong to an organization. API querysets
always filter by the authenticated user's organization.

## Clinical integrity

Appointment slots use a database uniqueness constraint and an atomic availability check. Encounter status
transitions are validated by the server. Completion requires a clinical note linked to the encounter and
patient. Laboratory results must match the order patient and organization. Prescriptions require clinician
authorization. Bills are server-totaled and payments cannot exceed the outstanding balance.

## Security boundary

JWT expiry, hashed passwords, role checks, tenant filtering, CSRF/CORS configuration, secure response
headers, and append-style audit events are used. This is a synthetic demonstration, not a certified
production clinical system.
