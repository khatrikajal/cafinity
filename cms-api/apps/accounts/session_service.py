# Cafinity Fix — Session Management — June 2026
"""JWT session lifecycle: create, track, invalidate."""

from __future__ import annotations

import logging

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

logger = logging.getLogger(__name__)

MAX_ACTIVE_SESSIONS = 2
SESSION_CACHE_TTL = 86400  # 24 hours
INACTIVITY_TIMEOUT_SECONDS = 900  # 15 minutes


def get_client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or ""


def _session_index_key(user_id: str) -> str:
    return f"session_index:{user_id}"


def _session_key(user_id: str, token_suffix: str) -> str:
    return f"session:{user_id}:{token_suffix}"


def _login_attempts_key(username: str) -> str:
    return f"login_attempts:{username}"


def create_session(user, request, payload) -> dict:
    """Issue JWT pair, record session metadata, enforce concurrent session limit."""
    refresh = RefreshToken.for_user(user)
    refresh["username"] = payload.username
    refresh["role_type"] = payload.role_type
    refresh["role"] = payload.role_type
    refresh["company_id"] = payload.company_id
    refresh["employee_id"] = payload.employee_id
    refresh["canteen_id"] = payload.canteen_id
    refresh["canteen_name"] = payload.canteen_name
    refresh["email"] = payload.email

    access = refresh.access_token
    access["username"] = payload.username
    access["role_type"] = payload.role_type
    access["company_id"] = payload.company_id
    access["employee_id"] = payload.employee_id
    access["canteen_id"] = payload.canteen_id
    access["canteen_name"] = payload.canteen_name

    token_suffix = str(refresh.access_token)[-8:]
    session_key = _session_key(str(user.id), token_suffix)
    now_iso = timezone.now().isoformat()
    cache.set(
        session_key,
        {
            "user_id": str(user.id),
            "ip": get_client_ip(request),
            "user_agent": request.META.get("HTTP_USER_AGENT", ""),
            "created_at": now_iso,
            "last_active": now_iso,
        },
        timeout=SESSION_CACHE_TTL,
    )

    index_key = _session_index_key(str(user.id))
    session_ids = list(cache.get(index_key) or [])
    session_ids.append(token_suffix)
    while len(session_ids) > MAX_ACTIVE_SESSIONS:
        oldest = session_ids.pop(0)
        cache.delete(_session_key(str(user.id), oldest))
    cache.set(index_key, session_ids, timeout=SESSION_CACHE_TTL)

    access_lifetime = getattr(
        settings,
        "SIMPLE_JWT",
        {},
    ).get("ACCESS_TOKEN_LIFETIME")
    expires_in = int(access_lifetime.total_seconds()) if access_lifetime else 1800

    return {
        "access": str(access),
        "refresh": str(refresh),
        "expires_in": expires_in,
    }


def touch_session(user_id: str, token_suffix: str) -> None:
    session_key = _session_key(str(user_id), token_suffix)
    record = cache.get(session_key)
    if not isinstance(record, dict):
        return
    record["last_active"] = timezone.now().isoformat()
    cache.set(session_key, record, timeout=SESSION_CACHE_TTL)


def check_session_inactivity(user_id: str, token_suffix: str) -> bool:
    """Return True if session is inactive beyond the allowed window."""
    session_key = _session_key(str(user_id), token_suffix)
    record = cache.get(session_key)
    if not isinstance(record, dict):
        return False

    last_active_raw = record.get("last_active")
    if not last_active_raw:
        return False

    try:
        last_active = timezone.datetime.fromisoformat(last_active_raw)
        if timezone.is_naive(last_active):
            last_active = timezone.make_aware(last_active, timezone.get_current_timezone())
    except (TypeError, ValueError):
        return False

    return (timezone.now() - last_active).total_seconds() > INACTIVITY_TIMEOUT_SECONDS


def clear_session_cache(user, refresh_token: str | None = None) -> None:
    user_id = str(user.id)
    cache.delete(_login_attempts_key(getattr(user, "username", "")))

    if refresh_token:
        try:
            token = RefreshToken(refresh_token)
            token_suffix = str(token.access_token)[-8:]
            cache.delete(_session_key(user_id, token_suffix))
            index_key = _session_index_key(user_id)
            session_ids = list(cache.get(index_key) or [])
            if token_suffix in session_ids:
                session_ids.remove(token_suffix)
                cache.set(index_key, session_ids, timeout=SESSION_CACHE_TTL)
        except Exception:
            logger.debug("Unable to clear session cache for refresh token", exc_info=True)


def invalidate_all_sessions(user) -> None:
    """Blacklist all outstanding refresh tokens and clear session cache."""
    user_id = str(user.id)
    cache.delete(_session_index_key(user_id))

    try:
        from rest_framework_simplejwt.token_blacklist.models import (
            BlacklistedToken,
            OutstandingToken,
        )

        tokens = OutstandingToken.objects.filter(user=user)
        for token in tokens:
            BlacklistedToken.objects.get_or_create(token=token)
    except Exception:
        logger.warning(
            "Token blacklist unavailable — run migrate for token_blacklist app",
            exc_info=True,
        )

    cache.delete(_login_attempts_key(getattr(user, "username", "")))


def invalidate_user_tokens(user) -> None:
    """Alias used by employee deactivation."""
    invalidate_all_sessions(user)
