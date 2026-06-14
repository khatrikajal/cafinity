# Cafinity Security Fix Round 2 — VAPT June 2026 — Fix G (canteen IDOR)
"""
Dashboard endpoints for live slot overview and per-item order summaries.
"""

import logging
from datetime import date, datetime, timedelta

from django.db import DatabaseError
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Employee, RoleChoices
from apps.cms.models.order import Order, OrderItem, OrderStatus
from apps.cms.models.slot import MealSlot
from apps.common.permissions import IsDashboardViewer

logger = logging.getLogger(__name__)

PENDING_STATUSES = OrderStatus.pending_statuses()

SCHEMA_OUTDATED_DETAIL = (
    'Server database schema is out of date. '
    'Run "python manage.py migrate" on the API server and restart.'
)

LIVE_SLOT_FIELDS = (
    'id', 'name', 'date', 'start_time', 'end_time', 'is_active', 'canteen_id',
    'canteen__id', 'canteen__name',
)


def _token_value(request, key):
    try:
        return request.auth.get(key) if request.auth else None
    except Exception:
        return None


def _role_type(request):
    return _token_value(request, 'role_type') or ''


def _resolve_canteen_scope(request, canteen_id_param=None):
    """Return queryset filter kwargs for canteen scoping."""
    if canteen_id_param:
        from apps.core.canteen_scope import validate_canteen_access
        validate_canteen_access(request, canteen_id_param)

    role = _role_type(request)
    employee_id = _token_value(request, 'employee_id')

    if role == RoleChoices.LIMITED_ADMIN:
        if employee_id:
            employee = Employee.objects.filter(id=employee_id).first()
            if employee and employee.canteen_id:
                return {'canteen_id': employee.canteen_id}
        canteen_id = _token_value(request, 'canteen_id')
        if canteen_id:
            return {'canteen_id': canteen_id}
        return None

    if role == RoleChoices.SUPER_ADMIN:
        if canteen_id_param:
            return {'canteen_id': canteen_id_param}
        return {}

    canteen_id = _token_value(request, 'canteen_id')
    if canteen_id:
        return {'canteen_id': canteen_id}

    company_id = _token_value(request, 'company_id')
    if company_id and role != RoleChoices.SUPER_ADMIN:
        return {'canteen__company_id': company_id}

    return {}


def _time_to_minutes(value):
    return value.hour * 60 + value.minute


def _is_slot_active(slot, now_local):
    """True when current local time is within slot start/end on slot.date."""
    if not slot.is_active:
        return False
    if slot.date != now_local.date():
        return False
    current_minutes = _time_to_minutes(now_local.time())
    start_minutes = _time_to_minutes(slot.start_time)
    end_minutes = _time_to_minutes(slot.end_time)
    return start_minutes <= current_minutes <= end_minutes


def _slot_order_counts(slot, canteen_filter):
    orders = Order.objects.filter(slot_id=slot.id, order_date=slot.date, **canteen_filter)
    total = orders.count()
    delivered = orders.filter(status=OrderStatus.DELIVERED).count()
    pending = orders.filter(status__in=PENDING_STATUSES).count()
    return total, delivered, pending


def _build_slot_payload(slot, canteen_filter):
    total, delivered, pending = _slot_order_counts(slot, canteen_filter)
    canteen_name = slot.canteen.name if slot.canteen_id else ''
    return {
        'slot_id': str(slot.id),
        'slot_name': slot.name,
        'start_time': slot.start_time.strftime('%H:%M'),
        'end_time': slot.end_time.strftime('%H:%M'),
        'total_orders': total,
        'delivered_orders': delivered,
        'pending_orders': pending,
        'canteen_name': canteen_name,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsDashboardViewer])
def dashboard_live_slots_view(request):
    """
    GET /dashboard/live-slots/
    Real-time active slot overview with order counts.
    """
    try:
        return _dashboard_live_slots_view(request)
    except DatabaseError:
        logger.exception('LIVE_SLOTS_DATABASE_ERROR')
        return Response(
            {'detail': SCHEMA_OUTDATED_DETAIL},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _dashboard_live_slots_view(request):
    scope = _resolve_canteen_scope(request)
    if scope is None:
        logger.warning(
            'LIVE_SLOTS_403 role=%s reason=missing_canteen_assignment',
            _role_type(request),
        )
        return Response(
            {'detail': 'No canteen assigned to your account.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    now_local = timezone.localtime()
    today = now_local.date()

    slots_qs = (
        MealSlot.objects
        .select_related('canteen')
        .only(*LIVE_SLOT_FIELDS)
        .filter(date=today, is_active=True, **scope)
        .order_by('start_time')
    )

    active_slots = []
    for slot in slots_qs:
        if _is_slot_active(slot, now_local):
            active_slots.append(_build_slot_payload(slot, scope))

    next_slot = None
    if not active_slots:
        upcoming = []
        for slot in slots_qs:
            if slot.date == today and _time_to_minutes(slot.start_time) > _time_to_minutes(now_local.time()):
                upcoming.append(slot)
        if upcoming:
            nxt = upcoming[0]
            next_slot = {
                'slot_name': nxt.name,
                'start_time': nxt.start_time.strftime('%H:%M'),
            }

    return Response({
        'active_slots': active_slots,
        'next_slot': next_slot,
    }, status=status.HTTP_200_OK)


def build_slot_order_summary(slot_id, order_date, canteen_filter=None):
    """Build slot order summary payload used by API and email tasks."""
    canteen_filter = canteen_filter or {}
    try:
        slot = MealSlot.objects.select_related('canteen').only(*LIVE_SLOT_FIELDS).get(id=slot_id)
    except MealSlot.DoesNotExist:
        return None

    # Use the slot's calendar date as source of truth — orders are tied to a slot.
    summary_date = slot.date

    orders = Order.objects.filter(
        slot_id=slot.id,
        **canteen_filter,
    ).exclude(status=OrderStatus.CANCELLED)

    item_rows = (
        OrderItem.objects
        .filter(order__in=orders)
        .values('menu_item_id', 'item_name_snapshot')
        .annotate(total_ordered=Sum('quantity'))
        .order_by('item_name_snapshot')
    )

    delivered_orders = orders.filter(status=OrderStatus.DELIVERED)
    delivered_by_item = {
        row['menu_item_id']: row['qty']
        for row in (
            OrderItem.objects
            .filter(order__in=delivered_orders)
            .values('menu_item_id')
            .annotate(qty=Sum('quantity'))
        )
    }

    items = []
    totals = {'total_ordered': 0, 'delivered': 0, 'pending': 0, 'order_count': orders.count()}

    for row in item_rows:
        menu_item_id = row['menu_item_id']
        total_ordered = int(row['total_ordered'] or 0)
        delivered = int(delivered_by_item.get(menu_item_id, 0))
        pending = max(0, total_ordered - delivered)
        items.append({
            'item_id': str(menu_item_id),
            'item_name': row['item_name_snapshot'],
            'category': '',
            'total_ordered': total_ordered,
            'delivered': delivered,
            'pending': pending,
        })
        totals['total_ordered'] += total_ordered
        totals['delivered'] += delivered
        totals['pending'] += pending

    return {
        'slot_name': slot.name,
        'date': summary_date.isoformat(),
        'canteen_name': slot.canteen.name if slot.canteen_id else '',
        'items': items,
        'totals': totals,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsDashboardViewer])
def dashboard_slot_order_summary_view(request):
    """
    GET /dashboard/slot-order-summary/?slot_id=&date=
    Per-menu-item order counts for a slot.
    """
    slot_id = request.query_params.get('slot_id', '').strip()
    date_param = request.query_params.get('date', '').strip()

    if not slot_id:
        return Response({'detail': 'slot_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        order_date = date.fromisoformat(date_param) if date_param else timezone.localdate()
    except ValueError:
        return Response({'detail': 'date must be YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

    scope = _resolve_canteen_scope(request, request.query_params.get('canteen_id'))
    if scope is None:
        logger.warning(
            'SLOT_ORDER_SUMMARY_403 role=%s reason=missing_canteen_assignment',
            _role_type(request),
        )
        return Response(
            {'detail': 'No canteen assigned to your account.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    role = _role_type(request)
    if role == RoleChoices.SUPER_ADMIN:
        canteen_id_param = request.query_params.get('canteen_id')
        if canteen_id_param:
            scope = {'canteen_id': canteen_id_param}

    summary = build_slot_order_summary(slot_id, order_date, scope)
    if summary is None:
        return Response({'detail': 'Slot not found.'}, status=status.HTTP_404_NOT_FOUND)

    return Response(summary, status=status.HTTP_200_OK)
