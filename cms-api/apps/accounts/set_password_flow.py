# Cafinity Fix — First Login / Password Reset Flow — June 2026
"""Temporary-token first-login password set flow with OTP verification."""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

TEMP_TOKEN_TTL_SECONDS = 900  # 15 minutes
SET_PWD_OTP_TTL_SECONDS = 600  # 10 minutes
SET_PWD_OTP_MAX_ATTEMPTS = 5


def must_change_pwd_cache_key(temp_token: str) -> str:
    return f"must_change_pwd:{temp_token}"


def set_pwd_otp_cache_key(user_id: str) -> str:
    return f"set_pwd_otp:{user_id}"


def set_pwd_otp_attempts_key(user_id: str) -> str:
    return f"set_pwd_otp_attempts:{user_id}"


def set_pwd_pending_key(user_id: str) -> str:
    return f"set_pwd_pending:{user_id}"


def issue_must_change_temp_token(user_id: str) -> str:
    temp_token = secrets.token_urlsafe(32)
    cache.set(
        must_change_pwd_cache_key(temp_token),
        str(user_id),
        timeout=TEMP_TOKEN_TTL_SECONDS,
    )
    return temp_token


def resolve_temp_token(temp_token: str) -> str | None:
    if not temp_token:
        return None
    user_id = cache.get(must_change_pwd_cache_key(temp_token))
    return str(user_id) if user_id else None


def invalidate_temp_token(temp_token: str) -> None:
    if temp_token:
        cache.delete(must_change_pwd_cache_key(temp_token))


def store_pending_password(user_id: str, new_password: str) -> None:
    cache.set(set_pwd_pending_key(user_id), new_password, timeout=SET_PWD_OTP_TTL_SECONDS)


def get_pending_password(user_id: str) -> str | None:
    return cache.get(set_pwd_pending_key(user_id))


def clear_pending_password(user_id: str) -> None:
    cache.delete(set_pwd_pending_key(user_id))


def generate_set_password_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def store_set_password_otp(user_id: str, otp_code: str) -> None:
    cache.set(set_pwd_otp_cache_key(user_id), otp_code, timeout=SET_PWD_OTP_TTL_SECONDS)
    cache.set(set_pwd_otp_attempts_key(user_id), 0, timeout=SET_PWD_OTP_TTL_SECONDS)


def get_set_password_otp(user_id: str) -> str | None:
    return cache.get(set_pwd_otp_cache_key(user_id))


def clear_set_password_otp(user_id: str) -> None:
    cache.delete(set_pwd_otp_cache_key(user_id))
    cache.delete(set_pwd_otp_attempts_key(user_id))


def increment_set_password_otp_attempts(user_id: str) -> int:
    key = set_pwd_otp_attempts_key(user_id)
    attempts = int(cache.get(key) or 0) + 1
    cache.set(key, attempts, timeout=SET_PWD_OTP_TTL_SECONDS)
    return attempts


def extract_temp_token(request) -> str:
    auth_header = request.headers.get("Authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return (
        request.data.get("temp_token", "").strip()
        or request.data.get("token", "").strip()
    )


def invalidate_set_password_flow(user_id: str, temp_token: str | None = None) -> None:
    clear_set_password_otp(user_id)
    clear_pending_password(user_id)
    if temp_token:
        invalidate_temp_token(temp_token)
