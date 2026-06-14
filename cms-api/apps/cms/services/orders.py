from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone

from apps.cms.models.order import ChangedByRole, Order, OrderStatus, OrderStatusLog


ORDER_EXPIRY_GRACE_HOURS = 2
EXPIRABLE_ORDER_STATUSES = [
    OrderStatus.PENDING,
    OrderStatus.PLACED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
]


def _slot_expiry_at(slot, order_date=None):
    if not slot:
        return None

    # Use order_date if provided (e.g. for recurring past slots where
    # slot.date is a past date but the order was placed against today).
    effective_date = order_date or slot.date
    slot_end = datetime.combine(effective_date, slot.end_time)
    if timezone.is_naive(slot_end):
        slot_end = timezone.make_aware(slot_end, timezone.get_current_timezone())
    return slot_end + timedelta(hours=ORDER_EXPIRY_GRACE_HOURS)


def is_order_expired(order, now=None):
    if order.status not in EXPIRABLE_ORDER_STATUSES:
        return False

    try:
        slot = order.slot
    except Exception:
        slot = None

    # Pass order.order_date so recurring slots (whose slot.date may be in the past)
    # expire relative to the date the order was actually placed.
    expires_at = _slot_expiry_at(slot, order_date=order.order_date)
    if expires_at is None:
        end_of_order_day = datetime.combine(order.order_date, time.max)
        if timezone.is_naive(end_of_order_day):
            end_of_order_day = timezone.make_aware(end_of_order_day, timezone.get_current_timezone())
        expires_at = end_of_order_day + timedelta(hours=ORDER_EXPIRY_GRACE_HOURS)

    return (now or timezone.now()) >= expires_at


@transaction.atomic
def expire_order_if_needed(order, now=None):
    if not is_order_expired(order, now=now):
        return False

    locked = (
        Order.objects
        .select_for_update()
        .select_related('slot')
        .only(
            'id',
            'status',
            'order_date',
            'cancellation_reason',
            'updated_at',
            'slot__id',
            'slot__date',
            'slot__start_time',
            'slot__end_time',
        )
        .filter(pk=order.pk)
        .first()
    )
    if locked is None or not is_order_expired(locked, now=now):
        return False

    previous_status = locked.status
    locked.status = OrderStatus.EXPIRED
    locked.cancellation_reason = locked.cancellation_reason or (
        f"Auto-expired {ORDER_EXPIRY_GRACE_HOURS} hours after slot end."
    )
    locked.save(update_fields=['status', 'cancellation_reason', 'updated_at'])

    OrderStatusLog.objects.create(
        order=locked,
        from_status=previous_status,
        to_status=OrderStatus.EXPIRED,
        changed_by=None,
        changed_by_role=ChangedByRole.SYSTEM,
        note=locked.cancellation_reason,
    )

    order.status = locked.status
    order.cancellation_reason = locked.cancellation_reason
    order.updated_at = locked.updated_at
    return True


# def expire_due_orders(queryset=None, now=None):
#     now = now or timezone.now()
#     qs = queryset if queryset is not None else Order.objects.all()
#     qs = (
#         qs
#         .prefetch_related(None)
#         .filter(status__in=EXPIRABLE_ORDER_STATUSES)
#         .select_related('slot')
#     )

#     expired_count = 0
#     # for order in qs.iterator(chunk_size=200):
#     for order in qs:
#         if expire_order_if_needed(order, now=now):
#             expired_count += 1

#     return expired_count

def expire_due_orders(queryset=None, now=None):
    now = now or timezone.now()

    qs = (
        (queryset if queryset is not None else Order.objects.all())
        .filter(status__in=EXPIRABLE_ORDER_STATUSES)
        .select_related('slot')
        .only(
            'id',
            'status',
            'order_date',
            'cancellation_reason',
            'updated_at',
            'slot__id',
            'slot__date',
            'slot__start_time',
            'slot__end_time',
        )
    )

    expired_count = 0

    for order in qs:
        if expire_order_if_needed(order, now=now):
            expired_count += 1

    return expired_count
