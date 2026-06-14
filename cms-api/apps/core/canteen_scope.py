# Cafinity Security Fix Round 2 — VAPT June 2026 — Canteen IDOR protection
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import RoleChoices
from apps.common.auth_utils import get_effective_role


def _request_canteen_id(request):
    auth = getattr(request, 'auth', None)
    if auth is not None:
        try:
            token_canteen = auth.get('canteen_id')
            if token_canteen:
                return str(token_canteen)
        except Exception:
            pass

    employee = getattr(getattr(request, 'user', None), 'employee_profile', None)
    if employee is not None and getattr(employee, 'canteen_id', None):
        return str(employee.canteen_id)

    return None


def validate_canteen_access(request, canteen_id):
    """Validate that the caller may access the given canteen."""
    if canteen_id in (None, ''):
        return True

    role = get_effective_role(request)
    if role == RoleChoices.SUPER_ADMIN:
        return True

    user_canteen = _request_canteen_id(request)
    if not user_canteen or str(canteen_id) != user_canteen:
        raise PermissionDenied('You do not have access to this canteen.')
    return True


def scope_queryset_by_canteen(request, queryset, canteen_field='canteen_id'):
    """Filter a queryset to canteens the caller is allowed to see."""
    role = get_effective_role(request)

    if role == RoleChoices.SUPER_ADMIN:
        return queryset

    user_canteen = _request_canteen_id(request)
    if role in {
        RoleChoices.LIMITED_ADMIN,
        'KITCHEN',
        'COUNTER',
        RoleChoices.EMPLOYEE,
        RoleChoices.CANTEEN_ADMIN,
        RoleChoices.COMPANY_ADMIN,
    }:
        if not user_canteen:
            return queryset.none()
        return queryset.filter(**{canteen_field: user_canteen})

    if role in RoleChoices.ALL_ADMIN_ROLES and user_canteen:
        return queryset.filter(**{canteen_field: user_canteen})

    return queryset.none()
