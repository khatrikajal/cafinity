"""
apps/cms/authentication.py

Custom JWT authentication that handles both:
  - Employee / Admin tokens  → have 'user_id' claim → resolved to accounts.User
  - Device tokens (Kitchen / Counter) → have 'device_user_id' + 'role_type' claim
    but NO 'user_id' → resolved to an anonymous-like request.user with role info

simplejwt's default JWTAuthentication raises AuthenticationFailed when user_id
is missing. This subclass intercepts that case and returns a DevicePrincipal
instead, which satisfies IsAuthenticated and lets our role-based permission
classes work normally.
"""

import logging

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

logger = logging.getLogger(__name__)


class DevicePrincipal:
    """
    Lightweight stand-in for request.user when the caller is a Kitchen or
    Counter device account.  Satisfies IsAuthenticated (is_authenticated=True)
    without touching the Django User table.
    """

    is_authenticated = True
    is_anonymous = False
    is_active = True

    def __init__(self, token_payload: dict):
        self.token_payload = token_payload
        self.id = token_payload.get('device_user_id')
        self.role = token_payload.get('role_type') or token_payload.get('role', '')
        self.display_name = token_payload.get('display_name', 'Device')
        self.canteen_id = token_payload.get('canteen_id')
        self.company_id = token_payload.get('company_id')

    # Django / DRF duck-typing requirements
    def __str__(self):
        return f"DevicePrincipal({self.role}:{self.display_name})"

    @property
    def pk(self):
        return self.id


class CanteenXJWTAuthentication(JWTAuthentication):
    """
    Drop-in replacement for JWTAuthentication.

    Behaviour:
      1. Validate the JWT signature and expiry (same as default).
      2. If the token has 'user_id' → look up accounts.User (same as default).
      3. If the token has 'device_user_id' but no 'user_id' → return a
         DevicePrincipal so device endpoints work without a User row.
      4. If neither claim is present → raise AuthenticationFailed.
    """

    def get_user(self, validated_token):
        # Device token path — no user_id claim
        # Use .payload directly — dict(token) iterates keys as integers, not strings
        payload = validated_token.payload
        if 'user_id' not in payload and 'device_user_id' in payload:
            return DevicePrincipal(payload)

        # Employee / Admin token path — delegate to simplejwt default
        user = super().get_user(validated_token)
        token_role = payload.get('role_type', '')

        # Lazy import avoids circular load with apps.common.auth_utils at startup.
        from apps.common.auth_utils import db_role_for_user

        db_role = db_role_for_user(user)

        if token_role != db_role:
            logger.warning(
                "JWT_ROLE_MISMATCH user_id=%s token_role=%s db_role=%s",
                getattr(user, 'id', None),
                token_role,
                db_role,
            )
            raise AuthenticationFailed(
                'Invalid authentication credentials.',
                code='role_mismatch',
            )

        return user
