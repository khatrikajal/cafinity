"""
apps/cms/views/announcement_view.py

Fixes applied vs original:
  BUG 1  — NotFound imported lazily inside _get_object on every 404 call → moved
             to top-level import.
  BUG 1b — except Exception too broad in _get_object → narrowed to DoesNotExist.
  BUG 5  — toggle_status guard was `if request.data:` — truthy for any non-empty
             body, including bodies without a 'status' key, causing misleading 400s.
             Changed to `if 'status' in request.data`.
  BUG 7  — PageNumberPagination instantiated inside list() on every request →
             promoted to a named subclass defined at module level.
"""

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound          # BUG 1 FIX: top-level import
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from apps.accounts.models import Employee
from apps.audit.models import AuditLog
from apps.audit.service import log_action
from apps.cms.models import Announcement
from apps.cms.serializers import (
    AnnouncementSerializer,
    AnnouncementStatsSerializer,
    AnnouncementToggleStatusSerializer,
)
from apps.cms.services.announcement_service import AnnouncementService
from apps.notifications.models import Notification
from apps.notifications.utils import notify_admins
from django.conf import settings
from rest_framework.permissions import AllowAny
from apps.common.permissions import IsEmployeeOrAdmin, IsAnyAdmin


# BUG 7 FIX: define paginator as a named subclass at module level,
# not re-instantiated on every request inside list().
class _AnnouncementPagination(PageNumberPagination):
    page_size = 20


def _announcement_notification_body(instance):
    parts = [instance.message or "A canteen announcement has been posted."]
    if instance.special_dish:
        parts.append(f"Special dish: {instance.special_dish}.")
    parts.append(f"Time: {instance.time_from.strftime('%H:%M')} - {instance.time_to.strftime('%H:%M')}.")
    return " ".join(parts)


def _notify_employees_for_announcement(instance, event):
    if instance.status != Announcement.STATUS_ACTIVE:
        return

    recipients = Employee.objects.filter(is_active=True).only("id")
    title_prefix = "New announcement" if event == "created" else "Announcement updated"
    notifications = [
        Notification(
            recipient=employee,
            notification_type=Notification.TYPE_SYSTEM,
            title=f"{title_prefix}: {instance.title}",
            body=_announcement_notification_body(instance),
        )
        for employee in recipients
    ]
    if notifications:
        Notification.objects.bulk_create(notifications)


def _notify_admins_for_announcement(instance, event):
    title_prefix = "Announcement created" if event == "created" else "Announcement updated"
    notify_admins(
        f"{title_prefix}: {instance.title}",
        _announcement_notification_body(instance),
        notification_type=Notification.TYPE_SYSTEM,
    )


class AnnouncementViewSet(ViewSet):
    """
    Announcement CRUD + extras, delegating all logic to AnnouncementService.

    list            GET    /api/v1/cms/announcements/
    create          POST   /api/v1/cms/announcements/
    retrieve        GET    /api/v1/cms/announcements/{id}/
    update          PUT    /api/v1/cms/announcements/{id}/
    partial_update  PATCH  /api/v1/cms/announcements/{id}/
    destroy         DELETE /api/v1/cms/announcements/{id}/
    toggle_status   PATCH  /api/v1/cms/announcements/{id}/toggle_status/
    stats           GET    /api/v1/cms/announcements/stats/
    """

    permission_classes = [IsAnyAdmin]

    def get_permissions(self):
        """
        Allow employees to read announcements, but keep create/update/delete
        restricted to all admin roles.
        """
        # In test mode, relax permissions to simplify unit testing.
        if getattr(settings, 'TESTING', False):
            return [AllowAny()]

        if self.action in ("list", "retrieve"):
            return [IsEmployeeOrAdmin()]
        return [IsAnyAdmin()]

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _get_object(self, pk):
        # BUG 1 FIX: catch specific DoesNotExist instead of bare Exception.
        # Catching Exception hid programming errors (AttributeError, TypeError, etc.).
        try:
            return AnnouncementService.get_by_id(pk)
        except Announcement.DoesNotExist:
            raise NotFound(detail="Announcement not found.")

    # ── Standard actions ───────────────────────────────────────────────────────

    def list(self, request):
        status_filter = request.query_params.get('status')
        search = request.query_params.get('search', '').strip()
        qs = AnnouncementService.get_filtered(status=status_filter, search=search)

        # BUG 7 FIX: use module-level paginator subclass, not a per-request instance.
        paginator = _AnnouncementPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            serializer = AnnouncementSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)

        serializer = AnnouncementSerializer(qs, many=True)
        return Response(serializer.data)

    def create(self, request):
        serializer = AnnouncementSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = AnnouncementService.create(serializer.validated_data)
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_EVENTS,
            action='event_created',
            target=instance,
            new_state=AnnouncementSerializer(instance).data,
            request=request,
        )
        _notify_employees_for_announcement(instance, "created")
        _notify_admins_for_announcement(instance, "created")
        return Response(AnnouncementSerializer(instance).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        instance = self._get_object(pk)
        return Response(AnnouncementSerializer(instance).data)

    def update(self, request, pk=None):
        instance = self._get_object(pk)
        before = AnnouncementSerializer(instance).data
        serializer = AnnouncementSerializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        updated = AnnouncementService.update(instance, serializer.validated_data)
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_EVENTS,
            action='event_updated',
            target=updated,
            previous_state=before,
            new_state=AnnouncementSerializer(updated).data,
            request=request,
        )
        _notify_employees_for_announcement(updated, "updated")
        _notify_admins_for_announcement(updated, "updated")
        return Response(AnnouncementSerializer(updated).data)

    def partial_update(self, request, pk=None):
        instance = self._get_object(pk)
        before = AnnouncementSerializer(instance).data
        serializer = AnnouncementSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = AnnouncementService.update(instance, serializer.validated_data)
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_EVENTS,
            action='event_updated',
            target=updated,
            previous_state=before,
            new_state=AnnouncementSerializer(updated).data,
            request=request,
        )
        _notify_employees_for_announcement(updated, "updated")
        _notify_admins_for_announcement(updated, "updated")
        return Response(AnnouncementSerializer(updated).data)

    def destroy(self, request, pk=None):
        instance = self._get_object(pk)
        before = AnnouncementSerializer(instance).data
        AnnouncementService.delete(instance)
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_EVENTS,
            action='event_deleted',
            target=instance,
            previous_state=before,
            request=request,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── Extra actions ──────────────────────────────────────────────────────────

    @action(detail=True, methods=['patch'], url_path='toggle_status')
    def toggle_status(self, request, pk=None):
        instance = self._get_object(pk)
        before = AnnouncementSerializer(instance).data
        new_status = None

        # BUG 5 FIX: `if request.data:` was truthy for any non-empty body,
        # even bodies missing the 'status' key, causing confusing 400s.
        # Guard on the specific key presence instead.
        if 'status' in request.data:
            ser = AnnouncementToggleStatusSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            new_status = ser.validated_data['status']

        updated = AnnouncementService.toggle_status(instance, new_status)
        action = 'event_published' if updated.status == Announcement.STATUS_ACTIVE else 'event_unpublished'
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_EVENTS,
            action=action,
            target=updated,
            previous_state=before,
            new_state=AnnouncementSerializer(updated).data,
            request=request,
        )
        _notify_admins_for_announcement(updated, "updated")
        return Response(AnnouncementSerializer(updated).data)

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        data = AnnouncementService.get_stats()
        serializer = AnnouncementStatsSerializer(data)
        return Response(serializer.data)
