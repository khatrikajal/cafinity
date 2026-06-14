"""
apps/cms/views/kitchen.py

Kitchen device endpoints for Cafinity.

Endpoints:
  GET  /cms/kitchen/orders/          — live queue (PLACED + PREPARING + READY)
  GET  /cms/kitchen/orders/history/  — completed orders (DELIVERED + CANCELLED)
  POST /cms/kitchen/orders/<id>/status/ — advance order status (PLACED→PREPARING, PREPARING→READY)
  GET  /cms/kitchen/stats/           — dashboard stats for today
"""

import logging

from django.db import DatabaseError, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.service import log_action
from apps.cms.models.guest_order import GuestOrder
from apps.cms.models.order import ChangedByRole, Order, OrderStatus, OrderStatusLog
from apps.cms.services.orders import expire_due_orders, expire_order_if_needed
from apps.common.permissions import IsKitchenOrAdmin

logger = logging.getLogger(__name__)

SCHEMA_OUTDATED_DETAIL = (
    'Server database schema is out of date. '
    'Run "python manage.py migrate" on the API server and restart.'
)


def _token_value(request, key):
    try:
        return request.auth.get(key) if request.auth else None
    except Exception:
        return None


def _role_type(request):
    return _token_value(request, 'role_type') or ''


def _changed_by_role(request):
    return ChangedByRole.KITCHEN if _role_type(request) == 'KITCHEN' else ChangedByRole.ADMIN


def _status_to_frontend(value):
    # Cafinity — Simplified Order Status: only pending or delivered in kitchen UI
    if OrderStatus.is_pending(value):
        return 'pending'
    return {
        OrderStatus.DELIVERED: 'delivered',
        OrderStatus.CANCELLED: 'cancelled',
        OrderStatus.EXPIRED: 'expired',
    }.get(value, 'pending')


def _serialize_kitchen_order(order):
    try:
        slot = order.slot
    except Exception:
        slot = None

    employee = order.employee
    items = [
        {
            'id': str(item.id),
            'orderId': str(order.id),
            'menuItemId': str(item.menu_item_id),
            'name': item.item_name_snapshot,
            'quantity': item.quantity,
            'unitPrice': float(item.unit_price),
            'price': float(item.unit_price),
            'totalPrice': float(item.line_total),
            'slotId': str(order.slot_id),
        }
        for item in order.items.all()
    ]
    status_logs = [
        {
            'id': str(log.id),
            'fromStatus': log.from_status.lower() if log.from_status else None,
            'toStatus': log.to_status.lower(),
            'changedAt': log.changed_at.isoformat(),
            'changedByRole': log.changed_by_role,
            'note': log.note or '',
        }
        for log in order.status_logs.all()
    ]

    return {
        'id': str(order.id),
        'orderNumber': order.order_code,
        'customerId': str(employee.id),
        'customerName': employee.full_name,
        'department': employee.department.name if employee.department else '',
        'slotId': str(order.slot_id),
        'slotName': slot.name if slot else 'Slot',
        'items': items,
        'subtotal': float(order.subtotal),
        'tax': 0,
        'total': float(order.total_amount),
        'totalAmount': float(order.total_amount),
        'status': _status_to_frontend(order.status),
        'rawStatus': order.status,
        'paymentMethod': 'wallet',
        'createdAt': order.placed_at.isoformat(),
        'updatedAt': order.updated_at.isoformat(),
        'acceptedAt': order.accepted_at.isoformat() if order.accepted_at else None,
        'preparedAt': order.prepared_at.isoformat() if order.prepared_at else None,
        'statusLogs': status_logs,
    }


def _guest_status_to_frontend(value):
    return {
        'pending': 'placed',
        'accepted': 'preparing',
        'preparing': 'preparing',
        'prepared': 'ready',
        'ready': 'ready',
        'collected': 'delivered',
        'completed': 'delivered',
        'cancelled': 'cancelled',
    }.get(value, 'placed')


def _serialize_guest_order(order):
    items = [
        {
            'id': str(item.id),
            'orderId': str(order.id),
            'menuItemId': str(item.id),
            'name': item.name,
            'quantity': item.qty,
            'unitPrice': float(item.price),
            'price': float(item.price),
            'totalPrice': float(item.subtotal),
            'slotId': None,
        }
        for item in order.items.all()
    ]

    return {
        'id': str(order.id),
        'orderNumber': order.order_number or str(order.id),
        'customerId': str(order.id),
        'customerName': order.guest_name,
        'department': '',
        'slotId': None,
        'slotName': 'Guest',
        'items': items,
        'subtotal': float(order.total),
        'tax': 0,
        'total': float(order.total),
        'totalAmount': float(order.total),
        'status': _guest_status_to_frontend(order.status),
        'rawStatus': order.status,
        'paymentMethod': 'guest',
        'createdAt': order.created_at.isoformat(),
        'updatedAt': order.updated_at.isoformat(),
        'acceptedAt': None,
        'preparedAt': None,
        'statusLogs': [],
    }


def _base_queryset(request):
    """Build base queryset scoped to the kitchen's canteen."""
    qs = (
        Order.objects
        .select_related('employee', 'employee__department', 'slot')
        .defer('slot__summary_sent')
        .prefetch_related('items')
    )
    canteen_id = _token_value(request, 'canteen_id')
    company_id = _token_value(request, 'company_id')

    if canteen_id:
        qs = qs.filter(canteen_id=canteen_id)
    elif company_id:
        qs = qs.filter(canteen__company_id=company_id)

    return qs


def _base_guest_queryset(request):
    qs = GuestOrder.objects.defer('guest_type').prefetch_related('items')
    canteen_id = _token_value(request, 'canteen_id')
    company_id = _token_value(request, 'company_id')

    if canteen_id:
        qs = qs.filter(canteen_id=canteen_id)
    elif company_id:
        qs = qs.filter(canteen__company_id=company_id)

    return qs


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsKitchenOrAdmin])
def kitchen_orders_view(request):
    """
    GET /cms/kitchen/orders/
    Returns live orders: PLACED + PREPARING + READY for today.
    Kitchen sees all orders that need action.
    """
    try:
        return _kitchen_orders_view_impl(request)
    except DatabaseError:
        logger.exception('KITCHEN_ORDERS_DATABASE_ERROR')
        return Response(
            {'detail': SCHEMA_OUTDATED_DETAIL},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _kitchen_orders_view_impl(request):
    today = timezone.localdate()
    expire_due_orders(_base_queryset(request))
    live_statuses = list(OrderStatus.pending_statuses())

    orders = (
        _base_queryset(request)
        .filter(status__in=live_statuses, order_date=today)
        .order_by('placed_at')
    )
    guest_orders = (
        _base_guest_queryset(request)
        .filter(status__in=['pending', 'accepted', 'preparing', 'prepared', 'ready'], created_at__date=today)
        .order_by('created_at')
    )

    results = [_serialize_kitchen_order(order) for order in orders]
    results += [_serialize_guest_order(order) for order in guest_orders]
    results.sort(key=lambda order: order['createdAt'])

    return Response(
        {'results': results},
        status=status.HTTP_200_OK,
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsKitchenOrAdmin])
def kitchen_orders_history_view(request):
    """
    GET /cms/kitchen/orders/history/?date=YYYY-MM-DD
    GET /cms/kitchen/orders/history/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
    GET /cms/kitchen/orders/history/?all=true
    Returns delivered/cancelled/expired orders. Defaults to today.
    """
    try:
        return _kitchen_orders_history_view_impl(request)
    except DatabaseError:
        logger.exception('KITCHEN_ORDERS_HISTORY_DATABASE_ERROR')
        return Response(
            {'detail': SCHEMA_OUTDATED_DETAIL},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _kitchen_orders_history_view_impl(request):
    from datetime import date

    date_param = request.query_params.get('date')
    date_from_param = request.query_params.get('date_from')
    date_to_param = request.query_params.get('date_to')
    all_time = request.query_params.get('all', '').lower() == 'true'

    orders = _base_queryset(request).filter(
        status__in=[OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.EXPIRED],
    )
    guest_orders = _base_guest_queryset(request).filter(
        status__in=['collected', 'completed', 'cancelled'],
    )

    if not all_time and (date_from_param or date_to_param):
        try:
            if date_from_param:
                orders = orders.filter(order_date__gte=date.fromisoformat(date_from_param))
                guest_orders = guest_orders.filter(created_at__date__gte=date.fromisoformat(date_from_param))
            if date_to_param:
                orders = orders.filter(order_date__lte=date.fromisoformat(date_to_param))
                guest_orders = guest_orders.filter(created_at__date__lte=date.fromisoformat(date_to_param))
        except ValueError:
            orders = orders.filter(order_date=timezone.localdate())
            guest_orders = guest_orders.filter(created_at__date=timezone.localdate())
    elif not all_time:
        try:
            filter_date = date.fromisoformat(date_param) if date_param else timezone.localdate()
        except ValueError:
            filter_date = timezone.localdate()
        orders = orders.filter(order_date=filter_date)
        guest_orders = guest_orders.filter(created_at__date=filter_date)

    status_param = request.query_params.get('status', '').strip().lower()
    status_map = {
        'delivered': OrderStatus.DELIVERED,
        'cancelled': OrderStatus.CANCELLED,
        'expired': OrderStatus.EXPIRED,
    }
    guest_status_map = {
        'delivered': ['collected', 'completed'],
        'cancelled': ['cancelled'],
    }
    if status_param in status_map:
        orders = orders.filter(status=status_map[status_param])
    if status_param in guest_status_map:
        guest_orders = guest_orders.filter(status__in=guest_status_map[status_param])

    orders = orders.order_by('-updated_at')
    guest_results = [_serialize_guest_order(order) for order in guest_orders]
    results = [_serialize_kitchen_order(order) for order in orders] + guest_results
    results.sort(key=lambda order: order['updatedAt'], reverse=True)

    return Response(
        {'results': results},
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsKitchenOrAdmin])
def kitchen_order_status_view(request, order_id):
    """
    POST /cms/kitchen/orders/<order_id>/status/
    Body: { "status": "delivered", "note": "optional" }

    Simplified flow: pending → delivered (triggered by print/deliver action).
    """
    new_status_raw = (request.data.get('status') or '').strip().lower()
    note = (request.data.get('note') or '').strip()

    frontend_to_backend = {
        'pending': OrderStatus.DELIVERED,
        'placed': OrderStatus.DELIVERED,
        'preparing': OrderStatus.DELIVERED,
        'ready': OrderStatus.DELIVERED,
        'delivered': OrderStatus.DELIVERED,
    }

    frontend_to_guest_status = {
        'accepted': 'preparing',
        'placed': 'preparing',
        'pending': 'preparing',
        'preparing': 'preparing',
        'ready': 'ready',
        'delivered': 'collected',
    }

    new_order_status = frontend_to_backend.get(new_status_raw)
    new_guest_status = frontend_to_guest_status.get(new_status_raw)
    if not new_order_status and not new_guest_status:
        return Response(
            {'detail': "status must be 'delivered'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        # Lock only the bare Order or GuestOrder row — select_for_update cannot be used
        # with select_related on nullable FK outer joins.
        locked = Order.objects.select_for_update().filter(id=order_id).first()
        if locked is not None:
            if expire_order_if_needed(locked):
                return Response(
                    {
                        'detail': 'This order has expired and can no longer be prepared.',
                        'currentStatus': 'expired',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            skip_transition_check = locked.status == OrderStatus.PLACED and new_order_status == OrderStatus.READY
            if not skip_transition_check and not OrderStatus.can_transition(locked.status, new_order_status):
                return Response(
                    {
                        'detail': f"Cannot move order from {locked.status} to {new_order_status}.",
                        'currentStatus': _status_to_frontend(locked.status),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            previous_status = locked.status
            now = timezone.now()
            locked.status = new_order_status
            update_fields = ['status', 'updated_at']

            if new_order_status == OrderStatus.PREPARING:
                locked.accepted_at = now
                update_fields.append('accepted_at')
            elif new_order_status == OrderStatus.READY:
                if previous_status == OrderStatus.PLACED:
                    locked.accepted_at = now
                    update_fields.append('accepted_at')
                locked.prepared_at = now
                update_fields.append('prepared_at')
            elif new_order_status == OrderStatus.DELIVERED:
                locked.collected_at = now
                locked.receipt_printed_at = now
                update_fields.extend(['collected_at', 'receipt_printed_at'])

            locked.save(update_fields=update_fields)

            OrderStatusLog.objects.create(
                order=locked,
                from_status=previous_status,
                to_status=new_order_status,
                changed_by_role=_changed_by_role(request),
                note=note or f"Status updated to {new_order_status} by kitchen.",
            )
            log_action(
                actor=request.user,
                action_category=AuditLog.ACTION_ORDERS,
                action='order_status_changed',
                target=locked,
                previous_state={'status': previous_status},
                new_state={'status': new_order_status},
                request=request,
                metadata={'note': note, 'source': 'kitchen'},
            )

            order = _base_queryset(request).filter(id=order_id).first()
            return Response(_serialize_kitchen_order(order), status=status.HTTP_200_OK)

        guest_order = GuestOrder.objects.select_for_update().filter(id=order_id).first()
        if guest_order is None:
            return Response({'detail': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)

        if guest_order.status in {'collected', 'completed', 'cancelled'}:
            return Response(
                {
                    'detail': 'This guest order has already been completed.',
                    'currentStatus': _guest_status_to_frontend(guest_order.status),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        allowed_transitions = {
            'pending': {'preparing', 'cancelled'},
            'accepted': {'preparing', 'ready', 'cancelled'},
            'preparing': {'ready', 'cancelled'},
            'prepared': {'ready', 'collected', 'cancelled'},
            'ready': {'collected', 'cancelled'},
            'collected': set(),
            'completed': set(),
            'cancelled': set(),
        }

        if new_guest_status not in allowed_transitions.get(guest_order.status, set()):
            return Response(
                {
                    'detail': f"Cannot move guest order from {guest_order.status} to {new_guest_status}.",
                    'currentStatus': _guest_status_to_frontend(guest_order.status),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        prev_guest_status = guest_order.status
        guest_order.status = new_guest_status
        guest_order.save(update_fields=['status', 'updated_at'])
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_ORDERS,
            action='order_status_changed',
            target=guest_order,
            previous_state={'status': prev_guest_status},
            new_state={'status': new_guest_status},
            request=request,
            metadata={'source': 'kitchen_guest'},
        )

        return Response(_serialize_guest_order(guest_order), status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsKitchenOrAdmin])
def kitchen_stats_view(request):
    """
    GET /cms/kitchen/stats/
    Returns today's order counts by status for the kitchen dashboard.
    """
    try:
        return _kitchen_stats_view_impl(request)
    except DatabaseError:
        logger.exception('KITCHEN_STATS_DATABASE_ERROR')
        return Response(
            {'detail': SCHEMA_OUTDATED_DETAIL},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


def _kitchen_stats_view_impl(request):
    today = timezone.localdate()
    qs = _base_queryset(request).filter(order_date=today)

    guest_qs = _base_guest_queryset(request).filter(created_at__date=today)

    counts = {
        'placed': 0,
        'preparing': qs.filter(status__in=[OrderStatus.PLACED, OrderStatus.PREPARING]).count() + guest_qs.filter(status__in=['pending', 'accepted', 'preparing']).count(),
        'ready': qs.filter(status=OrderStatus.READY).count() + guest_qs.filter(status__in=['prepared', 'ready']).count(),
        'delivered': qs.filter(status=OrderStatus.DELIVERED).count() + guest_qs.filter(status__in=['collected', 'completed']).count(),
        'cancelled': qs.filter(status=OrderStatus.CANCELLED).count() + guest_qs.filter(status='cancelled').count(),
        'expired': qs.filter(status=OrderStatus.EXPIRED).count(),
    }
    counts['total'] = (
        counts['placed']
        + counts['preparing']
        + counts['ready']
        + counts['delivered']
        + counts['cancelled']
        + counts['expired']
    )
    counts['live'] = counts['placed'] + counts['preparing'] + counts['ready']

    return Response(counts, status=status.HTTP_200_OK)
