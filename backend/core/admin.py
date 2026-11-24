"""
Django admin registration for all OmniHealthcare models.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
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
    User,
    VirtualSession,
    Vital,
    Ward,
)


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "created_at")
    search_fields = ("name", "code")


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "role", "organization", "is_active", "date_joined")
    list_filter = ("role", "organization", "is_active")
    search_fields = ("username", "first_name", "last_name", "email")
    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "OmniHealthcare",
            {"fields": ("role", "organization", "patient_id")},
        ),
    )


# ---------------------------------------------------------------------------
# Patient
# ---------------------------------------------------------------------------


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = (
        "medical_record_number", "first_name", "last_name",
        "date_of_birth", "sex", "organization", "created_at",
    )
    list_filter = ("organization", "sex")
    search_fields = ("first_name", "last_name", "medical_record_number", "email")
    ordering = ("-created_at",)


# ---------------------------------------------------------------------------
# Clinician
# ---------------------------------------------------------------------------


@admin.register(Clinician)
class ClinicianAdmin(admin.ModelAdmin):
    list_display = ("user", "specialty", "organization")
    list_filter = ("organization", "specialty")
    search_fields = ("user__username", "user__first_name", "user__last_name", "specialty")


# ---------------------------------------------------------------------------
# Appointment
# ---------------------------------------------------------------------------


@admin.register(Appointment)
class AppointmentAdmin(admin.ModelAdmin):
    list_display = ("patient", "clinician", "starts_at", "status", "organization")
    list_filter = ("status", "organization", "clinician")
    search_fields = ("patient__first_name", "patient__last_name", "reason")
    ordering = ("starts_at",)
    date_hierarchy = "starts_at"


# ---------------------------------------------------------------------------
# Encounter
# ---------------------------------------------------------------------------


@admin.register(Encounter)
class EncounterAdmin(admin.ModelAdmin):
    list_display = ("id", "patient", "clinician", "status", "organization", "created_at")
    list_filter = ("status", "organization")
    search_fields = ("patient__first_name", "patient__last_name")
    ordering = ("-created_at",)


# ---------------------------------------------------------------------------
# Vital
# ---------------------------------------------------------------------------


@admin.register(Vital)
class VitalAdmin(admin.ModelAdmin):
    list_display = (
        "patient", "encounter", "temperature_c", "systolic", "diastolic",
        "heart_rate", "oxygen_saturation", "created_at",
    )
    list_filter = ("organization",)
    search_fields = ("patient__first_name", "patient__last_name")


# ---------------------------------------------------------------------------
# ClinicalNote
# ---------------------------------------------------------------------------


@admin.register(ClinicalNote)
class ClinicalNoteAdmin(admin.ModelAdmin):
    list_display = ("patient", "encounter", "note_type", "author", "approved", "created_at")
    list_filter = ("organization", "note_type", "approved")
    search_fields = ("patient__first_name", "content")


# ---------------------------------------------------------------------------
# Diagnosis
# ---------------------------------------------------------------------------


@admin.register(Diagnosis)
class DiagnosisAdmin(admin.ModelAdmin):
    list_display = ("patient", "code", "description", "encounter", "created_at")
    list_filter = ("organization",)
    search_fields = ("code", "description", "patient__first_name")


# ---------------------------------------------------------------------------
# CarePlan
# ---------------------------------------------------------------------------


@admin.register(CarePlan)
class CarePlanAdmin(admin.ModelAdmin):
    list_display = ("patient", "encounter", "approved_by", "created_at")
    list_filter = ("organization",)
    search_fields = ("patient__first_name", "description")


# ---------------------------------------------------------------------------
# LabOrder
# ---------------------------------------------------------------------------


@admin.register(LabOrder)
class LabOrderAdmin(admin.ModelAdmin):
    list_display = ("patient", "test_name", "status", "ordered_by", "created_at")
    list_filter = ("status", "organization")
    search_fields = ("patient__first_name", "test_name")


# ---------------------------------------------------------------------------
# LabResult
# ---------------------------------------------------------------------------


@admin.register(LabResult)
class LabResultAdmin(admin.ModelAdmin):
    list_display = ("patient", "order", "status", "entered_by", "created_at")
    list_filter = ("status", "organization")
    search_fields = ("patient__first_name", "result")


# ---------------------------------------------------------------------------
# Prescription
# ---------------------------------------------------------------------------


@admin.register(Prescription)
class PrescriptionAdmin(admin.ModelAdmin):
    list_display = ("patient", "medication", "dosage", "status", "authorized_by", "dispensed_at")
    list_filter = ("status", "organization")
    search_fields = ("patient__first_name", "medication")


# ---------------------------------------------------------------------------
# Referral
# ---------------------------------------------------------------------------


@admin.register(Referral)
class ReferralAdmin(admin.ModelAdmin):
    list_display = ("patient", "specialty", "destination", "status", "organization", "created_at")
    list_filter = ("status", "organization")
    search_fields = ("patient__first_name", "specialty", "destination")


# ---------------------------------------------------------------------------
# Ward & Bed
# ---------------------------------------------------------------------------


@admin.register(Ward)
class WardAdmin(admin.ModelAdmin):
    list_display = ("name", "location", "organization")
    list_filter = ("organization",)
    search_fields = ("name",)


@admin.register(Bed)
class BedAdmin(admin.ModelAdmin):
    list_display = ("label", "ward", "status", "patient", "organization")
    list_filter = ("status", "organization", "ward")
    search_fields = ("label", "patient__first_name")


# ---------------------------------------------------------------------------
# Bill & Payment
# ---------------------------------------------------------------------------


@admin.register(Bill)
class BillAdmin(admin.ModelAdmin):
    list_display = ("invoice_number", "patient", "total_cents", "status", "organization", "created_at")
    list_filter = ("status", "organization")
    search_fields = ("invoice_number", "patient__first_name")
    ordering = ("-created_at",)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("bill", "amount_cents", "method", "reference", "recorded_by", "created_at")
    list_filter = ("method", "organization")
    search_fields = ("reference", "bill__invoice_number")


# ---------------------------------------------------------------------------
# FollowUp
# ---------------------------------------------------------------------------


@admin.register(FollowUp)
class FollowUpAdmin(admin.ModelAdmin):
    list_display = ("patient", "due_at", "completed", "organization")
    list_filter = ("completed", "organization")
    search_fields = ("patient__first_name", "message")
    ordering = ("due_at",)


# ---------------------------------------------------------------------------
# AuditEvent
# ---------------------------------------------------------------------------


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("action", "resource_type", "resource_id", "actor", "organization", "created_at")
    list_filter = ("action", "resource_type", "organization")
    search_fields = ("action", "resource_id", "actor__username")
    ordering = ("-created_at",)
    # Audit events are immutable
    def has_add_permission(self, request):
        return False
    def has_change_permission(self, request, obj=None):
        return False


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------


@admin.register(Consent)
class ConsentAdmin(admin.ModelAdmin):
    list_display = ("patient", "scope", "granted", "expires_at", "organization")
    list_filter = ("granted", "organization")
    search_fields = ("patient__first_name", "scope")


# ---------------------------------------------------------------------------
# VirtualSession
# ---------------------------------------------------------------------------


@admin.register(VirtualSession)
class VirtualSessionAdmin(admin.ModelAdmin):
    list_display = ("patient", "clinician", "status", "scheduled_at", "organization")
    list_filter = ("status", "organization")
    search_fields = ("patient__first_name", "clinician__user__username")
    ordering = ("-scheduled_at",)


# ---------------------------------------------------------------------------
# Phase-2 models
# ---------------------------------------------------------------------------


@admin.register(Allergy)
class AllergyAdmin(admin.ModelAdmin):
    list_display = ("patient", "substance", "severity", "organization", "created_at")
    list_filter = ("severity", "organization")
    search_fields = ("patient__first_name", "substance", "reaction")


@admin.register(DischargeNote)
class DischargeNoteAdmin(admin.ModelAdmin):
    list_display = ("patient", "encounter", "author", "organization", "created_at")
    list_filter = ("organization",)
    search_fields = ("patient__first_name", "content")


@admin.register(ProxyGrant)
class ProxyGrantAdmin(admin.ModelAdmin):
    list_display = ("patient", "grantee", "scope", "active", "organization", "created_at")
    list_filter = ("active", "organization")
    search_fields = ("patient__first_name", "grantee__username")


@admin.register(MedicalHistory)
class MedicalHistoryAdmin(admin.ModelAdmin):
    list_display = ("patient", "condition", "organization", "created_at")
    list_filter = ("organization",)
    search_fields = ("patient__first_name", "condition")
