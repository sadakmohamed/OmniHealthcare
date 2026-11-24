"""
URL configuration for OmniHealthcare backend.

API prefix: /api/v1/
"""

from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from core import views

router = DefaultRouter()

# ── Existing routes ───────────────────────────────────────────────────────────
router.register("patients", views.PatientViewSet)
router.register("clinicians", views.ClinicianViewSet)
router.register("appointments", views.AppointmentViewSet)
router.register("encounters", views.EncounterViewSet)
router.register("vitals", views.VitalViewSet)
router.register("notes", views.ClinicalNoteViewSet)
router.register("diagnoses", views.DiagnosisViewSet)
router.register("care-plans", views.CarePlanViewSet)
router.register("lab-orders", views.LabOrderViewSet)
router.register("lab-results", views.LabResultViewSet)
router.register("prescriptions", views.PrescriptionViewSet)
router.register("referrals", views.ReferralViewSet)
router.register("wards", views.WardViewSet)
router.register("beds", views.BedViewSet)
router.register("bills", views.BillViewSet)
router.register("payments", views.PaymentViewSet)
router.register("follow-ups", views.FollowUpViewSet)
router.register("audit", views.AuditEventViewSet)
router.register("consents", views.ConsentViewSet)
router.register("virtual-sessions", views.VirtualSessionViewSet)

# ── New Phase-2 routes ────────────────────────────────────────────────────────
router.register("allergies", views.AllergyViewSet)
router.register("discharge-notes", views.DischargeNoteViewSet)
router.register("proxy-grants", views.ProxyGrantViewSet)
router.register("medical-history", views.MedicalHistoryViewSet)

urlpatterns = [
    # Django admin
    path("admin/", admin.site.urls),

    # Auth
    path("api/v1/auth/login/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/v1/auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    # Standalone endpoints
    path("api/v1/me/", views.MeView.as_view(), name="me"),
    path("api/v1/health/", views.HealthView.as_view(), name="health"),
    path("api/v1/analytics/", views.AnalyticsView.as_view(), name="analytics"),
    path("api/v1/register/", views.PatientRegisterView.as_view(), name="register"),

    # OpenAPI / Swagger
    path("api/v1/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/v1/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),

    # Router-generated routes (all under /api/v1/)
    path("api/v1/", include(router.urls)),
]
