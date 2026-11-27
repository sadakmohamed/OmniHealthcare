from django.http import JsonResponse
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from virtualcare_service.core.views import (
    VirtualCareAccountDetailView,
    VirtualCareBootstrapView,
    VirtualCareDirectoryView,
    VirtualCareLoginView,
    VirtualCareProfileView,
    VirtualCareRegistrationView,
    VirtualCareStatusView,
    VirtualVisitViewSet,
)

router = DefaultRouter()
router.register("sessions", VirtualVisitViewSet, basename="virtual-session")


def health(request):
    return JsonResponse({"status": "ok", "service": "virtual-care"})


urlpatterns = [
    path("health/", health),
    path("api/v1/auth/login/", VirtualCareLoginView.as_view(), name="virtualcare-login"),
    path("api/v1/auth/register/", VirtualCareRegistrationView.as_view(), name="virtualcare-register"),
    path("api/v1/auth/bootstrap/", VirtualCareBootstrapView.as_view(), name="virtualcare-bootstrap"),
    path("api/v1/auth/status/", VirtualCareStatusView.as_view(), name="virtualcare-status"),
    path("api/v1/auth/me/", VirtualCareProfileView.as_view(), name="virtualcare-profile"),
    path("api/v1/directory/", VirtualCareDirectoryView.as_view(), name="virtualcare-directory"),
    path("api/v1/directory/<uuid:pk>/", VirtualCareAccountDetailView.as_view(), name="virtualcare-account"),
    path("api/v1/", include(router.urls)),
]
