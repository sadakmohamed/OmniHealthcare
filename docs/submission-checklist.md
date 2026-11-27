# Challenge Submission Checklist

Status distinguishes implemented code from evidence that still needs to be produced in the
candidate's deployment environment.

## Implemented

- [x] React application and Django REST Framework APIs
- [ ] Tenant-scoped roles and permissions: implemented and tested in selected paths; comprehensive review pending
- [x] Patient portal clinician discovery and appointment booking
- [x] Admin-managed weekly clinician availability and server-side slot validation
- [x] Appointment idempotency, duplicate-slot protection, cancellation history, and status flow
- [x] Monthly appointment calendar and complete paginated loading for appointments and patient portal lists
- [x] Encounter note corrections preserve the original note and link the amendment
- [x] OPD/IPD workflows, billing, laboratory, pharmacy, inpatient charts, and audit history
- [x] Separate simulated insurance-claim lifecycle (draft, submit, approve/partial/deny)
- [x] Patient chart/history, patient-to-clinician messaging, and scoped read-only proxy grants
- [x] Independent Virtual Care database, native accounts, directory, login, booking, consent gates,
  consultation workflow, and audit events
- [x] PostgreSQL settings, Docker Compose, and Nginx configuration templates
- [x] API and database architecture documentation

Insurance claims are fictional workflow records only: no insurer integration, external claim
submission, or reimbursement settlement is implemented.

## Verification completed in this workspace

- [x] Hospital backend tests — 105 passed using a test-only fast password hasher
- [x] Virtual Care tests — 6 passed, including a standalone consent-to-completion workflow
- [x] Frontend production build
- [x] Frontend lint (existing warnings remain in unrelated screens)
- [x] Django system check and migration-state checks
- [x] PostgreSQL-backed test run — migrations applied cleanly and 105 tests passed on PostgreSQL 18.7 (Windows, local throwaway database, since removed)
- [ ] Docker Compose execution
- [ ] Automated browser acceptance walkthrough

A partial manual walkthrough on a clean, disposable SQLite database with fictional data covered
registration, booking and check-in, triage, consultation notes, a lab order and payment, a lab
result, and an authorized prescription. The appointment list displayed 21 records across pages,
and the check-in persisted after refresh. A complete recorded walkthrough, including explicit
clinician result review, rejected actions, and role and tenant checks, remains outstanding.

Audit events were added for patient updates and additional administrative and clinical actions;
coverage has not been exhaustively reviewed. Consultation now requires vitals from the current
encounter (earlier-encounter vitals no longer satisfy the prerequisite; regression test added).

## Candidate-owned submission evidence still required

- [ ] GitHub repository URL and source-code submission
- [ ] Linux virtual-host deployment; a public URL only if safely available
- [ ] Verified PostgreSQL deployment and database connectivity evidence
- [ ] Nginx, application-service, and deployment logs/configuration from the VPS
- [ ] Screenshots or a browser test report from the deployed application
- [ ] Recorded 5–10 minute demonstration video
- [ ] Final walkthrough using synthetic data, including authentication and role checks

No public deployment, repository URL, or long-form video is represented as complete by this
checklist. Use synthetic data only; the system is not certified for live clinical care.

## F01–F12 status

| Module | Status |
| --- | --- |
| F01 Patient registration and chart | Partial: implemented; complete journey evidence pending |
| F02 Appointments | Partial: implemented; complete journey evidence pending |
| F03 Triage and vitals | Partial: implemented; complete journey evidence pending |
| F04 Encounter notes | Partial: implemented; complete journey evidence pending |
| F05 Diagnosis and care plans | Partial: implemented; complete journey evidence pending |
| F06 Laboratory | Partial: order, result, correction and review implemented; complete journey evidence pending |
| F07 Prescriptions | Partial: implemented; complete journey evidence pending |
| F08 Referrals | Partial: implemented; complete journey evidence pending |
| F09 Wards and beds | Partial: implemented; complete journey evidence pending |
| F10 Billing and fictional claims | Partial: implemented; complete journey evidence pending |
| F11 Follow-up reminders | Partial: implemented; complete journey evidence pending |
| F12 Clinical audit | Partial: audit history exists; comprehensive action coverage not verified |
