# Cafinity Security Fix — VAPT June 2026 — Notification access control
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdminLimitedAdminOrEmployee
from apps.notifications.models import Notification


def _current_employee(request):
    auth = getattr(request, "auth", None)
    employee_id = auth.get("employee_id") if auth else None
    if employee_id:
        return employee_id

    employee = getattr(request.user, "employee_profile", None)
    return getattr(employee, "id", None)


def _notification_payload(notification):
    return {
        "id": str(notification.id),
        "type": notification.notification_type,
        "kind": notification.notification_type,
        "title": notification.title,
        "body": notification.body,
        "message": notification.body,
        "is_read": notification.is_read,
        "read": notification.is_read,
        "created_at": notification.created_at.isoformat(),
        "related_order_id": str(notification.related_order_id) if notification.related_order_id else None,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdminLimitedAdminOrEmployee])
def notification_list_view(request):
    """GET /api/v1/notifications/ - list notifications for the current employee."""
    employee_id = _current_employee(request)
    if not employee_id:
        return Response([], status=status.HTTP_200_OK)

    qs = Notification.objects.filter(recipient_id=employee_id)
    unread_count = qs.filter(is_read=False).count()
    items = [_notification_payload(notification) for notification in qs.order_by("-created_at")[:100]]

    response = Response(items, status=status.HTTP_200_OK)
    response["X-Unread-Count"] = str(unread_count)
    return response


@api_view(["PATCH"])
@permission_classes([IsAuthenticated, IsAdminLimitedAdminOrEmployee])
def notification_mark_read_view(request, notification_id):
    """PATCH /api/v1/notifications/{id}/read/ - mark one notification as read."""
    employee_id = _current_employee(request)
    if not employee_id:
        return Response({"detail": "Employee profile not found."}, status=status.HTTP_404_NOT_FOUND)

    notification = Notification.objects.filter(id=notification_id, recipient_id=employee_id).first()
    if notification is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    notification.is_read = True
    notification.read_at = timezone.now()
    notification.save(update_fields=["is_read", "read_at"])
    return Response(_notification_payload(notification), status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdminLimitedAdminOrEmployee])
def notification_mark_all_read_view(request):
    employee_id = _current_employee(request)
    if not employee_id:
        return Response({"detail": "Employee profile not found."}, status=status.HTTP_404_NOT_FOUND)

    Notification.objects.filter(recipient_id=employee_id, is_read=False).update(
        is_read=True,
        read_at=timezone.now(),
    )
    return Response({"detail": "Notifications marked as read."}, status=status.HTTP_200_OK)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated, IsAdminLimitedAdminOrEmployee])
def notification_delete_view(request, notification_id):
    employee_id = _current_employee(request)
    if not employee_id:
        return Response({"detail": "Employee profile not found."}, status=status.HTTP_404_NOT_FOUND)

    deleted, _ = Notification.objects.filter(id=notification_id, recipient_id=employee_id).delete()
    if not deleted:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(status=status.HTTP_204_NO_CONTENT)
