# Cafinity Security Fix — VAPT June 2026 — Admin honeypot view
import logging

from django.conf import settings
from django.http import HttpResponseNotFound
from django.views.decorators.csrf import csrf_exempt

from apps.audit.models import AuditLog
from apps.audit.service import log_action

logger = logging.getLogger(__name__)


def _client_ip(request) -> str:
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR', '') or ''


@csrf_exempt
def admin_honeypot_view(request, path=''):
    if not getattr(settings, 'ADMIN_HONEYPOT', True):
        return HttpResponseNotFound()

    log_action(
        actor=None,
        action_category=AuditLog.ACTION_AUTH,
        action='admin_honeypot_access',
        request=request,
        metadata={
            'ip': _client_ip(request),
            'path': request.path,
            'method': request.method,
        },
        is_sensitive=True,
    )
    logger.warning(
        'ADMIN_HONEYPOT_HIT ip=%s path=%s method=%s',
        _client_ip(request),
        request.path,
        request.method,
    )
    return HttpResponseNotFound()
