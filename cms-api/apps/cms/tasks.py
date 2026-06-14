# Cafinity — Post-Cutoff Order Summary Email + Slot Order Summary Email
"""
Celery tasks for automated slot summary emails.
Falls back to direct invocation when Celery is not configured.
"""

import logging
import time
from datetime import datetime, time as time_cls, timedelta

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

logger = logging.getLogger(__name__)

try:
    from celery import shared_task
except ImportError:  # pragma: no cover
    def shared_task(*args, **kwargs):
        def decorator(func):
            return func
        return decorator


def _slot_cutoff_datetime(slot, on_date):
    """Return timezone-aware datetime when ordering closes for a slot."""
    cutoff_minutes = max(
        0,
        slot.start_time.hour * 60 + slot.start_time.minute - int(getattr(slot, 'buffer_minutes', 0) or 0),
    )
    hour, minute = divmod(cutoff_minutes, 60)
    naive = datetime.combine(on_date, time_cls(hour=hour, minute=minute))
    return timezone.make_aware(naive, timezone.get_current_timezone())


def _collect_admin_emails(canteen):
    from apps.accounts.models import Employee, RoleChoices, User

    emails = set()
    for admin in Employee.objects.filter(
        canteen_id=canteen.id,
        is_active=True,
        user__role_type__in={
            RoleChoices.LIMITED_ADMIN,
            RoleChoices.CANTEEN_ADMIN,
            RoleChoices.SUPER_ADMIN,
        },
    ).exclude(email=''):
        emails.add(admin.email.strip())

    super_admins = User.objects.filter(
        role_type=RoleChoices.SUPER_ADMIN,
        is_active=True,
    ).exclude(email='')
    for user in super_admins:
        emails.add(user.email.strip())

    for addr in getattr(settings, 'ADMIN_EMAIL', []) or []:
        if addr:
            emails.add(addr.strip())

    return [email for email in emails if email]


def _collect_kitchen_admin_emails(canteen):
    from apps.accounts.models import Employee, RoleChoices, User
    from apps.cms.models.device import KitchenCounterUser

    emails = set(_collect_admin_emails(canteen))

    kitchen_users = KitchenCounterUser.objects.filter(
        canteen_id=canteen.id,
        is_active=True,
        role=KitchenCounterUser.ROLE_KITCHEN,
    )
    for device in kitchen_users:
        if getattr(device, 'email', None):
            emails.add(device.email.strip())

    kitchen_employees = Employee.objects.filter(
        canteen_id=canteen.id,
        is_active=True,
        user__role_type=RoleChoices.CANTEEN_ADMIN,
    ).exclude(email='')
    for emp in kitchen_employees:
        emails.add(emp.email.strip())

    return [email for email in emails if email]


def _render_summary_table_html(items, include_delivered=False):
    if include_delivered:
        header = (
            '<tr><th>Menu Item</th><th>Total Orders</th>'
            '<th>Delivered</th><th>Pending</th></tr>'
        )
        rows = []
        for item in items:
            rows.append(
                f"<tr><td>{item['item_name']}</td>"
                f"<td>{item['total_ordered']}</td>"
                f"<td>{item['delivered']}</td>"
                f"<td>{item['pending']}</td></tr>"
            )
    else:
        header = '<tr><th>Menu Item</th><th>Total Orders</th></tr>'
        rows = [f"<tr><td>{item['item_name']}</td><td>{item['total_ordered']}</td></tr>" for item in items]

    return f'<table border="1" cellpadding="6" cellspacing="0">{header}{"".join(rows)}</table>'


def _send_email_with_retry(send_fn, *, max_retries=3, backoff_seconds=300):
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            send_fn()
            return True
        except Exception as exc:
            last_error = exc
            logger.exception('SUMMARY_EMAIL_ATTEMPT_FAILED attempt=%s', attempt)
            if attempt < max_retries:
                time.sleep(backoff_seconds)
    logger.error('SUMMARY_EMAIL_FAILED after retries: %s', last_error)
    return False


def send_kitchen_cutoff_summary_for_slot(slot, on_date=None):
    """Send post-cutoff kitchen summary email for one slot."""
    from apps.cms.views.dashboard import build_slot_order_summary
    from apps.common.email_utils import send_templated_email

    on_date = on_date or slot.date
    summary = build_slot_order_summary(slot.id, on_date, {'canteen_id': slot.canteen_id})
    if summary is None:
        return False

    cutoff_dt = _slot_cutoff_datetime(slot, on_date)
    recipients = _collect_kitchen_admin_emails(slot.canteen)
    if not recipients:
        logger.warning('KITCHEN_SUMMARY_NO_RECIPIENTS slot_id=%s', slot.id)
        return False

    subject = f"Cafinity Kitchen Summary — {slot.name} | {on_date.isoformat()} | {summary['canteen_name']}"
    table_html = _render_summary_table_html(summary['items'], include_delivered=False)
    grand_total = summary['totals']['total_ordered']
    text_body = (
        f"Slot: {slot.name}\nDate: {on_date.isoformat()}\n"
        f"Cutoff: {cutoff_dt.strftime('%H:%M')}\nCanteen: {summary['canteen_name']}\n\n"
        f"Grand Total Orders: {grand_total}\n\n"
        "This is an automated summary from Cafinity. Do not reply."
    )
    html_body = (
        f"<h2>Cafinity Kitchen Summary</h2>"
        f"<p><strong>Slot:</strong> {slot.name}<br>"
        f"<strong>Date:</strong> {on_date.isoformat()}<br>"
        f"<strong>Cutoff:</strong> {cutoff_dt.strftime('%H:%M')}<br>"
        f"<strong>Canteen:</strong> {summary['canteen_name']}</p>"
        f"{table_html}"
        f"<p><strong>GRAND TOTAL:</strong> {grand_total}</p>"
        f"<p><em>This is an automated summary from Cafinity. Do not reply.</em></p>"
    )

    def _send():
        for recipient in recipients:
            send_templated_email(
                subject=subject,
                to_email=recipient,
                template='cms/emails/slot_summary.html',
                context={
                    'email_title': subject,
                    'body_html': html_body,
                },
                text_body=text_body,
            )

    sent = _send_email_with_retry(_send)
    if sent:
        slot.summary_sent = True
        slot.save(update_fields=['summary_sent', 'updated_at'])
    return sent


def send_limited_admin_slot_summary_for_slot(slot, on_date=None):
    """Send detailed slot order summary to Limited Admin + Super Admin."""
    from apps.cms.views.dashboard import build_slot_order_summary
    from apps.common.email_utils import send_templated_email

    on_date = on_date or slot.date
    summary = build_slot_order_summary(slot.id, on_date, {'canteen_id': slot.canteen_id})
    if summary is None:
        return False

    recipients = _collect_admin_emails(slot.canteen)
    if not recipients:
        return False

    subject = f"Cafinity — Slot Order Summary: {slot.name} on {on_date.isoformat()}"
    table_html = _render_summary_table_html(summary['items'], include_delivered=True)
    totals = summary['totals']
    text_body = (
        f"Slot Order Summary — {slot.name} on {on_date.isoformat()}\n"
        f"Total: {totals['total_ordered']} | Delivered: {totals['delivered']} | Pending: {totals['pending']}\n"
    )

    def _send():
        for recipient in recipients:
            send_templated_email(
                subject=subject,
                to_email=recipient,
                template='cms/emails/slot_summary.html',
                context={
                    'email_title': subject,
                    'body_html': (
                        f"<h2>{subject}</h2>{table_html}"
                        f"<p>TOTAL: {totals['total_ordered']} | "
                        f"Delivered: {totals['delivered']} | Pending: {totals['pending']}</p>"
                    ),
                },
                text_body=text_body,
            )

    return _send_email_with_retry(_send)


@shared_task(name='cms.send_post_cutoff_summary')
def send_post_cutoff_summary():
    """
    Runs every 5 min — finds slots whose cutoff just passed and sends summary emails.
    """
    close_old_connections()
    from apps.cms.models.slot import MealSlot

    now = timezone.localtime()
    window_start = now - timedelta(minutes=5)
    today = now.date()

    slots = MealSlot.objects.select_related('canteen').filter(
        date=today,
        is_active=True,
        summary_sent=False,
    )

    processed = 0
    for slot in slots:
        cutoff_dt = _slot_cutoff_datetime(slot, today)
        if window_start <= cutoff_dt <= now:
            try:
                if send_kitchen_cutoff_summary_for_slot(slot, today):
                    send_limited_admin_slot_summary_for_slot(slot, today)
                    processed += 1
            except Exception:
                logger.exception('POST_CUTOFF_SUMMARY_FAILED slot_id=%s', slot.id)

    close_old_connections()
    return processed


def run_post_cutoff_summary_sync():
    """Synchronous fallback when Celery is unavailable."""
    return send_post_cutoff_summary()
