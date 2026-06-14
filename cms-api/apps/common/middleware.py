"""
apps/common/middleware.py

TenantContextMiddleware
-----------------------
Extracts company_id from the validated JWT and attaches it to the request
as request.tenant_company_id.

All CMS querysets filter by this value via a custom model manager so no
view or service class ever manually adds .filter(company_id=...).

How it works:
    1. Reads the Authorization header.
    2. Decodes the JWT WITHOUT verifying the signature (verification is
       done by DRF's JWTAuthentication on each API view).
    3. Pulls company_id and role_type from the payload.
    4. Sets request.tenant_company_id and request.tenant_role.
"""

import logging
from django.conf import settings
from django.http import JsonResponse
from rest_framework_simplejwt.tokens import AccessToken, TokenError
from django_tenants.middleware.main import TenantMainMiddleware
from django_tenants.utils import get_tenant_model, get_tenant_domain_model



logger = logging.getLogger(__name__)

_BEARER_PREFIX = 'Bearer '


class SecureApiErrorMiddleware:
    """Keep internal exception details and implementation headers out of API responses."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.headers.pop('Server', None)
        response.headers.pop('X-Powered-By', None)
        return response

    def process_exception(self, request, exception):
        if settings.DEBUG or not request.path.startswith('/api/'):
            return None

        logger.exception("UNHANDLED_API_ERROR path=%s", request.path, exc_info=exception)
        return JsonResponse(
            {'detail': 'An internal error occurred.'},
            status=500,
        )


class TenantContextMiddleware:
    """
    Lightweight middleware that attaches tenant context to every request.
    Does NOT hit the database.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        self._attach_tenant_context(request)
        return self.get_response(request)

    @staticmethod
    def _attach_tenant_context(request):
        """
        Decode the JWT (no signature check) and populate:
            request.tenant_company_id  : str | None
            request.tenant_role        : str | None  (role_type claim)
        """
        request.tenant_company_id = None
        request.tenant_role       = None

        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith(_BEARER_PREFIX):
            return

        raw_token = auth_header[len(_BEARER_PREFIX):].strip()
        if not raw_token:
            return

        try:
            # Decode without full verification — claims only
            token = AccessToken(raw_token, verify=False)
            request.tenant_company_id = token.get('company_id')
            request.tenant_role       = token.get('role_type') or token.get('role')
        except (TokenError, Exception):
            # Malformed token — leave context as None.
            # DRF authentication will reject it properly.
            pass


