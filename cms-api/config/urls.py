# Cafinity Security Fix — VAPT June 2026 — Secure admin routing + JSON error handlers
from django.contrib import admin
from django.conf import settings
from django.http import HttpResponseNotFound, JsonResponse
from django.urls import path, include

from apps.core.honeypot import admin_honeypot_view
from apps.cms.views.device_auth import device_login_view


def root_api_info(_request):
    return JsonResponse(
        {
            "service": "cafinity-cms-api",
            "status": "ok",
            "available_prefixes": [
                "/auth/",
                "/api/v1/auth/",
                "/api/v1/cms/",
                "/api/v1/notifications/",
                "/api/v1/audit/",
            ],
        }
    )


def media_not_found(_request, path=''):
    return HttpResponseNotFound('Not found.')


admin_url = settings.ADMIN_URL
if not admin_url.endswith('/'):
    admin_url = f'{admin_url}/'

urlpatterns = [
    path("", root_api_info, name="root"),
    path('admin/', admin_honeypot_view),
    path('admin/<path:path>', admin_honeypot_view),
    path(admin_url, admin.site.urls),
    path('api/v1/cms/auth/device/', device_login_view, name='cms-device-login-alias'),
    path('api/v1/cms/auth/device-login/', device_login_view, name='cms-device-login-root'),
    path('auth/', include('apps.accounts.urls')),
    path('api/v1/auth/', include('apps.accounts.urls')),
    path('api/v1/cms/', include('apps.cms.urls')),
    path('api/v1/', include('apps.cms.urls')),
    path('api/v1/notifications/', include('apps.notifications.urls')),
    path('api/v1/audit/', include('apps.audit.urls')),
    path('audit/', include('apps.audit.urls')),
    path('media/', media_not_found, name='media-root'),
    path('media/<path:path>', media_not_found, name='media-path'),
]
