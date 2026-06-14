# Cafinity rebrand — logo + favicon update
# Cafinity Security Fix — VAPT June 2026 — Auth endpoints hardening
"""
apps/accounts/views.py

Employee / Admin authentication endpoints.

Endpoints
---------
POST /api/v1/auth/login/    — username + password → JWT pair
POST /api/v1/auth/refresh/  — refresh token → new access token
POST /api/v1/auth/logout/   — stateless: instructs client to drop tokens
GET  /api/v1/auth/me/       — returns identity from current JWT

All Kitchen / Counter device auth lives in apps/cms/views/device_auth.py.
Do NOT merge them here.
"""

import logging
import re
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ObjectDoesNotExist
from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.db import DatabaseError, transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from .auth_service import authenticate_employee, resolve_employee_identity
from .models import Employee, PasswordResetToken, RoleChoices, User
from .email_service import (
    send_employee_otp_email,
    send_employee_password_reset_email,
    send_set_password_otp_email,
)
from .set_password_flow import (
    SET_PWD_OTP_MAX_ATTEMPTS,
    clear_pending_password,
    clear_set_password_otp,
    extract_temp_token,
    generate_set_password_otp,
    get_pending_password,
    get_set_password_otp,
    increment_set_password_otp_attempts,
    invalidate_set_password_flow,
    invalidate_temp_token,
    issue_must_change_temp_token,
    resolve_temp_token,
    store_pending_password,
    store_set_password_otp,
)
from .session_service import (
    clear_session_cache,
    create_session,
    invalidate_all_sessions,
    invalidate_user_tokens,
)
from apps.audit.models import AuditLog
from apps.audit.service import log_action
from apps.core.login_security import (
    check_login_attempts,
    clear_login_attempts,
    record_failed_attempt,
)
from apps.cms.views.device_auth import authenticate_device_login
from apps.notifications.utils import notify_admins

logger = logging.getLogger(__name__)


OTP_TTL_SECONDS = int(getattr(settings, 'EMPLOYEE_OTP_TTL_SECONDS', 600))
OTP_COOLDOWN_SECONDS = int(getattr(settings, 'EMPLOYEE_OTP_COOLDOWN_SECONDS', 30))
OTP_MAX_ATTEMPTS = int(getattr(settings, 'EMPLOYEE_OTP_MAX_ATTEMPTS', 5))
OTP_DEBUG_RESPONSE = bool(getattr(settings, 'EMPLOYEE_OTP_DEBUG_RESPONSE', settings.DEBUG))
OTP_REFERENCE_SALT = 'accounts.employee-otp-reference'
GENERIC_LOGIN_ERROR = {'detail': 'Invalid login credentials.'}


def _otp_cache_key(user_id: str) -> str:
    return f"auth:employee_otp:{user_id}"


def _otp_attempts_key(user_id: str) -> str:
    return f"auth:employee_otp_attempts:{user_id}"


def _invalidate_previous_otps(user_id: str):
    cache.delete(_otp_cache_key(user_id))
    cache.delete(_otp_attempts_key(user_id))


def _store_otp_payload(user_id: str, otp_code: str):
    """Cafinity — OTP Verification Flow Fix: structured OTP with expiry metadata."""
    now = timezone.now()
    expires_at = now + timedelta(seconds=OTP_TTL_SECONDS)
    payload = {
        'code': otp_code,
        'created_at': now.isoformat(),
        'expires_at': expires_at.isoformat(),
        'used': False,
        'attempts': 0,
    }
    cache.set(_otp_cache_key(user_id), payload, timeout=OTP_TTL_SECONDS)
    cache.set(_otp_attempts_key(user_id), 0, timeout=OTP_TTL_SECONDS)
    logger.info(
        'OTP_CREATED user_id=%s created_at=%s expires_at=%s ttl=%s',
        user_id,
        payload['created_at'],
        payload['expires_at'],
        OTP_TTL_SECONDS,
    )
    return payload


def _get_otp_payload(user_id: str):
    return cache.get(_otp_cache_key(user_id))


def _otp_is_expired(payload) -> bool:
    if not payload or not isinstance(payload, dict):
        return True
    expires_raw = payload.get('expires_at')
    if not expires_raw:
        return True
    try:
        expires_at = datetime.fromisoformat(expires_raw)
        if timezone.is_naive(expires_at):
            expires_at = timezone.make_aware(expires_at, timezone.get_current_timezone())
    except (TypeError, ValueError):
        return True
    return timezone.now() >= expires_at


def _otp_cooldown_key(user_id: str) -> str:
    return f"auth:employee_otp_cooldown:{user_id}"


def _login_challenge_key(user_id: str) -> str:
    return f"auth:employee_login_challenge:{user_id}"


def _employee_snapshot(employee):
    if employee is None:
        return None
    return {
        'id': str(employee.id),
        'employee_code': employee.employee_code,
        'full_name': employee.full_name,
        'email': employee.email,
        'is_active': employee.is_active,
        'department': employee.department.name if employee.department else None,
        'canteen_id': str(employee.canteen_id) if employee.canteen_id else None,
    }


def _generate_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def _issue_otp_reference(user_id: str, otp_code: str) -> str:
    nonce = secrets.token_urlsafe(16)
    otp_digest = salted_hmac(
        OTP_REFERENCE_SALT,
        f'{user_id}:{nonce}:{otp_code}',
    ).hexdigest()
    return signing.dumps(
        {
            'user_id': str(user_id),
            'nonce': nonce,
            'otp_digest': otp_digest,
            'purpose': 'employee_login',
        },
        salt=OTP_REFERENCE_SALT,
    )


def _load_otp_reference(otp_reference: str, user_id: str):
    if not otp_reference:
        return None
    try:
        payload = signing.loads(
            otp_reference,
            salt=OTP_REFERENCE_SALT,
            max_age=OTP_TTL_SECONDS,
        )
    except (BadSignature, SignatureExpired):
        return None

    if (
        payload.get('purpose') != 'employee_login'
        or str(payload.get('user_id')) != str(user_id)
        or not payload.get('nonce')
        or not payload.get('otp_digest')
    ):
        return None
    return payload


def _otp_matches_reference(reference_payload, user_id: str, otp_code: str) -> bool:
    candidate_digest = salted_hmac(
        OTP_REFERENCE_SALT,
        f"{user_id}:{reference_payload['nonce']}:{otp_code}",
    ).hexdigest()
    return constant_time_compare(candidate_digest, reference_payload['otp_digest'])


def _login_failure(reason: str, *, login_id: str = '', **context):
    logger.warning(
        'LOGIN_FAILED reason=%s login_id=%s context=%s',
        reason,
        login_id,
        context,
    )
    return Response(GENERIC_LOGIN_ERROR, status=status.HTTP_401_UNAUTHORIZED)


def _issue_password_reset_token(payload, source: str):
    reset_token = secrets.token_urlsafe(32)
    ttl_seconds = int(getattr(settings, 'EMPLOYEE_PASSWORD_RESET_TTL_SECONDS', 86400))
    expires_at = timezone.now() + timedelta(seconds=ttl_seconds)
    token_row = PasswordResetToken.objects.create(
        user_id=payload.user_id,
        token=reset_token,
        expires_at=expires_at,
        created_from=source,
    )
    return token_row


def _safe_issue_password_reset_token(payload, source: str):
    try:
        return _issue_password_reset_token(payload, source=source)
    except Exception as exc:
        logger.error('Token issuance failed: %s', exc)
        return None


def _build_frontend_base_url(request):
    request_origin = request.headers.get('Origin', '').strip()
    if request_origin:
        parsed_origin = urlparse(request_origin)
        if parsed_origin.hostname in {'localhost', '127.0.0.1', '::1'}:
            return request_origin.rstrip('/')

    return (
        getattr(settings, 'FRONTEND_URL', '').strip()
        or getattr(settings, 'COMPANY_DOMAIN', '').strip()
        or getattr(settings, 'EMPLOYEE_LOGIN_URL', '').strip().rsplit('/login', 1)[0]
        or request.build_absolute_uri('/').rstrip('/')
    ).rstrip('/')


def _is_valid_password(new_password: str):
    if len(new_password) < 8:
        return False, 'Password must be at least 8 characters long.'
    if not re.search(r'[A-Z]', new_password):
        return False, 'Password must include at least one uppercase letter.'
    if not re.search(r'[a-z]', new_password):
        return False, 'Password must include at least one lowercase letter.'
    if not re.search(r'\d', new_password):
        return False, 'Password must include at least one number.'
    if not re.search(r'[^A-Za-z0-9]', new_password):
        return False, 'Password must include at least one special character.'
    return True, ''


def _send_employee_otp(payload, *, bypass_cooldown: bool = False):
    if not payload.email:
        return False, Response(
            {'detail': 'Employee email is missing. Contact admin.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not bypass_cooldown and cache.get(_otp_cooldown_key(payload.user_id)):
        return False, Response(
            {'detail': f'Please wait {OTP_COOLDOWN_SECONDS} seconds before requesting a new OTP.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    otp_code = _generate_otp()
    otp_reference = _issue_otp_reference(payload.user_id, otp_code)
    _invalidate_previous_otps(payload.user_id)
    otp_payload = _store_otp_payload(payload.user_id, otp_code)
    cache.set(_otp_cooldown_key(payload.user_id), True, timeout=OTP_COOLDOWN_SECONDS)

    try:
        send_employee_otp_email(
            to_email=payload.email,
            employee_name=payload.full_name,
            otp_code=otp_code,
            otp_ttl_seconds=OTP_TTL_SECONDS,
        )
        logger.info('OTP_SENT_SUCCESSFULLY user_id=%s email=%s', payload.user_id, payload.email)
    except Exception:
        logger.exception('OTP_EMAIL_SEND_FAILED user_id=%s email=%s', payload.user_id, payload.email)
        return False, Response(
            {'detail': 'Unable to deliver OTP email. Please ensure your email is configured and try again. Contact admin if problem persists.'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    response_payload = {
        'detail': 'OTP sent to your registered email address.',
        'expires_at': otp_payload['expires_at'],
        'cooldown_seconds': OTP_COOLDOWN_SECONDS,
        'otp_reference': otp_reference,
    }
    if OTP_DEBUG_RESPONSE:
        response_payload['debug_otp'] = otp_code
    return True, response_payload


# ──────────────────────────────────────────────────────────────────────────────
# Internal JWT builder — called only by login_view
# ──────────────────────────────────────────────────────────────────────────────

def _build_token_pair(payload):
    logger.debug(
        "JWT_BUILD_START user_id=%s username=%s role_type=%s company_id=%s employee_id=%s",
        payload.user_id,
        payload.username,
        payload.role_type,
        payload.company_id,
        payload.employee_id,
    )

    refresh = RefreshToken()

    refresh['user_id']     = payload.user_id
    refresh['username']    = payload.username
    refresh['role_type']   = payload.role_type
    refresh['company_id']  = payload.company_id
    refresh['employee_id'] = payload.employee_id
    refresh['canteen_id']  = payload.canteen_id
    refresh['canteen_name'] = payload.canteen_name

    access = refresh.access_token
    access['user_id']     = payload.user_id
    access['username']    = payload.username
    access['role_type']   = payload.role_type
    access['company_id']  = payload.company_id
    access['employee_id'] = payload.employee_id
    access['canteen_id']  = payload.canteen_id
    access['canteen_name'] = payload.canteen_name

    logger.debug("JWT_BUILD_SUCCESS user_id=%s", payload.user_id)

    return access, refresh


# ──────────────────────────────────────────────────────────────────────────────
# Login
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def login_view(request):
    try:
        return _login_view_impl(request)
    except DatabaseError:
        logger.exception(
            "LOGIN_DATABASE_ERROR login_id=%s",
            request.data.get('login_id', ''),
        )
        return Response(
            {
                'detail': (
                    'Login is temporarily unavailable due to a server database error. '
                    'Please contact your administrator.'
                ),
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _login_view_impl(request):
    """
    POST /api/v1/auth/login/
    
    Authenticate user with login_id and password.
    
    For employees:
    - If must_change_password=true: return 403 with action-required code (redirect to reset flow)
    - If require_otp_after_password_change=true: return 403 with otp-required code (redirect to OTP flow)
    - Otherwise: return JWT pair normally
    
    For admins/kitchen: return JWT pair normally (no 2FA)
    """
    logger.info("LOGIN_ATTEMPT endpoint=/api/v1/auth/login/ ip=%s", request.META.get("REMOTE_ADDR"))

    login_id = request.data.get('login_id', '').strip()
    password = request.data.get('password', '')
    role = request.data.get('role', '').strip().lower()

    logger.debug("LOGIN_INPUT login_id=%s role=%s", login_id, role)

    if not login_id or not password:
        return _login_failure('missing_fields', login_id=login_id)

    if role not in {'employee', 'admin', 'kitchen', 'counter', 'super_admin', 'limited_admin'}:
        return _login_failure('invalid_role', login_id=login_id, requested_role=role)

    if role in {'kitchen', 'counter'}:
        client_ip = request.META.get('REMOTE_ADDR', '') or ''
        locked, lock_remaining = check_login_attempts(login_id, client_ip)
        if locked:
            return Response(
                {
                    'error': f'Account temporarily locked. Try again in {lock_remaining} seconds.',
                    'attempts_remaining': 0,
                },
                status=status.HTTP_423_LOCKED,
            )
        device_response = authenticate_device_login(request, login_id, password, role=role.upper())
        if device_response.status_code != status.HTTP_200_OK:
            _, attempts_remaining = record_failed_attempt(login_id, client_ip)
            payload = device_response.data if isinstance(device_response.data, dict) else {}
            if 'attempts_remaining' not in payload:
                payload = {
                    'error': payload.get('detail') or payload.get('error') or 'Invalid credentials.',
                    'attempts_remaining': attempts_remaining,
                }
            return Response(payload, status=device_response.status_code)
        clear_login_attempts(login_id)
        return device_response

    if role == 'super_admin':
        role = 'admin'
    if role == 'limited_admin':
        role = 'admin'

    if len(login_id) > 150:
        return _login_failure('login_id_too_long', login_id=login_id[:150])

    client_ip = request.META.get('REMOTE_ADDR', '') or ''
    locked, lock_remaining = check_login_attempts(login_id, client_ip)
    if locked:
        log_action(
            actor=None,
            action_category=AuditLog.ACTION_AUTH,
            action='account_locked',
            request=request,
            metadata={'login_id': login_id, 'remaining_seconds': lock_remaining},
            is_sensitive=True,
        )
        return Response(
            {
                'error': f'Account temporarily locked. Try again in {lock_remaining} seconds.',
                'attempts_remaining': 0,
            },
            status=status.HTTP_423_LOCKED,
        )

    payload = authenticate_employee(login_id, password)
    if payload is None:
        record_failed_attempt(login_id, client_ip)
        log_action(
            actor=None,
            action_category=AuditLog.ACTION_AUTH,
            action='login_failed',
            request=request,
            metadata={'login_id': login_id},
            is_sensitive=True,
        )
        logger.warning("LOGIN_FAILED_INVALID_CREDENTIALS login_id=%s", login_id)
        return _login_failure('invalid_credentials', login_id=login_id)

    clear_login_attempts(login_id)

    user = User.objects.get(id=payload.user_id)
    employee_record = (
        Employee.objects
        .select_related('user')
        .filter(user_id=user.id)
        .first()
    )
    if not user.is_active or (employee_record and not employee_record.is_active):
        logger.warning("LOGIN_FAILED_INACTIVE_USER user_id=%s", payload.user_id)
        return _login_failure('inactive_user', login_id=login_id, user_id=payload.user_id)

    if role == 'admin' and payload.role_type not in RoleChoices.ALL_ADMIN_ROLES:
        logger.warning("LOGIN_FAILED_ROLE_MISMATCH_ADMIN user_id=%s role_type=%s", payload.user_id, payload.role_type)
        return _login_failure(
            'role_mismatch',
            login_id=login_id,
            user_id=payload.user_id,
            requested_role=role,
            actual_role=payload.role_type,
        )

    if role == 'employee' and payload.role_type != RoleChoices.EMPLOYEE:
        logger.warning("LOGIN_FAILED_ROLE_MISMATCH_EMPLOYEE user_id=%s role_type=%s", payload.user_id, payload.role_type)
        return _login_failure(
            'role_mismatch',
            login_id=login_id,
            user_id=payload.user_id,
            requested_role=role,
            actual_role=payload.role_type,
        )

    # ─── Role-specific password and OTP rules ────────────────────────────────
    if user.must_change_password:
        temp_token = issue_must_change_temp_token(str(user.id))
        logger.info("LOGIN_MUST_CHANGE_PASSWORD user_id=%s", payload.user_id)
        return Response({
            'must_change_password': True,
            'temp_token': temp_token,
            'message': 'Please set a new password to continue.',
        }, status=status.HTTP_200_OK)

    if payload.role_type == RoleChoices.EMPLOYEE:
        # If require_otp_after_password_change flag is set, require OTP for this login
        if user.require_otp_after_password_change:
            logger.info("LOGIN_ACTION_REQUIRED_OTP user_id=%s", payload.user_id)
            cache.set(_login_challenge_key(payload.user_id), {
                'user_id': payload.user_id,
                'username': payload.username,
                'full_name': payload.full_name,
                'email': payload.email,
                'company_id': payload.company_id,
                'employee_id': payload.employee_id,
            }, timeout=300)
            sent, result = _send_employee_otp(payload, bypass_cooldown=True)
            if not sent:
                return result
            return Response({
                'action_required': 'otp_verification',
                'detail': 'Your password was recently changed. An OTP has been sent to your registered email to complete login.',
                'user_id': payload.user_id,
                'username': payload.username,
                'otp_sent': True,
                'otp_reference': result.get('otp_reference') if isinstance(result, dict) else None,
                'debug_otp': result.get('debug_otp') if isinstance(result, dict) else None,
            }, status=status.HTTP_403_FORBIDDEN)

    # ─── Successful Login ───────────────────────────────────────────────────
    session_tokens = create_session(user, request, payload)

    logger.info(
        "LOGIN_SUCCESS user_id=%s username=%s role_type=%s company_id=%s",
        payload.user_id,
        payload.username,
        payload.role_type,
        payload.company_id,
    )
    log_action(
        actor=user,
        action_category=AuditLog.ACTION_AUTH,
        action='login',
        request=request,
        metadata={'role': role, 'role_type': payload.role_type},
    )

    return Response({
        'access':      session_tokens['access'],
        'refresh':     session_tokens['refresh'],
        'expires_in':  session_tokens['expires_in'],
        'user_id':     payload.user_id,
        'username':    payload.username,
        'full_name':   payload.full_name,
        'role_type':   payload.role_type,
        'email':       payload.email,
        'company_id':  payload.company_id,
        'employee_id': payload.employee_id,
        'canteen_id':  payload.canteen_id,
        'canteen_name': payload.canteen_name,
        'must_change_password': bool(user.must_change_password),
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def request_employee_otp_view(request):
    login_id = request.data.get('login_id', '').strip()
    role = request.data.get('role', '').strip().lower() or 'employee'
    otp_reference = request.data.get('otp_reference', '').strip()

    if role != 'employee':
        return Response(
            {'detail': 'OTP login is available only for employees.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not login_id:
        return Response(
            {'detail': 'login_id is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(login_id) > 150:
        return Response(
            {'detail': 'login_id is too long.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    payload = resolve_employee_identity(login_id)
    if payload is None or not payload.is_active:
        return Response(
            {'detail': 'Employee account not found or inactive.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    if payload.role_type != RoleChoices.EMPLOYEE:
        return Response(
            {'detail': 'OTP login is available only for employees.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    has_login_challenge = bool(cache.get(_login_challenge_key(payload.user_id)))
    has_reference_challenge = bool(_load_otp_reference(otp_reference, payload.user_id))
    if not has_login_challenge and not has_reference_challenge:
        return Response(
            {'detail': 'Please log in first or ensure you have completed the initial password setup to use OTP.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    sent, result = _send_employee_otp(payload)
    if not sent:
        return result

    return Response(result, status=status.HTTP_200_OK)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def verify_employee_otp_view(request):
    """
    POST /api/v1/auth/otp/verify/
    
    Verify 6-digit OTP sent to employee email.
    If require_otp_after_password_change flag is set, clear it and set last_2fa_verified_at.
    Return JWT pair on success.
    """
    login_id = request.data.get('login_id', '').strip()
    otp = request.data.get('otp', '').strip()
    role = request.data.get('role', '').strip().lower() or 'employee'
    otp_reference = request.data.get('otp_reference', '').strip()

    if role != 'employee':
        return Response(
            {'detail': 'OTP login is available only for employees.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not login_id or not otp:
        return Response(
            {'detail': 'login_id and otp are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(login_id) > 150:
        return Response(
            {'detail': 'login_id is too long.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not re.fullmatch(r'\d{6}', otp):
        return Response(
            {'detail': 'otp must be a 6-digit code.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    payload = resolve_employee_identity(login_id)
    if payload is None or not payload.is_active:
        return Response(
            {'detail': 'Employee account not found or inactive.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    if payload.role_type != RoleChoices.EMPLOYEE:
        return Response(
            {'detail': 'OTP login is available only for employees.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    reference_payload = _load_otp_reference(otp_reference, payload.user_id)
    has_legacy_challenge = bool(cache.get(_login_challenge_key(payload.user_id)))
    if not reference_payload and not has_legacy_challenge:
        return Response(
            {'detail': 'No OTP request found. Please request a new OTP first.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    expected_payload = _get_otp_payload(payload.user_id)
    attempt_ts = timezone.now().isoformat()

    if not expected_payload and not reference_payload:
        logger.warning('OTP_VERIFY_NO_PAYLOAD user_id=%s at=%s', payload.user_id, attempt_ts)
        return Response(
            {'detail': 'OTP has expired. Please request a new one.', 'code': 'OTP_EXPIRED'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if expected_payload and expected_payload.get('used'):
        logger.warning('OTP_VERIFY_ALREADY_USED user_id=%s at=%s', payload.user_id, attempt_ts)
        return Response(
            {'detail': 'OTP already used. Please request a new one.', 'code': 'OTP_USED'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if expected_payload and _otp_is_expired(expected_payload):
        cache.delete(_otp_cache_key(payload.user_id))
        logger.warning('OTP_VERIFY_EXPIRED user_id=%s at=%s expires_at=%s', payload.user_id, attempt_ts, expected_payload.get('expires_at'))
        return Response(
            {'detail': 'OTP has expired. Please request a new one.', 'code': 'OTP_EXPIRED'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    attempts = int(
        cache.get(_otp_attempts_key(payload.user_id))
        or (expected_payload.get('attempts') if expected_payload else 0)
        or 0
    )
    expected_code = expected_payload.get('code') if isinstance(expected_payload, dict) else expected_payload
    otp_is_valid = (
        _otp_matches_reference(reference_payload, payload.user_id, otp)
        if reference_payload
        else otp == expected_code
    )

    if not otp_is_valid:
        attempts += 1
        cache.set(_otp_attempts_key(payload.user_id), attempts, timeout=OTP_TTL_SECONDS)
        if expected_payload:
            expected_payload['attempts'] = attempts
            cache.set(_otp_cache_key(payload.user_id), expected_payload, timeout=OTP_TTL_SECONDS)
        logger.warning(
            'OTP_VERIFY_INVALID user_id=%s attempt=%s at=%s',
            payload.user_id,
            attempts,
            attempt_ts,
        )
        if attempts >= OTP_MAX_ATTEMPTS:
            _invalidate_previous_otps(payload.user_id)
            return Response(
                {
                    'detail': 'Too many attempts. Please request a new OTP.',
                    'code': 'OTP_MAX_TRIES',
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )
        remaining = OTP_MAX_ATTEMPTS - attempts
        return Response(
            {
                'detail': f'Invalid OTP. {remaining} attempts remaining.',
                'code': 'OTP_INVALID',
                'attempts_remaining': remaining,
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if expected_payload:
        expected_payload['used'] = True
        cache.set(_otp_cache_key(payload.user_id), expected_payload, timeout=60)
    cache.delete(_otp_cache_key(payload.user_id))
    cache.delete(_otp_attempts_key(payload.user_id))
    cache.delete(_login_challenge_key(payload.user_id))

    # ─── Clear require_otp_after_password_change flag if set ─────────────────
    challenge_cleared = User.objects.filter(
        id=payload.user_id,
        require_otp_after_password_change=True,
    ).update(
        require_otp_after_password_change=False,
        last_2fa_verified_at=timezone.now(),
    )
    if not challenge_cleared:
        return Response(
            {'detail': 'No OTP request found. Please log in again.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    logger.info("OTP_2FA_VERIFIED_FLAG_CLEARED user_id=%s", payload.user_id)

    access, refresh = _build_token_pair(payload)

    logger.info("OTP_VERIFIED_SUCCESS user_id=%s", payload.user_id)

    return Response({
        'access':      str(access),
        'refresh':     str(refresh),
        'user_id':     payload.user_id,
        'username':    payload.username,
        'full_name':   payload.full_name,
        'role_type':   payload.role_type,
        'email':       payload.email,
        'company_id':  payload.company_id,
        'employee_id': payload.employee_id,
    }, status=status.HTTP_200_OK)


# ──────────────────────────────────────────────────────────────────────────────
# Refresh
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def refresh_view(request):
    logger.info("TOKEN_REFRESH_ATTEMPT endpoint=/api/v1/auth/refresh/")

    raw_refresh = request.data.get('refresh', '').strip()

    if not raw_refresh:
        logger.warning("TOKEN_REFRESH_FAILED_NO_TOKEN")
        return Response(
            {'detail': 'refresh token is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        refresh = RefreshToken(raw_refresh)

        if refresh.get('role_type') in ('KITCHEN', 'COUNTER'):
            logger.warning("TOKEN_REFRESH_BLOCKED_DEVICE_TOKEN")
            return Response(
                {'detail': 'Device tokens cannot be refreshed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_id = refresh.get('user_id')
        user = User.objects.filter(id=user_id, is_active=True).first()
        if not user:
            logger.warning("TOKEN_REFRESH_FAILED_USER_NOT_FOUND user_id=%s", user_id)
            return Response(
                {'detail': 'Invalid or expired refresh token.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        from apps.common.auth_utils import db_role_for_user

        db_role = db_role_for_user(user)
        access = refresh.access_token
        access['role_type'] = db_role

        logger.info("TOKEN_REFRESH_SUCCESS user_id=%s role_type=%s", user_id, db_role)

        return Response({
            'access': str(access),
            'user_id': access.get('user_id'),
            'username': access.get('username'),
            'role_type': db_role,
            'company_id': access.get('company_id'),
            'employee_id': access.get('employee_id'),
            'canteen_id': access.get('canteen_id'),
            'canteen_name': access.get('canteen_name'),
        })

    except TokenError:
        logger.warning("TOKEN_REFRESH_FAILED_INVALID")
        return Response(
            {'detail': 'Invalid or expired refresh token.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )


# ──────────────────────────────────────────────────────────────────────────────
# Logout
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    refresh_token = request.data.get('refresh_token', '').strip() or request.data.get('refresh', '').strip()
    if refresh_token:
        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except Exception:
            logger.debug('Refresh token blacklist failed during logout', exc_info=True)
        clear_session_cache(request.user, refresh_token)

    logger.info(
        "LOGOUT_SUCCESS endpoint=/api/v1/auth/logout/ user_id=%s",
        request.user.id if request.user else None
    )
    log_action(
        actor=request.user,
        action_category=AuditLog.ACTION_AUTH,
        action='logout',
        request=request,
    )
    return Response({'message': 'Logged out successfully.'}, status=status.HTTP_200_OK)


# ──────────────────────────────────────────────────────────────────────────────
# Me — identity check
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    logger.info("ME_ENDPOINT_HIT endpoint=/api/v1/auth/me/")

    token = request.auth

    if token is None:
        logger.warning("ME_FAILED_NO_TOKEN")
        return Response({'detail': 'No token.'}, status=status.HTTP_401_UNAUTHORIZED)

    user = request.user
    from apps.common.auth_utils import db_role_for_user

    role_type = db_role_for_user(user) or token.get('role_type')
    logger.debug("ME_SUCCESS user_id=%s role_type=%s", token.get('user_id'), role_type)

    employee = None
    employee_id = token.get('employee_id')
    if employee_id:
        employee = Employee.objects.select_related('canteen').filter(id=employee_id, is_active=True).first()

    return Response({
        'user_id':     token.get('user_id'),
        'username':    token.get('username'),
        'role_type':   role_type,
        'company_id':  token.get('company_id'),
        'employee_id': token.get('employee_id'),
        'canteen_id':  str(employee.canteen_id) if employee and employee.canteen_id else token.get('canteen_id'),
        'canteen_name': employee.canteen.name if employee and employee.canteen_id else token.get('canteen_name', ''),
        'must_change_password': bool(getattr(user, 'must_change_password', False)),
    }, status=status.HTTP_200_OK)


# ──────────────────────────────────────────────────────────────────────────────
# Password Reset / Change Endpoints
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def password_reset_request_view(request):
    """
    POST /api/v1/auth/password-reset/request/
    POST /api/v1/auth/forgot-password/

    Always returns the same message to prevent account enumeration.
    """
    generic_message = 'If a matching account exists, a reset link has been sent.'

    try:
        login_id = (request.data.get('login_id') or '').strip()

        client_ip = request.META.get('REMOTE_ADDR', '') or 'unknown'
        rate_key = f'pwd_reset_rate:{client_ip}'
        current_rate = int(cache.get(rate_key, 0) or 0)
        if current_rate >= 5:
            return Response({'message': generic_message}, status=status.HTTP_200_OK)
        cache.set(rate_key, current_rate + 1, timeout=300)

        if not login_id:
            return Response({'message': generic_message}, status=status.HTTP_200_OK)

        from .auth_service import resolve_employee_identity

        payload = resolve_employee_identity(login_id)
        if payload is not None and payload.is_active and payload.role_type == RoleChoices.EMPLOYEE:
            token_row = _safe_issue_password_reset_token(payload, source='forgot_password')
            if token_row is not None:
                frontend_base_url = _build_frontend_base_url(request)
                reset_url = (
                    f"{frontend_base_url}#/reset-password?"
                    f"token={token_row.token}&uid={payload.user_id}"
                )
                try:
                    send_employee_password_reset_email(
                        to_email=payload.email,
                        employee_name=payload.full_name,
                        reset_url=reset_url,
                    )
                except Exception:
                    logger.exception('PASSWORD_RESET_EMAIL_SEND_FAILED')

        return Response({'message': generic_message}, status=status.HTTP_200_OK)
    except Exception as exc:
        logger.error('forgot_password error: %s', type(exc).__name__)
        return Response({'message': generic_message}, status=status.HTTP_200_OK)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def password_reset_confirm_view(request):
    """
    POST /api/v1/auth/password-reset/confirm/
    """
    try:
        reset_token = request.data.get('reset_token', '').strip() or request.data.get('token', '').strip()
        uid = request.data.get('uid', '')
        new_password = request.data.get('password', '') or request.data.get('new_password', '')

        if not reset_token or not new_password:
            return Response(
                {'error': 'Invalid or expired reset link.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        valid_password, password_error = _is_valid_password(new_password)
        if not valid_password:
            return Response(
                {'error': password_error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            reset_row = (
                PasswordResetToken.objects
                .select_for_update()
                .select_related('user')
                .filter(token=reset_token)
                .first()
            )
            now = timezone.now()
            invalid_reason = None
            if reset_row is None:
                invalid_reason = 'not_found'
            elif reset_row.used_at is not None:
                invalid_reason = 'already_used'
            elif now >= reset_row.expires_at:
                invalid_reason = 'expired'
            elif uid and str(reset_row.user_id) != str(uid):
                invalid_reason = 'user_mismatch'

            if invalid_reason:
                return Response(
                    {'error': 'Invalid or expired reset link.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user = reset_row.user
            if not user.is_active:
                return Response(
                    {'error': 'Invalid or expired reset link.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user.set_password(new_password)
            user.must_change_password = False
            user.require_otp_after_password_change = True
            user.password_changed_at = now
            user.save()
            reset_row.used_at = now
            reset_row.save(update_fields=['used_at'])

        cache.delete(_otp_cache_key(str(user.id)))
        cache.delete(_login_challenge_key(str(user.id)))

        log_action(
            actor=user,
            action_category=AuditLog.ACTION_AUTH,
            action='password_reset',
            target=user,
            request=request,
            metadata={'via': 'email_link'},
            is_sensitive=True,
        )

        return Response(
            {'detail': 'Password reset successful. Please log in with your new password to receive OTP verification.'},
            status=status.HTTP_200_OK,
        )
    except ObjectDoesNotExist:
        return Response({'error': 'Invalid or expired reset link.'}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        logger.exception('password_reset_confirm error')
        return Response({'error': 'Unable to process request.'}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def set_password_view(request):
    """Authenticated password change for limited admin legacy flow."""
    new_password = request.data.get('new_password', '')
    valid_password, password_error = _is_valid_password(new_password)
    if not valid_password:
        return Response({'detail': password_error}, status=status.HTTP_400_BAD_REQUEST)

    was_must_change = bool(getattr(request.user, 'must_change_password', False))
    try:
        user = User.objects.get(id=request.user.id, is_active=True)
        user.set_password(new_password)
        user.must_change_password = False
        user.password_changed_at = timezone.now()
        user.save(update_fields=['password', 'must_change_password', 'password_changed_at'])
        logger.info("PASSWORD_SET_SUCCESS user_id=%s", user.id)
        log_action(
            actor=user,
            action_category=AuditLog.ACTION_AUTH,
            action='first_time_password_set' if was_must_change else 'password_change',
            target=user,
            request=request,
            is_sensitive=True,
        )
        return Response({'detail': 'Password set successfully.'}, status=status.HTTP_200_OK)
    except Exception as exc:
        logger.exception("PASSWORD_SET_FAILED user_id=%s err=%s", request.user.id, str(exc))
        return Response({'detail': 'Unable to set password right now.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def set_password_init_view(request):
    """
    POST /api/v1/auth/set-password/

    Validates temp_token and new password, sends OTP to registered email.
    Does not update password until OTP is verified.
    """
    temp_token = extract_temp_token(request)
    new_password = request.data.get('new_password', '')

    user_id = resolve_temp_token(temp_token)
    if not user_id:
        return Response({'error': 'Invalid or expired session. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)

    valid_password, password_error = _is_valid_password(new_password)
    if not valid_password:
        return Response({'error': password_error}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(id=user_id, is_active=True)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    if not user.must_change_password:
        return Response({'error': 'Password change is not required.'}, status=status.HTTP_400_BAD_REQUEST)

    if not user.email:
        return Response({'error': 'No email on file. Contact your administrator.'}, status=status.HTTP_400_BAD_REQUEST)

    otp_code = generate_set_password_otp()
    store_pending_password(user_id, new_password)
    store_set_password_otp(user_id, otp_code)

    try:
        send_set_password_otp_email(
            to_email=user.email,
            employee_name=user.get_full_name() or user.username,
            otp_code=otp_code,
        )
    except Exception:
        logger.exception('SET_PASSWORD_OTP_EMAIL_FAILED user_id=%s', user_id)
        invalidate_set_password_flow(user_id, temp_token)
        return Response({'error': 'Unable to send OTP email.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    response_payload = {
        'otp_sent': True,
        'message': 'OTP sent to your email',
    }
    if OTP_DEBUG_RESPONSE:
        response_payload['debug_otp'] = otp_code
    return Response(response_payload, status=status.HTTP_200_OK)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def set_password_verify_view(request):
    """
    POST /api/v1/auth/set-password/verify/

    Validates OTP, updates password, issues JWT pair.
    """
    temp_token = extract_temp_token(request)
    otp = str(request.data.get('otp', '')).strip()
    new_password = request.data.get('new_password', '')

    user_id = resolve_temp_token(temp_token)
    if not user_id:
        return Response({'error': 'OTP expired. Please start again.'}, status=status.HTTP_400_BAD_REQUEST)

    valid_password, password_error = _is_valid_password(new_password)
    if not valid_password:
        return Response({'error': password_error}, status=status.HTTP_400_BAD_REQUEST)

    pending_password = get_pending_password(user_id)
    if pending_password and pending_password != new_password:
        return Response({'error': 'Password mismatch. Please start again.'}, status=status.HTTP_400_BAD_REQUEST)

    expected_otp = get_set_password_otp(user_id)
    if not expected_otp:
        invalidate_set_password_flow(user_id, temp_token)
        return Response({'error': 'OTP expired. Please start again.'}, status=status.HTTP_400_BAD_REQUEST)

    if otp != str(expected_otp):
        attempts = increment_set_password_otp_attempts(user_id)
        if attempts >= SET_PWD_OTP_MAX_ATTEMPTS:
            invalidate_set_password_flow(user_id, temp_token)
            return Response({'error': 'Too many invalid OTP attempts. Please log in again.'}, status=status.HTTP_400_BAD_REQUEST)
        remaining = SET_PWD_OTP_MAX_ATTEMPTS - attempts
        return Response({'error': f'Invalid OTP. {remaining} attempts remaining.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(id=user_id, is_active=True)
    except User.DoesNotExist:
        invalidate_set_password_flow(user_id, temp_token)
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    user.set_password(new_password)
    user.must_change_password = False
    user.password_changed_at = timezone.now()
    user.save(update_fields=['password', 'must_change_password', 'password_changed_at'])

    invalidate_temp_token(temp_token)
    clear_pending_password(user_id)
    clear_set_password_otp(user_id)
    invalidate_all_sessions(user)

    payload = _payload_from_user_for_session(user)
    session_tokens = create_session(user, request, payload)

    log_action(
        actor=user,
        action_category=AuditLog.ACTION_AUTH,
        action='first_time_password_set',
        target=user,
        request=request,
        is_sensitive=True,
    )

    return Response({
        'access': session_tokens['access'],
        'refresh': session_tokens['refresh'],
        'expires_in': session_tokens['expires_in'],
        'user_id': payload.user_id,
        'username': payload.username,
        'full_name': payload.full_name,
        'role_type': payload.role_type,
        'email': payload.email,
        'company_id': payload.company_id,
        'employee_id': payload.employee_id,
        'canteen_id': payload.canteen_id,
        'canteen_name': payload.canteen_name,
        'message': 'Password updated successfully.',
    }, status=status.HTTP_200_OK)


def _payload_from_user_for_session(user):
    from .auth_service import _payload_from_user
    return _payload_from_user(user)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def password_change_view(request):
    """
    POST /api/v1/auth/password-change/
    
    Authenticated user changes their own password.
    Requires old password verification and sets require_otp_after_password_change flag.
    """
    old_password = request.data.get('old_password', '')
    new_password = request.data.get('new_password', '')
    
    if not old_password or not new_password:
        return Response(
            {'detail': 'old_password and new_password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    if len(new_password) < 8:
        return Response(
            {'detail': 'New password must be at least 8 characters long.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    
    try:
        from .models import User
        user = User.objects.get(id=request.user.id)
        
        if not user.check_password(old_password):
            logger.warning("PASSWORD_CHANGE_FAILED wrong old password user_id=%s", user.id)
            return Response(
                {'detail': 'Old password is incorrect.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        
        user.set_password(new_password)
        user.require_otp_after_password_change = True  # Force OTP on next login
        from django.utils import timezone
        user.password_changed_at = timezone.now()
        user.save()
        
        logger.info("PASSWORD_CHANGE_SUCCESS user_id=%s", user.id)
        log_action(
            actor=user,
            action_category=AuditLog.ACTION_AUTH,
            action='password_change',
            target=user,
            request=request,
            is_sensitive=True,
        )
        
        return Response(
            {'detail': 'Password changed successfully. You will need to verify with OTP on next login.'},
            status=status.HTTP_200_OK,
        )
    except Exception as e:
        logger.exception("PASSWORD_CHANGE_ERROR user_id=%s: %s", request.user.id, str(e))
        return Response(
            {'detail': 'An error occurred while changing password.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ──────────────────────────────────────────────────────────────────────────────
# Employee Management — CRUD Endpoints
# ──────────────────────────────────────────────────────────────────────────────

from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework.exceptions import ParseError
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q

from .models import Company, Employee, Department
from .serializers import (
    CompanySerializer,
    EmployeeListSerializer,
    EmployeeDetailSerializer,
    EmployeeBulkCreateSerializer,
    DepartmentSerializer,
)
from apps.common.permissions import IsCMSAdmin
from apps.common.auth_utils import get_effective_role
from apps.core.permissions import IsAdminOrLimitedAdmin


class EmployeePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 50


class EmployeeViewSet(ModelViewSet):
    """
    Employee CRUD API with search, filtering, and bulk operations.
    
    Endpoints:
        GET    /api/v1/auth/employees/                  — list (paginated, searchable)
        POST   /api/v1/auth/employees/                  — create single
        POST   /api/v1/auth/employees/bulk-create/      — bulk create
        GET    /api/v1/auth/employees/{id}/             — retrieve
        PUT    /api/v1/auth/employees/{id}/             — full update
        PATCH  /api/v1/auth/employees/{id}/             — partial update
        DELETE /api/v1/auth/employees/{id}/             — delete
    """
    
    queryset = Employee.objects.select_related('department', 'canteen', 'user').order_by('-created_at')
    permission_classes = [IsAuthenticated, IsCMSAdmin]
    pagination_class = EmployeePagination
    
    def get_serializer_class(self):
        """Use reduced serializer for list; full detail for retrieve/create/update."""
        if self.action == 'list':
            return EmployeeListSerializer
        if self.action in ['create', 'update', 'partial_update', 'retrieve']:
            return EmployeeDetailSerializer
        return EmployeeListSerializer
    
    def list(self, request, *args, **kwargs):
        """
        GET /api/v1/auth/employees/?page=1&page_size=10&search=john&department=IT&employee_code=EMP001
        """
        employee_code = request.query_params.get('employee_code', '').strip()
        search = request.query_params.get('search', '').strip()
        department_filter = request.query_params.get('department', '').strip()

        queryset = self.get_queryset()

        if employee_code:
            queryset = queryset.filter(employee_code__iexact=employee_code)
            if not queryset.exists():
                return Response(
                    {'error': f'No employee found with code: {employee_code}'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            log_action(
                actor=request.user,
                action_category=AuditLog.ACTION_USER_MGMT,
                action='bulk_employee_list_accessed',
                request=request,
                metadata={
                    'ip': request.META.get('REMOTE_ADDR'),
                    'record_count': queryset.count(),
                    'employee_code': employee_code,
                },
            )
            serializer = self.get_serializer(queryset, many=True)
            return Response({'count': queryset.count(), 'results': serializer.data})

        if search:
            queryset = queryset.filter(
                Q(employee_code__icontains=search) |
                Q(first_name__icontains=search) |
                Q(last_name__icontains=search) |
                Q(email__icontains=search) |
                Q(phone__icontains=search) |
                Q(designation__icontains=search)
            )

        if department_filter and department_filter != 'All':
            queryset = queryset.filter(department__name__icontains=department_filter)

        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_USER_MGMT,
            action='bulk_employee_list_accessed',
            request=request,
            metadata={
                'ip': request.META.get('REMOTE_ADDR'),
                'record_count': queryset.count(),
            },
        )

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response({'count': queryset.count(), 'results': serializer.data})
    
    def create(self, request, *args, **kwargs):
        """POST /api/v1/auth/employees/ — create single employee."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = serializer.save()
        self._notify_employee_change(employee, "created")
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_USER_MGMT,
            action='employee_created',
            target=employee,
            previous_state=None,
            new_state=_employee_snapshot(employee),
            request=request,
            metadata={'role_type': employee.user.role_type if employee.user else None},
        )
        if employee.user and employee.user.role_type == RoleChoices.LIMITED_ADMIN:
            log_action(
                actor=request.user,
                action_category=AuditLog.ACTION_PERMISSIONS,
                action='limited_admin_created',
                target=employee.user,
                request=request,
                metadata={'employee_id': str(employee.id)},
            )
        response_data = {
            'id': str(employee.id),
            'employee_code': employee.employee_code,
            'email': employee.email,
            'message': 'Employee created. Credentials sent to registered email.',
        }
        return Response(response_data, status=status.HTTP_201_CREATED)
    
    @action(detail=False, methods=['post'], url_path='bulk-create')
    def bulk_create(self, request):
        """POST /api/v1/auth/employees/bulk-create/ — bulk create employees."""
        serializer = EmployeeBulkCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        created = serializer.save()
        for employee in created:
            self._notify_employee_change(employee, "created")
        
        response_data = {
            'created': EmployeeDetailSerializer(created, many=True).data,
            'count': len(created),
        }
        
        # Include failed employees if any
        if hasattr(serializer, 'failed_employees') and serializer.failed_employees:
            response_data['failed'] = serializer.failed_employees
            response_data['failed_count'] = len(serializer.failed_employees)
        
        return Response(response_data, status=status.HTTP_201_CREATED)

    def _employee_activation_scope_check(self, request, employee):
        role_type = get_effective_role(request)
        if role_type == RoleChoices.LIMITED_ADMIN:
            actor_employee = Employee.objects.filter(user_id=request.user.id).first()
            actor_canteen_id = str(actor_employee.canteen_id) if actor_employee and actor_employee.canteen_id else None
            if not actor_canteen_id or str(employee.canteen_id) != actor_canteen_id:
                return Response({'error': 'Access denied.'}, status=status.HTTP_403_FORBIDDEN)
        return None

    @action(detail=True, methods=['patch'], url_path='activate', permission_classes=[IsAuthenticated, IsAdminOrLimitedAdmin])
    def activate(self, request, pk=None):
        """PATCH /api/v1/auth/employees/{id}/activate/"""
        try:
            employee = self.get_object()
        except Employee.DoesNotExist:
            return Response({'error': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

        denied = self._employee_activation_scope_check(request, employee)
        if denied:
            return denied

        before = _employee_snapshot(employee)
        employee.is_active = True
        employee.save(update_fields=['is_active', 'updated_at'])

        if employee.user:
            employee.user.is_active = True
            employee.user.save(update_fields=['is_active'])

        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_USER_MGMT,
            action='employee_activated',
            target=employee,
            previous_state=before,
            new_state=_employee_snapshot(employee),
            request=request,
        )

        return Response({
            'message': f'{employee.first_name} has been activated.',
            'is_active': True,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['patch'], url_path='deactivate', permission_classes=[IsAuthenticated, IsAdminOrLimitedAdmin])
    def deactivate(self, request, pk=None):
        """PATCH /api/v1/auth/employees/{id}/deactivate/"""
        try:
            employee = self.get_object()
        except Employee.DoesNotExist:
            return Response({'error': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

        if employee.user and employee.user_id == request.user.id:
            return Response({'error': 'You cannot deactivate your own account.'}, status=status.HTTP_400_BAD_REQUEST)

        denied = self._employee_activation_scope_check(request, employee)
        if denied:
            return denied

        before = _employee_snapshot(employee)
        employee.is_active = False
        employee.save(update_fields=['is_active', 'updated_at'])

        if employee.user:
            employee.user.is_active = False
            employee.user.save(update_fields=['is_active'])
            invalidate_user_tokens(employee.user)

        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_USER_MGMT,
            action='employee_deactivated',
            target=employee,
            previous_state=before,
            new_state=_employee_snapshot(employee),
            request=request,
        )

        return Response({
            'message': f'{employee.first_name} has been deactivated.',
            'is_active': False,
        }, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='toggle-active')
    def toggle_active(self, request, pk=None):
        """
        POST /api/v1/auth/employees/{id}/toggle-active/
        
        Toggle the active status of an employee. This also deactivates/activates the associated User.
        """
        try:
            employee = self.get_object()
            before = _employee_snapshot(employee)
            old_role = employee.user.role_type if employee.user else None
            employee.is_active = not employee.is_active
            employee.save(update_fields=['is_active', 'updated_at'])
            
            # Sync user's active state
            if employee.user:
                employee.user.is_active = employee.is_active
                employee.user.save(update_fields=['is_active'])
                if not employee.is_active:
                    invalidate_user_tokens(employee.user)
                
            status_str = "activated" if employee.is_active else "deactivated"
            self._notify_employee_change(employee, status_str)
            log_action(
                actor=request.user,
                action_category=AuditLog.ACTION_USER_MGMT,
                action='employee_activated' if employee.is_active else 'employee_deactivated',
                target=employee,
                previous_state=before,
                new_state=_employee_snapshot(employee),
                request=request,
            )
            if old_role == RoleChoices.LIMITED_ADMIN and not employee.is_active:
                log_action(
                    actor=request.user,
                    action_category=AuditLog.ACTION_PERMISSIONS,
                    action='limited_admin_deactivated',
                    target=employee.user,
                    request=request,
                    metadata={'employee_id': str(employee.id)},
                )
            logger.info("EMPLOYEE_TOGGLE_ACTIVE_SUCCESS admin_user_id=%s employee_id=%s status=%s", request.user.id, employee.id, status_str)
            
            return Response({
                'detail': f'Employee {employee.full_name} has been successfully {status_str}.',
                'id': employee.id,
                'is_active': employee.is_active
            }, status=status.HTTP_200_OK)
        except Employee.DoesNotExist:
            return Response(
                {'detail': 'Employee not found.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        except Exception as e:
            logger.exception("EMPLOYEE_TOGGLE_ACTIVE_ERROR: %s", str(e))
            return Response(
                {'detail': 'An error occurred while toggling employee active status.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def perform_update(self, serializer):
        before = _employee_snapshot(serializer.instance)
        old_role = serializer.instance.user.role_type if serializer.instance.user else None
        employee = serializer.save()
        self._notify_employee_change(employee, "updated")
        log_action(
            actor=self.request.user,
            action_category=AuditLog.ACTION_USER_MGMT,
            action='employee_updated',
            target=employee,
            previous_state=before,
            new_state=_employee_snapshot(employee),
            request=self.request,
        )
        new_role = employee.user.role_type if employee.user else None
        if old_role == RoleChoices.LIMITED_ADMIN or new_role == RoleChoices.LIMITED_ADMIN:
            log_action(
                actor=self.request.user,
                action_category=AuditLog.ACTION_PERMISSIONS,
                action='limited_admin_role_changed',
                target=employee.user,
                previous_state={'role_type': old_role},
                new_state={'role_type': new_role},
                request=self.request,
            )

    def perform_destroy(self, instance):
        before = _employee_snapshot(instance)
        target_user = instance.user
        employee_name = instance.full_name
        employee_code = instance.employee_code
        company_id = instance.company_id
        canteen_id = instance.canteen_id
        super().perform_destroy(instance)
        notify_admins(
            "Employee deleted",
            f"{employee_name} ({employee_code}) was deleted.",
            company_id=company_id,
            canteen_id=canteen_id,
        )
        log_action(
            actor=self.request.user,
            action_category=AuditLog.ACTION_USER_MGMT,
            action='employee_offboarded',
            target=target_user or instance,
            previous_state=before,
            new_state=None,
            request=self.request,
        )

    def _notify_employee_change(self, employee, action):
        notify_admins(
            f"Employee {action}",
            f"{employee.full_name} ({employee.employee_code}) was {action}.",
            company_id=employee.company_id,
            canteen_id=employee.canteen_id,
        )


class DepartmentViewSet(ModelViewSet):
    """
    Department CRUD API.
    
    Endpoints:
        GET    /api/v1/auth/departments/          — list all active departments
        POST   /api/v1/auth/departments/          — create department
        GET    /api/v1/auth/departments/{id}/     — retrieve department
        PUT    /api/v1/auth/departments/{id}/     — full update
        PATCH  /api/v1/auth/departments/{id}/     — partial update
        DELETE /api/v1/auth/departments/{id}/     — delete department
    """
    
    queryset = Department.objects.filter(is_active=True).order_by('name')
    serializer_class = DepartmentSerializer
    permission_classes = [IsAuthenticated, IsCMSAdmin]
    
    def get_queryset(self):
        """Return only active departments."""
        return super().get_queryset().filter(is_active=True)

    def perform_create(self, serializer):
        company = None
        if hasattr(self.request.user, 'employee_profile') and self.request.user.employee_profile:
            company = self.request.user.employee_profile.company

        if company is None and self.request.auth:
            company_id = self.request.auth.get('company_id')
            if company_id:
                company = Company.objects.filter(id=company_id).first()

        if company is None:
            company = Company.objects.filter(is_active=True).first()

        if company is None:
            company, _created = Company.objects.get_or_create(
                code='CANTEENX',
                defaults={'name': 'Cafinity Default Company', 'is_active': True},
            )

        if company is None:
            raise ParseError("Unable to assign a company for the new department.")

        serializer.save(company=company)


class CompanyViewSet(ModelViewSet):
    """
    Company CRUD API.

    Endpoints:
        GET    /api/v1/auth/companies/          — list active companies
        POST   /api/v1/auth/companies/          — create company
        GET    /api/v1/auth/companies/{id}/     — retrieve company
        PUT    /api/v1/auth/companies/{id}/     — full update
        PATCH  /api/v1/auth/companies/{id}/     — partial update
        DELETE /api/v1/auth/companies/{id}/     — deactivate company
    """

    queryset = Company.objects.order_by('name')
    serializer_class = CompanySerializer
    permission_classes = [IsAuthenticated, IsCMSAdmin]

    def get_queryset(self):
        return super().get_queryset().filter(is_active=True)

    def perform_destroy(self, instance):
        # Safer than hard delete because companies are referenced by many records.
        instance.is_active = False
        instance.save(update_fields=['is_active', 'updated_at'])

