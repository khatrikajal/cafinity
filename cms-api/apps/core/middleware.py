# Cafinity Security Fix — VAPT June 2026 — Admin IP whitelist middleware
# Cafinity Security Fix Round 2 — VAPT June 2026 — Security response headers
import logging

from django.conf import settings
from django.http import HttpResponseForbidden

logger = logging.getLogger(__name__)


def _client_ip(request) -> str:
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '') or ''


class HideServerHeaderMiddleware:
    """Replace the Server header to avoid disclosing gunicorn version."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response['Server'] = 'Cafinity'
        return response


class AdminIPWhitelistMiddleware:
    """Restrict Django admin URLs to configured IP addresses."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.admin_prefix = self._normalize_prefix(getattr(settings, 'ADMIN_URL', 'admin/'))

    @staticmethod
    def _normalize_prefix(value: str) -> str:
        prefix = (value or 'admin/').strip()
        if not prefix.startswith('/'):
            prefix = f'/{prefix}'
        if not prefix.endswith('/'):
            prefix = f'{prefix}/'
        return prefix

    def __call__(self, request):
        path = request.path or ''
        if path.startswith(self.admin_prefix) or path == self.admin_prefix.rstrip('/'):
            allowed_ips = getattr(settings, 'ADMIN_ALLOWED_IPS', ['127.0.0.1'])
            client_ip = _client_ip(request)
            if client_ip not in allowed_ips:
                logger.warning(
                    'ADMIN_IP_BLOCKED ip=%s path=%s allowed=%s',
                    client_ip,
                    path,
                    allowed_ips,
                )
                return HttpResponseForbidden('Access denied')
        return self.get_response(request)


class PermissionsPolicyMiddleware:
    """Add Permissions-Policy header on every response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response['Permissions-Policy'] = (
            'geolocation=(), microphone=(), camera=(), '
            'payment=(), usb=(), magnetometer=(), gyroscope=()'
        )
        return response


class ApiCacheControlMiddleware:
    """Prevent cached API responses after logout."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        path = request.path or ''
        if path.startswith('/api/'):
            response['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
            response['Pragma'] = 'no-cache'
        return response


class InactivityTimeoutMiddleware:
    """Force re-login when a JWT session has been inactive for 15 minutes."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ''
        if path.startswith('/api/') and not self._is_public_auth_path(path):
            inactive_response = self._check_inactivity(request)
            if inactive_response is not None:
                return inactive_response

        response = self.get_response(request)
        self._touch_session(request)
        return response

    @staticmethod
    def _is_public_auth_path(path: str) -> bool:
        public_prefixes = (
            '/api/v1/auth/login/',
            '/api/v1/auth/otp/',
            '/api/v1/auth/forgot-password/',
            '/api/v1/auth/reset-password/',
            '/api/v1/auth/password-reset/',
            '/api/v1/auth/set-password/',
            '/api/v1/auth/refresh/',
            '/api/v1/cms/auth/device-login/',
            '/api/v1/cms/auth/device/',
        )
        return any(path.startswith(prefix) for prefix in public_prefixes)

    def _check_inactivity(self, request):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.lower().startswith('bearer '):
            return None

        token = auth_header[7:].strip()
        if not token:
            return None

        try:
            from rest_framework_simplejwt.tokens import AccessToken
            from apps.accounts.session_service import check_session_inactivity, touch_session

            access = AccessToken(token)
            user_id = access.get('user_id')
            token_suffix = str(access)[-8:]
            if not user_id:
                return None

            if check_session_inactivity(str(user_id), token_suffix):
                from django.http import JsonResponse
                return JsonResponse(
                    {
                        'error': 'Session expired due to inactivity.',
                        'code': 'session_inactive',
                    },
                    status=401,
                )

            touch_session(str(user_id), token_suffix)
        except Exception:
            logger.debug('Inactivity middleware skipped token', exc_info=True)
        return None

    def _touch_session(self, request):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.lower().startswith('bearer '):
            return
        token = auth_header[7:].strip()
        try:
            from rest_framework_simplejwt.tokens import AccessToken
            from apps.accounts.session_service import touch_session

            access = AccessToken(token)
            user_id = access.get('user_id')
            if user_id:
                touch_session(str(user_id), str(access)[-8:])
        except Exception:
            return
