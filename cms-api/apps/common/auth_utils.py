"""
Shared helpers for resolving a caller's effective role from the database.

JWT role claims are validated at authentication time; permission checks and
identity endpoints prefer the DB-backed role as defense in depth.
"""

from apps.accounts.models import RoleChoices


def db_role_for_user(user) -> str:
    """Return the authoritative role for a Django User or device principal."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return ''

    if getattr(user, 'token_payload', None) is not None:
        return getattr(user, 'role', '') or ''

    if getattr(user, 'is_superuser', False):
        return RoleChoices.SUPER_ADMIN

    return getattr(user, 'role_type', '') or ''


def get_effective_role(request) -> str:
    """
    Resolve role for permission checks.

    Prefer the authenticated user's DB role; fall back to the JWT claim only
    when no user object is available (should not happen after auth).
    """
    user = getattr(request, 'user', None)
    db_role = db_role_for_user(user)
    if db_role:
        return db_role

    token = getattr(request, 'auth', None)
    if token is None:
        return ''

    try:
        return token.get('role_type', '') or ''
    except Exception:
        return ''
