# Cafinity Security Fix — VAPT June 2026 — Progressive login rate limiting
import time

from django.core.cache import cache


def check_login_attempts(login_id: str, ip: str):
    login_id = login_id.lower()
    key_user = f'login_attempts:{login_id}'
    user_attempts = int(cache.get(key_user, 0) or 0)

    lockout_until = cache.get(f'lockout_until:{login_id}')
    if lockout_until and time.time() < lockout_until:
        remaining = int(lockout_until - time.time())
        return True, remaining
    return False, max(0, 10 - user_attempts)


def record_failed_attempt(login_id: str, ip: str):
    login_id = login_id.lower()
    key_user = f'login_attempts:{login_id}'
    key_ip = f'login_attempts_ip:{ip or "unknown"}'

    attempts = int(cache.get(key_user, 0) or 0) + 1
    cache.set(key_user, attempts, timeout=3600)
    cache.set(key_ip, int(cache.get(key_ip, 0) or 0) + 1, timeout=3600)

    if attempts == 5:
        cache.set(f'lockout_until:{login_id}', time.time() + 300, timeout=300)
    elif attempts >= 10:
        cache.set(f'lockout_until:{login_id}', time.time() + 1800, timeout=1800)

    return attempts, max(0, 10 - attempts)


def clear_login_attempts(login_id: str):
    login_id = login_id.lower()
    cache.delete(f'login_attempts:{login_id}')
    cache.delete(f'lockout_until:{login_id}')
