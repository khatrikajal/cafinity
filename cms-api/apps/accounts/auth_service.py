"""
apps/accounts/auth_service.py

THE PHASE 2 SWAP POINT.

This module is the only place that knows HOW to authenticate an employee.
In Phase 1: checks against the local User + Employee stub.
In Phase 2: replace the body of `authenticate_employee` with an HRMS
            API call or shared-DB lookup. Nothing else changes.

The function contract must stay identical:
    Input  : username (str), password (str)
    Output : EmployeeAuthPayload | None
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional
from django.contrib.auth import authenticate, get_user_model
from django.db import DatabaseError
from apps.accounts.models import Employee, RoleChoices

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmployeeAuthPayload:
    """
    Normalised employee identity returned after successful authentication.
    Consumed by the JWT builder in apps/accounts/views.py.
    All IDs are strings so the JWT serialiser never has to call str() itself.
    """
    user_id:     str
    username:    str
    full_name:   str
    role_type:   str
    email:       str
    company_id:  Optional[str]
    employee_id: Optional[str]
    canteen_id:  Optional[str]
    canteen_name: str
    is_active:   bool


User = get_user_model()


def _find_user_by_login_id(login_id: str):
    normalized = (login_id or "").strip()
    if not normalized:
        return None

    user = User.objects.filter(username__iexact=normalized).first()
    if user is not None:
        return user

    user = User.objects.filter(email__iexact=normalized).first()
    if user is not None:
        return user

    emp = (
        Employee.objects
        .select_related("user")
        .filter(employee_code__iexact=normalized)
        .first()
    )
    if emp and emp.user:
        return emp.user

    return None


def _payload_from_user(user) -> EmployeeAuthPayload:
    company_id = None
    employee_id = None
    canteen_id = None
    canteen_name = ""
    role_type = getattr(user, "role_type", RoleChoices.EMPLOYEE)

    if getattr(user, "is_superuser", False):
        role_type = RoleChoices.SUPER_ADMIN

    emp = (
        Employee.objects
        .select_related("canteen")
        .filter(user_id=user.pk)
        .first()
    )
    if emp:
        company_id = str(emp.company_id) if emp.company_id else None
        employee_id = str(emp.id)
        canteen_id = str(emp.canteen_id) if emp.canteen_id else None
        if emp.canteen_id and emp.canteen:
            canteen_name = emp.canteen.name or ""

    return EmployeeAuthPayload(
        user_id=str(user.pk),
        username=user.username,
        full_name=user.get_full_name() or user.username,
        role_type=role_type,
        email=user.email or '',
        company_id=company_id,
        employee_id=employee_id,
        canteen_id=canteen_id,
        canteen_name=canteen_name,
        is_active=user.is_active,
    )


def resolve_employee_identity(login_id: str) -> Optional[EmployeeAuthPayload]:
    """Resolve user identity for OTP login without validating password."""
    try:
        user = _find_user_by_login_id(login_id)

        if user is None:
            return None

        return _payload_from_user(user)
    except DatabaseError:
        raise
    except Exception:
        logger.exception("Unexpected error in resolve_employee_identity for login_id=%s", login_id)
        return None

def authenticate_employee(login_id: str, password: str) -> Optional[EmployeeAuthPayload]:
    normalized_login_id = (login_id or "").strip()
    try:
        matched_user = _find_user_by_login_id(normalized_login_id)

        user = None
        if matched_user is not None:
            user = authenticate(username=matched_user.username, password=password)
        else:
            user = authenticate(username=normalized_login_id, password=password)

        if user is None:
            if matched_user is not None:
                logger.warning(
                    "LOGIN_PASSWORD_MISMATCH login_id=%s username=%s",
                    normalized_login_id,
                    matched_user.username,
                )
            else:
                logger.warning("LOGIN_USER_NOT_FOUND login_id=%s", normalized_login_id)
            return None

        if not user.is_active:
            logger.warning("LOGIN_INACTIVE_USER login_id=%s user_id=%s", normalized_login_id, user.pk)
            return None

        emp = Employee.objects.filter(user_id=user.pk).first()
        if emp and not emp.is_active:
            logger.warning("LOGIN_INACTIVE_EMPLOYEE login_id=%s user_id=%s", normalized_login_id, user.pk)
            return None

        return _payload_from_user(user)

    except DatabaseError:
        raise
    except Exception:
        logger.exception(
            "Unexpected error in authenticate_employee for login_id=%s",
            normalized_login_id,
        )
        return None
