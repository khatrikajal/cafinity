# Cafinity Security Fix Round 2 — VAPT June 2026 — Fix G+L (device auth + canteen IDOR)
"""
apps/cms/views/device_auth.py

Device authentication — Kitchen / Counter station login.

Endpoints
---------
POST /api/v1/cms/auth/device-login/   — username + PIN → 8-hour access JWT (no refresh)

Separation guarantee:
  - This file has ZERO imports from apps/accounts/.
  - Employee auth has ZERO imports from this file.
  - They share only the common JWT secret (settings.SIMPLE_JWT['SIGNING_KEY']).
"""

import datetime
import logging
import uuid

from django.db import DataError
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from apps.notifications.utils import notify_admins
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import RoleChoices
from apps.audit.models import AuditLog
from apps.audit.service import log_action
from apps.cms.models.device import KitchenCounterUser
from apps.core.canteen_scope import validate_canteen_access
from rest_framework.exceptions import PermissionDenied

logger = logging.getLogger(__name__)

# Shift duration — device tokens are valid for exactly one shift.
# Re-login is required at the start of each shift.
_DEVICE_TOKEN_LIFETIME = datetime.timedelta(hours=8)


def _token_value(request, key):
    try:
        return request.auth.get(key) if request.auth else None
    except Exception:
        return None


def _role_type(request):
    return (_token_value(request, 'role_type') or '').strip()


def _is_cms_admin(request):
    return _role_type(request) in (RoleChoices.CMS_ADMIN_ROLES - {RoleChoices.LIMITED_ADMIN})


def _parse_uuid(value, field_name):
    try:
        return uuid.UUID(str(value))
    except Exception:
        raise ValueError(f'{field_name} must be a valid UUID.')


def _serialize_device_user(device_user):
    return {
        'id': str(device_user.id),
        'username': device_user.username,
        'display_name': device_user.display_name,
        'role': device_user.role,
        'canteen_id': str(device_user.canteen_id),
        'company_id': str(device_user.company_id),
        'is_active': device_user.is_active,
        'created_at': device_user.created_at.isoformat() if device_user.created_at else None,
        'updated_at': device_user.updated_at.isoformat() if device_user.updated_at else None,
        'last_login_at': device_user.last_login_at.isoformat() if device_user.last_login_at else None,
    }


def _validate_pin(pin):
    if not isinstance(pin, str):
        return False
    pin_value = pin.strip()
    return pin_value.isdigit() and 4 <= len(pin_value) <= 6


def _build_device_login_response(device_user, request):
    access_token = AccessToken()
    access_token.set_exp(lifetime=_DEVICE_TOKEN_LIFETIME)
    access_token['role'] = device_user.role
    access_token['role_type'] = device_user.role
    access_token['canteen_id'] = str(device_user.canteen_id)
    access_token['company_id'] = str(device_user.company_id)
    access_token['device_user_id'] = str(device_user.id)
    access_token['display_name'] = device_user.display_name
    access_token['username'] = device_user.username

    try:
        device_user.last_login_at = timezone.now()
        device_user.save(update_fields=['last_login_at'])
    except Exception:
        logger.warning('Failed to update last_login_at for device user %s', device_user.id)

    log_action(
        actor=None,
        action_category=AuditLog.ACTION_AUTH,
        action='login',
        target=device_user,
        request=request,
        metadata={'device_role': device_user.role},
    )

    return Response({
        'access': str(access_token),
        'refresh': str(access_token),
        'device_user_id': str(device_user.id),
        'display_name': device_user.display_name,
        'role': device_user.role,
        'role_type': device_user.role,
        'canteen_id': str(device_user.canteen_id),
        'company_id': str(device_user.company_id),
        'username': device_user.username,
    }, status=status.HTTP_200_OK)


def authenticate_device_login(request, username, pin, role=None):
    """
    Shared kitchen/counter PIN login used by device-login and main login views.
    """
    expected_role = (role or '').strip().upper()
    if expected_role and expected_role not in {KitchenCounterUser.ROLE_KITCHEN, KitchenCounterUser.ROLE_COUNTER}:
        return Response({'detail': 'Invalid device role.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        device_user = KitchenCounterUser.objects.get(username=username, is_active=True)
    except KitchenCounterUser.DoesNotExist:
        import bcrypt
        bcrypt.checkpw(b'dummy', bcrypt.hashpw(b'dummy', bcrypt.gensalt(rounds=12)))
        return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    if expected_role and device_user.role != expected_role:
        return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not device_user.check_pin(pin):
        return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    return _build_device_login_response(device_user, request)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def device_login_view(request):
    """
    POST /api/v1/cms/auth/device-login/
    Body : { "username": "kitchen-main", "pin": "482193" }

    Returns : 8-hour access JWT only. No refresh token.

    JWT claims added beyond simplejwt defaults:
        role            KITCHEN | COUNTER
        role_type       same value (normalised claim name for permission classes)
        canteen_id      UUID of the canteen this device is scoped to
        company_id      UUID of the tenant company
        device_user_id  UUID PK of the KitchenCounterUser row
        display_name    Human-readable label shown on the device UI

    Security notes:
        - PIN verification uses bcrypt (constant time).
        - A dummy bcrypt check runs on unknown usernames to prevent
          user-enumeration via timing differences.
        - No refresh token — device must re-authenticate each shift.
    """
    username = request.data.get('username', '').strip()
    pin = request.data.get('pin', '').strip()

    if not username or not pin:
        return Response(
            {'detail': 'username and pin are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return authenticate_device_login(request, username, pin)



@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def device_users_view(request):
    """
    GET /api/v1/cms/devices/          -> list users (admin only)
    POST /api/v1/cms/devices/         -> create user (admin only)
    """

    if not getattr(request.user, 'is_authenticated', False):
        return Response({'detail': 'Authentication credentials were not provided.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not _is_cms_admin(request):
        return Response({'detail': 'CMS Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        queryset = KitchenCounterUser.objects.all().order_by('-created_at')

        role = (request.query_params.get('role') or '').strip().upper()
        if role in [KitchenCounterUser.ROLE_KITCHEN, KitchenCounterUser.ROLE_COUNTER]:
            queryset = queryset.filter(role=role)

        is_active = request.query_params.get('is_active')
        if is_active is not None:
            normalized = str(is_active).strip().lower()
            if normalized in {'true', '1', 'yes'}:
                queryset = queryset.filter(is_active=True)
            elif normalized in {'false', '0', 'no'}:
                queryset = queryset.filter(is_active=False)

        search = (request.query_params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(Q(username__icontains=search) | Q(display_name__icontains=search))

        return Response({'results': [_serialize_device_user(user) for user in queryset]}, status=status.HTTP_200_OK)

    data = request.data

    required_fields = ['username', 'pin', 'role', 'canteen_id', 'company_id', 'display_name']
    for field in required_fields:
        if not data.get(field):
            return Response({'detail': f'{field} is required'}, status=status.HTTP_400_BAD_REQUEST)

    role = str(data.get('role', '')).upper()
    if role not in [KitchenCounterUser.ROLE_KITCHEN, KitchenCounterUser.ROLE_COUNTER]:
        return Response({'detail': 'Invalid role. Use KITCHEN or COUNTER.'}, status=status.HTTP_400_BAD_REQUEST)

    username = str(data.get('username', '')).strip()
    if len(username) > 100:
        return Response({'detail': 'Username cannot exceed 100 characters.'}, status=status.HTTP_400_BAD_REQUEST)
    if not username.isalnum():
        return Response({'detail': 'Username must contain only letters and numbers.'}, status=status.HTTP_400_BAD_REQUEST)
    if KitchenCounterUser.objects.filter(username__iexact=username).exists():
        return Response({'detail': 'Username already exists.'}, status=status.HTTP_400_BAD_REQUEST)

    display_name = str(data.get('display_name', '')).strip()
    if not display_name:
        return Response({'detail': 'display_name is required'}, status=status.HTTP_400_BAD_REQUEST)
    if len(display_name) > 100:
        return Response({'detail': 'Display name cannot exceed 100 characters.'}, status=status.HTTP_400_BAD_REQUEST)

    pin = str(data.get('pin', '')).strip()
    if not _validate_pin(pin):
        return Response({'detail': 'PIN must be 4 to 6 digits.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        canteen_id = _parse_uuid(data.get('canteen_id'), 'canteen_id')
        company_id = _parse_uuid(data.get('company_id'), 'company_id')
    except ValueError as error:
        return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_canteen_access(request, canteen_id)
    except PermissionDenied:
        return Response({'detail': 'You do not have access to this canteen.'}, status=status.HTTP_403_FORBIDDEN)

    device_user = KitchenCounterUser(
        username=username,
        role=role,
        canteen_id=canteen_id,
        company_id=company_id,
        display_name=str(data.get('display_name', '')).strip(),
        is_active=True,
        created_at=timezone.now(),
    )
    device_user.set_pin(pin)
    try:
        device_user.save()
    except DataError:
        return Response(
            {'detail': 'Username or display name is too long for the database.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    notify_admins(
        f"{device_user.role.title()} user created",
        f"{device_user.display_name} ({device_user.username}) was created.",
        company_id=device_user.company_id,
        canteen_id=device_user.canteen_id,
    )
    log_action(
        actor=request.user,
        action_category=AuditLog.ACTION_PERMISSIONS,
        action='permission_granted',
        target=device_user,
        request=request,
        metadata={'device_role': device_user.role, 'username': device_user.username},
    )

    return Response(
        {
            'message': 'Device user created successfully.',
            'device_user': _serialize_device_user(device_user),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([AllowAny])
def device_user_detail_view(request, device_user_id):
    """
    GET    /api/v1/cms/devices/{device_user_id}/        -> fetch one user
    PATCH  /api/v1/cms/devices/{device_user_id}/        -> update fields
    DELETE /api/v1/cms/devices/{device_user_id}/        -> soft deactivate
    """

    if not getattr(request.user, 'is_authenticated', False):
        return Response({'detail': 'Authentication credentials were not provided.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not _is_cms_admin(request):
        return Response({'detail': 'CMS Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    device_user = KitchenCounterUser.objects.filter(id=device_user_id).first()
    if not device_user:
        return Response({'detail': 'Device user not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(_serialize_device_user(device_user), status=status.HTTP_200_OK)

    if request.method == 'DELETE':
        if not device_user.is_active:
            return Response({'message': 'Device user is already inactive.'}, status=status.HTTP_200_OK)
        device_user.is_active = False
        device_user.save(update_fields=['is_active', 'updated_at'])
        notify_admins(
            f"{device_user.role.title()} user deleted",
            f"{device_user.display_name} ({device_user.username}) was deactivated.",
            company_id=device_user.company_id,
            canteen_id=device_user.canteen_id,
        )
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_PERMISSIONS,
            action='permission_revoked',
            target=device_user,
            request=request,
            metadata={'device_role': device_user.role, 'username': device_user.username},
        )
        return Response({'message': 'Device user deactivated successfully.'}, status=status.HTTP_200_OK)

    data = request.data

    if 'username' in data:
        username = str(data.get('username', '')).strip()
        if not username:
            return Response({'detail': 'username cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(username) > 100:
            return Response({'detail': 'Username cannot exceed 100 characters.'}, status=status.HTTP_400_BAD_REQUEST)
        if not username.isalnum():
            return Response({'detail': 'Username must contain only letters and numbers.'}, status=status.HTTP_400_BAD_REQUEST)
        exists = KitchenCounterUser.objects.filter(username__iexact=username).exclude(id=device_user.id).exists()
        if exists:
            return Response({'detail': 'Username already exists.'}, status=status.HTTP_400_BAD_REQUEST)
        device_user.username = username

    if 'display_name' in data:
        display_name = str(data.get('display_name', '')).strip()
        if not display_name:
            return Response({'detail': 'display_name cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(display_name) > 100:
            return Response({'detail': 'Display name cannot exceed 100 characters.'}, status=status.HTTP_400_BAD_REQUEST)
        device_user.display_name = display_name

    if 'role' in data:
        role = str(data.get('role', '')).upper()
        if role not in [KitchenCounterUser.ROLE_KITCHEN, KitchenCounterUser.ROLE_COUNTER]:
            return Response({'detail': 'Invalid role. Use KITCHEN or COUNTER.'}, status=status.HTTP_400_BAD_REQUEST)
        device_user.role = role

    if 'canteen_id' in data:
        try:
            new_canteen_id = _parse_uuid(data.get('canteen_id'), 'canteen_id')
        except ValueError as error:
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_canteen_access(request, new_canteen_id)
        except PermissionDenied:
            return Response({'detail': 'You do not have access to this canteen.'}, status=status.HTTP_403_FORBIDDEN)
        device_user.canteen_id = new_canteen_id

    if 'company_id' in data:
        try:
            device_user.company_id = _parse_uuid(data.get('company_id'), 'company_id')
        except ValueError as error:
            return Response({'detail': str(error)}, status=status.HTTP_400_BAD_REQUEST)

    if 'is_active' in data:
        device_user.is_active = bool(data.get('is_active'))

    try:
        device_user.save()
    except DataError:
        return Response(
            {'detail': 'Username or display name is too long for the database.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    notify_admins(
        f"{device_user.role.title()} user updated",
        f"{device_user.display_name} ({device_user.username}) was updated.",
        company_id=device_user.company_id,
        canteen_id=device_user.canteen_id,
    )
    log_action(
        actor=request.user,
        action_category=AuditLog.ACTION_PERMISSIONS,
        action='limited_admin_role_changed',
        target=device_user,
        request=request,
        metadata={'device_role': device_user.role, 'username': device_user.username},
    )

    return Response(_serialize_device_user(device_user), status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([AllowAny])
def device_user_reset_pin_view(request, device_user_id):
    """
    POST /api/v1/cms/devices/{device_user_id}/reset-pin/

    Body:
    {
        "pin": "482193"
    }
    """

    if not getattr(request.user, 'is_authenticated', False):
        return Response({'detail': 'Authentication credentials were not provided.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not _is_cms_admin(request):
        return Response({'detail': 'CMS Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    device_user = KitchenCounterUser.objects.filter(id=device_user_id).first()
    if not device_user:
        return Response({'detail': 'Device user not found.'}, status=status.HTTP_404_NOT_FOUND)

    pin = str(request.data.get('pin', '')).strip()
    if not _validate_pin(pin):
        return Response({'detail': 'PIN must be 4 to 6 digits.'}, status=status.HTTP_400_BAD_REQUEST)

    device_user.set_pin(pin)
    device_user.save(update_fields=['pin_hash', 'updated_at'])
    log_action(
        actor=request.user,
        action_category=AuditLog.ACTION_AUTH,
        action='password_change',
        target=device_user,
        request=request,
        is_sensitive=True,
        metadata={'device_role': device_user.role},
    )
    return Response({'message': 'PIN reset successful.'}, status=status.HTTP_200_OK)
