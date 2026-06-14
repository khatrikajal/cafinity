# Cafinity rebrand — logo + favicon update
"""Reusable notification/email service for order status changes."""
from __future__ import annotations

import logging
import threading
from typing import Any

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone

from apps.cms.models.order import Order, OrderStatus
from apps.common.email_utils import send_templated_email
from apps.notifications.models import Notification

logger = logging.getLogger(__name__)

NOTIFY_STATUSES = frozenset({
    OrderStatus.PLACED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
    OrderStatus.EXPIRED,
})

STATUS_EMAIL_CONFIG: dict[str, dict[str, str]] = {
    OrderStatus.PLACED: {
        "template": "emails/order_placed.html",
        "subject": "Order placed - {code}",
        "email_title": "Order Placed Successfully",
        "message": "Your food order {code} has been placed successfully.",
        "status_title": "Placed",
    },
    OrderStatus.PREPARING: {
        "template": "emails/order_preparing.html",
        "subject": "Order being prepared - {code}",
        "email_title": "Order Is Being Prepared",
        "message": "Your food order {code} is currently being prepared.",
        "status_title": "Preparing",
    },
    OrderStatus.READY: {
        "template": "emails/order_ready.html",
        "subject": "Order ready for collection - {code}",
        "email_title": "Order Ready for Collection",
        "message": "Your food order {code} is ready for collection.",
        "status_title": "Ready for Collection",
    },
    OrderStatus.DELIVERED: {
        "template": "emails/order_delivered.html",
        "subject": "Order delivered - {code}",
        "email_title": "Food Application Status Updated",
        "message": "Your food order {code} has been delivered.",
        "status_title": "Delivered",
    },
    OrderStatus.CANCELLED: {
        "template": "emails/order_cancelled.html",
        "subject": "Order cancelled - {code}",
        "email_title": "Order Cancelled",
        "message": "Your food order {code} has been cancelled.",
        "status_title": "Cancelled",
    },
    OrderStatus.EXPIRED: {
        "template": "emails/order_cancelled.html",
        "subject": "Order expired - {code}",
        "email_title": "Order Expired",
        "message": "Your food order {code} has expired.",
        "status_title": "Expired",
    },
}


def _resolve_employee_email(employee) -> str | None:
    if employee is None:
        return None
    email = getattr(employee, "email", None)
    if email:
        return email
    user = getattr(employee, "user", None)
    return getattr(user, "email", None) if user else None


def _load_order(order_id) -> Order | None:
    return (
        Order.objects
        .select_related("employee", "employee__user")
        .prefetch_related("items")
        .filter(pk=order_id)
        .first()
    )


def _build_email_context(order: Order, config: dict[str, str]) -> dict[str, Any]:
    employee = order.employee
    message = config["message"].format(code=order.order_code)
    return {
        "email_title": config["email_title"],
        "recipient_name": getattr(employee, "full_name", None) or "User",
        "order": order,
        "employee": employee,
        "items": list(order.items.all()),
        "ordered_at": order.placed_at,
        "status": order.status,
        "status_title": config["status_title"],
        "cta_label": "Log In",
        "text_body": message,
    }


def _send_email(subject: str, to_email: str, template: str, context: dict[str, Any]) -> None:
    text_body = context.get("text_body") or ""
    send_templated_email(
        subject=subject,
        to_email=to_email,
        template=template,
        context=context,
        text_body=text_body,
    )


def _send_order_email_sync(order: Order, new_status: str) -> None:
    config = STATUS_EMAIL_CONFIG.get(new_status)
    if config is None:
        return

    employee = order.employee
    if employee is None:
        return

    email_to = _resolve_employee_email(employee)
    if not email_to:
        logger.info("Skipping order email for %s: employee has no email", order.order_code)
        return

    subject = config["subject"].format(code=order.order_code)
    context = _build_email_context(order, config)
    _send_email(subject, email_to, config["template"], context)


def _send_order_email_task(order_id, new_status: str) -> None:
    close_old_connections()
    try:
        order = _load_order(order_id)
        if order is None:
            logger.warning("Order %s not found for email notification", order_id)
            return
        _send_order_email_sync(order, new_status)
    except Exception:
        logger.exception("Unable to send order email for order %s (%s)", order_id, new_status)
    finally:
        close_old_connections()


def _send_email_in_background(order_id, new_status: str) -> None:
    thread = threading.Thread(
        target=_send_order_email_task,
        args=(order_id, new_status),
        daemon=True,
    )
    thread.start()


def _dispatch_order_email(order_id, new_status: str) -> None:
    """Send after the DB transaction commits so the order row is persisted."""

    def send_after_commit() -> None:
        if getattr(settings, "ORDER_EMAIL_ASYNC", False):
            _send_email_in_background(order_id, new_status)
            return
        _send_order_email_task(order_id, new_status)

    transaction.on_commit(send_after_commit)


def _create_in_app_notification(order: Order, new_status: str, config: dict[str, str]) -> None:
    employee = order.employee
    if employee is None:
        return

    subject = config["subject"].format(code=order.order_code)
    message = config["message"].format(code=order.order_code)
    try:
        with transaction.atomic():
            Notification.objects.create(
                recipient=employee,
                related_order=order,
                notification_type=Notification.TYPE_ORDER,
                title=subject,
                body=message,
                is_read=False,
                created_at=timezone.now(),
            )
    except Exception:
        logger.exception("Unable to create in-app notification for order %s", order.order_code)


def notify_order_status(order, new_status: str) -> None:
    """Create in-app notification and send email for supported order statuses."""
    if new_status not in NOTIFY_STATUSES:
        return

    config = STATUS_EMAIL_CONFIG.get(new_status)
    if config is None:
        return

    employee = getattr(order, "employee", None)
    if employee is None:
        return

    _create_in_app_notification(order, new_status, config)

    email_to = _resolve_employee_email(employee)
    if not email_to:
        return

    order_id = order.pk
    _dispatch_order_email(order_id, new_status)
