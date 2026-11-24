from rest_framework.permissions import BasePermission


class RolePermission(BasePermission):
    allowed_roles = ()

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.role == "admin":
            return True
        if getattr(view, "public_read", False) and request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return request.user.role in self.allowed_roles
