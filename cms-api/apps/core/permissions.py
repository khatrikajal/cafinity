# Cafinity Security Fix — VAPT June 2026 — VAPT access control permissions
from rest_framework.permissions import BasePermission

from apps.accounts.models import RoleChoices
from apps.common.auth_utils import get_effective_role

_BLOCKED_ROLES = {'KITCHEN', 'COUNTER', RoleChoices.EMPLOYEE}
_GUEST_ORDER_ADMIN_ROLES = {
    RoleChoices.SUPER_ADMIN,
    RoleChoices.LIMITED_ADMIN,
} | RoleChoices.CMS_ADMIN_ROLES


class IsAdminOrLimitedAdmin(BasePermission):
    """SUPER_ADMIN, LIMITED_ADMIN, and CMS admins — blocks kitchen/device/employee roles."""

    message = 'Admin access required.'

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        if role in _BLOCKED_ROLES:
            return False
        return role in _GUEST_ORDER_ADMIN_ROLES


class IsCounterOrAdmin(BasePermission):
    """Counter device or CMS/Limited admin roles — blocks kitchen/employee."""

    message = 'Counter or admin access required.'

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        if role in {'KITCHEN', RoleChoices.EMPLOYEE}:
            return False
        return (
            role == 'COUNTER'
            or role in _GUEST_ORDER_ADMIN_ROLES
            or role in RoleChoices.CMS_ADMIN_ROLES
        )


class IsAdminLimitedAdminOrEmployee(BasePermission):
    """SUPER_ADMIN, LIMITED_ADMIN, CMS admins, or EMPLOYEE — blocks KITCHEN/COUNTER."""

    message = 'Access denied.'

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        if role in {'KITCHEN', 'COUNTER'}:
            return False
        return role in {
            RoleChoices.SUPER_ADMIN,
            RoleChoices.LIMITED_ADMIN,
            RoleChoices.EMPLOYEE,
        } | RoleChoices.CMS_ADMIN_ROLES
