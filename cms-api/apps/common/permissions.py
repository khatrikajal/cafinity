"""
apps/common/permissions.py

DRF permission classes for Cafinity.

All classes read the 'role_type' claim from the JWT payload.
Both Employee tokens and Device tokens use 'role_type' as the claim name
so one set of permission classes works for the entire system.

Usage on a ViewSet:
    from apps.common.permissions import IsEmployee, IsKitchenUser, IsCounterUser, IsCMSAdmin

    class OrderViewSet(viewsets.ModelViewSet):
        permission_classes = [IsAuthenticated, IsEmployee]

For endpoints accessible by multiple roles use CombinedPermission:
    permission_classes = [IsAuthenticated, IsKitchenOrCounter]
"""

from rest_framework.permissions import BasePermission

from apps.accounts.models import RoleChoices
from apps.common.auth_utils import get_effective_role

# ──────────────────────────────────────────────────────────────────────────────
# Internal helper
# ──────────────────────────────────────────────────────────────────────────────

def _get_role(request) -> str:
    """
    Resolve role_type from the authenticated user (DB-backed) when available.
    Falls back to the JWT claim for device principals without a User row.
    """
    return get_effective_role(request)


# ──────────────────────────────────────────────────────────────────────────────
# Single-role permission classes
# ──────────────────────────────────────────────────────────────────────────────

class IsEmployee(BasePermission):
    """Grants access to users with role_type = EMPLOYEE."""
    message = 'Employee access required.'

    def has_permission(self, request, view):
        return _get_role(request) == RoleChoices.EMPLOYEE


class IsKitchenUser(BasePermission):
    """Grants access to Kitchen device accounts only."""
    message = 'Kitchen device access required.'

    def has_permission(self, request, view):
        return _get_role(request) == 'KITCHEN'


class IsCounterUser(BasePermission):
    """Grants access to Counter device accounts only."""
    message = 'Counter device access required.'

    def has_permission(self, request, view):
        return _get_role(request) == 'COUNTER'


class IsCMSAdmin(BasePermission):
    """
    Grants access to any admin role that can manage CMS.
    SUPER_ADMIN, COMPANY_ADMIN, CANTEEN_ADMIN.
    """
    message = 'CMS Admin access required.'

    def has_permission(self, request, view):
        return _get_role(request) in RoleChoices.CMS_ADMIN_ROLES


class IsLimitedAdmin(BasePermission):
    """
    Grants access to LIMITED_ADMIN role only.
    """
    message = 'Limited Admin access required.'

    def has_permission(self, request, view):
        return _get_role(request) == RoleChoices.LIMITED_ADMIN


class IsAnyAdmin(BasePermission):
    """Grants access to ALL admin roles including HR and Payroll."""
    message = 'Admin access required.'

    def has_permission(self, request, view):
        return _get_role(request) in RoleChoices.ALL_ADMIN_ROLES


# ──────────────────────────────────────────────────────────────────────────────
# Combined permission classes — for endpoints shared across roles
# ──────────────────────────────────────────────────────────────────────────────

class IsKitchenOrCounter(BasePermission):
    """
    Grants access to both Kitchen and Counter device accounts.
    Used by the Guest Meal logging endpoint accessible from both portals.
    """
    message = 'Kitchen or Counter device access required.'

    def has_permission(self, request, view):
        return _get_role(request) in ('KITCHEN', 'COUNTER')


class IsEmployeeOrAdmin(BasePermission):
    """
    Grants access to Employees and any Admin role.
    Used by shared read endpoints (e.g. menu browsing for admin preview).
    """
    message = 'Employee or Admin access required.'

    def has_permission(self, request, view):
        role = _get_role(request)
        return role == RoleChoices.EMPLOYEE or role in RoleChoices.ALL_ADMIN_ROLES


class IsEmployeeOrFullAdmin(BasePermission):
    """
    Grants access to Employees and full Admin roles (excluding LIMITED_ADMIN).
    Used by admin sections that LIMITED_ADMIN should not access.
    """
    message = 'Employee or Full Admin access required.'

    def has_permission(self, request, view):
        role = _get_role(request)
        full_admin_roles = RoleChoices.ALL_ADMIN_ROLES - {RoleChoices.LIMITED_ADMIN}
        return role == RoleChoices.EMPLOYEE or role in full_admin_roles


class IsLimitedAdminOrHigher(BasePermission):
    """
    Grants access to LIMITED_ADMIN and higher admin roles.
    Used by sections that LIMITED_ADMIN can access.
    """
    message = 'Limited Admin or higher access required.'

    def has_permission(self, request, view):
        role = _get_role(request)
        return role in RoleChoices.ALL_ADMIN_ROLES  # LIMITED_ADMIN is included


class IsKitchenOrAdmin(BasePermission):
    """
    Grants access to Kitchen device accounts and CMS Admins.
    Used by Admin's ability to view the kitchen order board.
    """
    message = 'Kitchen or Admin access required.'

    def has_permission(self, request, view):
        role = _get_role(request)
        return role == 'KITCHEN' or role in RoleChoices.CMS_ADMIN_ROLES


class IsDashboardViewer(BasePermission):
    """
    Grants access to dashboard widgets for Super Admin, Limited Admin, and Kitchen.
    Employee role is explicitly denied (403).
    """
    message = 'Dashboard access required.'

    def has_permission(self, request, view):
        role = _get_role(request)
        if role == RoleChoices.EMPLOYEE:
            return False
        if role == 'KITCHEN':
            return True
        if role in RoleChoices.ALL_ADMIN_ROLES:
            return True
        return False


class IsLimitedAdminOrSuperAdmin(BasePermission):
    """Super Admin or Limited Admin only — for manual summary email triggers."""
    message = 'Limited Admin or Super Admin access required.'

    def has_permission(self, request, view):
        role = _get_role(request)
        return role in {RoleChoices.SUPER_ADMIN, RoleChoices.LIMITED_ADMIN}


class IsMenuWriteAdmin(BasePermission):
    """
    CMS admins plus Limited Admin — for menu/slot/master creation endpoints.
    """
    message = 'Admin access required for this action.'

    def has_permission(self, request, view):
        role = _get_role(request)
        return role in RoleChoices.CMS_ADMIN_ROLES or role == RoleChoices.LIMITED_ADMIN or role == RoleChoices.SUPER_ADMIN