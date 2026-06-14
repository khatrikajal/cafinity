import secrets
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Employee, RoleChoices
from apps.cms.models.canteen import CanteenLocation
from apps.cms.models.menu import CanteenMenuItem
from apps.cms.models.order import ChangedByRole, Order, OrderItem, OrderStatus, OrderStatusLog
from apps.cms.models.slot import MealSlot, SlotMenuItem
from apps.cms.services.orders import expire_due_orders, expire_order_if_needed
from apps.common.permissions import IsEmployee, IsEmployeeOrAdmin

# Count toward slot-level available_quantity (exclude cancelled).
_SLOT_ORDER_ACTIVE_STATUSES = tuple(OrderStatus.pending_statuses()) + (OrderStatus.DELIVERED,)


def _token_value(request, key):
    try:
        return request.auth.get(key) if request.auth else None
    except Exception:
        return None


def _current_employee(request):
    employee_id = _token_value(request, 'employee_id')
    if not employee_id:
        return None
    return (
        Employee.objects
        .select_related('company', 'department', 'employee_category')
        .filter(id=employee_id, is_active=True)
        .first()
    )


def _current_canteen(request, employee):
    if employee and employee.canteen_id:
        return employee.canteen

    if _token_value(request, 'role_type') == RoleChoices.LIMITED_ADMIN:
        return None

    company_id = getattr(request, 'tenant_company_id', None) or _token_value(request, 'company_id')
    if not company_id and employee and employee.company_id:
        company_id = employee.company_id

    qs = CanteenLocation.objects.filter(is_active=True, deleted_at__isnull=True)
    if company_id:
        qs = qs.filter(company_id=company_id)

    return qs.order_by('name').first()


def _photo_url(request, item):
    if not item.photo:
        return None
    try:
        return request.build_absolute_uri(item.photo.url)
    except Exception:
        return item.photo.url


def _frontend_category(category_name, is_veg):
    normalized = (category_name or '').strip().lower()
    if normalized in {'veg', 'vegetarian'} or is_veg:
        return 'Veg'
    if normalized in {'non veg', 'non-veg', 'nonveg'}:
        return 'Non-Veg'
    if normalized in {'beverage', 'beverages', 'drink', 'drinks'}:
        return 'Beverages'
    if normalized in {'dessert', 'desserts'}:
        return 'Desserts'
    if normalized in {'snack', 'snacks'}:
        return 'Snacks'
    return 'Veg' if is_veg else 'Non-Veg'


def _slot_type_name(slot):
    return 'Breakfast' if slot.meal_type == CanteenMenuItem.ITEM_TYPE_BREAKFAST else 'Meal'


def _time_to_minutes(value):
    return value.hour * 60 + value.minute


def _slot_order_close_minutes(slot):
    return max(0, _time_to_minutes(slot.start_time) - int(getattr(slot, 'buffer_minutes', 0) or 0))


def _slot_order_close_time(slot):
    close_minutes = _slot_order_close_minutes(slot)
    hour, minute = divmod(close_minutes, 60)
    return timezone.datetime.min.time().replace(hour=hour, minute=minute)


def _slot_order_close_at(slot, effective_date=None):
    effective_date = effective_date or slot.date
    close_at = datetime.combine(effective_date, _slot_order_close_time(slot))
    if timezone.is_naive(close_at):
        close_at = timezone.make_aware(close_at, timezone.get_current_timezone())
    return close_at


def _resolve_slot_effective_date_and_status(slot):
    today = timezone.localdate()
    current_time = timezone.localtime().time()

    if not slot.is_active:
        return slot.date, 'expired'

    if slot.date > today:
        return slot.date, 'upcoming'

    # Active slots with an old date are treated as recurring daily windows.
    effective_date = today if slot.date < today else slot.date

    current_minutes = _time_to_minutes(current_time)
    close_minutes = _slot_order_close_minutes(slot)

    if current_minutes < close_minutes:
        return effective_date, 'upcoming'
    return effective_date, 'expired'


def _slot_status(slot):
    _, status = _resolve_slot_effective_date_and_status(slot)
    return status


def _serialize_slot(slot, item_ids=None):
    effective_date, status_val = _resolve_slot_effective_date_and_status(slot)
    start = slot.start_time.strftime('%H:%M')
    end = slot.end_time.strftime('%H:%M')
    ordering_deadline_time = _slot_order_close_time(slot).strftime('%H:%M')
    ordering_deadline_at = _slot_order_close_at(slot, effective_date=effective_date)
    is_ordering_open = status_val != 'expired'
    return {
        'id': str(slot.id),
        'name': slot.name,
        'startTime': start,
        'endTime': end,
        'status': status_val,
        'date': effective_date.isoformat(),
        'type': _slot_type_name(slot),
        'displayTime': f"{start} - {end}",
        'active': bool(slot.is_active),
        'capacity': slot.capacity,
        'bufferMinutes': int(getattr(slot, 'buffer_minutes', 0) or 0),
        'orderingDeadlineTime': ordering_deadline_time,
        'ordering_deadline_time': ordering_deadline_time,
        'orderingDeadlineAt': ordering_deadline_at.isoformat(),
        'ordering_deadline_at': ordering_deadline_at.isoformat(),
        'closedAt': ordering_deadline_at.isoformat(),
        'closed_at': ordering_deadline_at.isoformat(),
        'isOrderingOpen': is_ordering_open,
        'is_ordering_open': is_ordering_open,
        'displayStatus': 'Closed' if not is_ordering_open else 'Open',
        'display_status': 'Closed' if not is_ordering_open else 'Open',
        'menuItemIds': item_ids or [],
        'disabledItemIds': [],
    }


def _serialize_menu_item(request, item, assigned_slots, slot_item_meta=None, employee=None):
    primary_slot = assigned_slots[0] if assigned_slots else None
    type_name = 'Breakfast' if item.item_type == CanteenMenuItem.ITEM_TYPE_BREAKFAST else 'Meal'
    effective_price = _menu_item_effective_price(item, employee)
    eligible_for_discount = _is_employee_discount_eligible(employee)
    return {
        'id': str(item.id),
        'name': item.name,
        'description': item.description or '',
        'price': float(effective_price),
        'discountedPrice': float(item.discounted_price) if eligible_for_discount and item.discounted_price is not None else None,
        'category': _frontend_category(item.category.name if item.category else '', item.is_veg),
        'type': type_name,
        'available': bool(item.is_available and item.is_active),
        'image': _photo_url(request, item),
        'tag': item.display_tag or '',
        'slot': primary_slot.name if primary_slot else '',
        'slotId': str(primary_slot.id) if primary_slot else '',
        'live': bool(item.is_available and item.is_active),
        'slotItemMeta': slot_item_meta or [],
    }


EMPLOYEE_NOT_FOUND_MESSAGE = 'Employee profile not found.'


def _status_to_frontend(value):
    if OrderStatus.is_pending(value):
        return 'pending'
    return {
        OrderStatus.DELIVERED: 'delivered',
        OrderStatus.CANCELLED: 'cancelled',
        OrderStatus.EXPIRED: 'expired',
    }.get(value, 'pending')


def _is_employee_discount_eligible(employee):
    if not employee:
        return False
    category = getattr(employee, 'employee_category', None)
    return bool(category and getattr(category, 'is_discount_eligible', False))


def _menu_item_effective_price(item, employee):
    if _is_employee_discount_eligible(employee) and getattr(item, 'discounted_price', None) is not None:
        return item.discounted_price
    return item.base_price


def _generate_order_code():
    for _ in range(100):
        code = str(secrets.randbelow(90000) + 10000)
        if not Order.objects.filter(order_code=code).exists():
            return code
    raise RuntimeError("Unable to generate a unique 5-digit order code.")


def _serialize_order(order):
    try:
        slot = order.slot
    except MealSlot.DoesNotExist:
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
        'paymentMethod': 'order',
        'createdAt': order.placed_at.isoformat(),
        'updatedAt': order.updated_at.isoformat(),
        'statusLogs': status_logs,
    }


def _build_active_slots_for_canteen(canteen):
    slots = list(
        MealSlot.objects
        .filter(canteen=canteen, is_active=True)
        .prefetch_related('slot_items')
        .order_by('date', 'start_time', 'name')
    )
    return slots


def _build_slot_menu_maps(slots, canteen):
    slot_items = list(
        SlotMenuItem.objects
        .filter(slot__in=slots, is_enabled=True)
        .select_related('slot')
        .order_by('slot__start_time')
    )

    item_ids = {row.menu_item_id for row in slot_items}
    items = list(
        CanteenMenuItem.objects
        .filter(id__in=item_ids, canteen=canteen, is_active=True, is_available=True)
        .select_related('category')
        .order_by('item_type', 'name')
    )

    item_ids_by_slot = {str(slot.id): [] for slot in slots}
    slots_by_item_id = {}
    rows_by_item_id = {}

    for row in slot_items:
        item_ids_by_slot.setdefault(str(row.slot_id), []).append(str(row.menu_item_id))
        slots_by_item_id.setdefault(str(row.menu_item_id), []).append(row.slot)
        rows_by_item_id.setdefault(row.menu_item_id, []).append(row)

    ordered_rows = (
        OrderItem.objects.filter(
            order__slot_id__in=[s.id for s in slots],
            order__status__in=_SLOT_ORDER_ACTIVE_STATUSES,
        )
        .values('order__slot_id', 'menu_item_id')
        .annotate(total=Sum('quantity'))
    )
    ordered_map = {
        (str(r['order__slot_id']), str(r['menu_item_id'])): r['total'] or 0
        for r in ordered_rows
    }

    return item_ids_by_slot, slots_by_item_id, rows_by_item_id, ordered_map, items


def _build_employee_menu_response(request, canteen, slots, employee):
    item_ids_by_slot, slots_by_item_id, rows_by_item_id, ordered_map, items = _build_slot_menu_maps(slots, canteen)

    def _slot_item_meta_for(menu_item_uuid):
        meta = []
        for smi in rows_by_item_id.get(menu_item_uuid, []):
            key = (str(smi.slot_id), str(smi.menu_item_id))
            ordered_qty = ordered_map.get(key, 0)
            cap = smi.available_quantity
            remaining = None if cap is None else max(0, int(cap) - ordered_qty)
            meta.append({
                'slotId': str(smi.slot_id),
                'maxQtyPerOrder': smi.max_qty_per_order,
                'minQtyPerOrder': smi.min_order_quantity,
                'maxOrderQuantity': smi.max_order_quantity,
                'availableQuantity': cap,
                'remaining': remaining,
            })
        return meta

    serialized_items = []
    for item in items:
        if str(item.id) not in slots_by_item_id:
            continue
        meta = _slot_item_meta_for(item.id)
        serialized_items.append(
            _serialize_menu_item(request, item, slots_by_item_id.get(str(item.id), []), slot_item_meta=meta, employee=employee)
        )

    serialized_slots = [
        _serialize_slot(slot, item_ids_by_slot.get(str(slot.id), []))
        for slot in slots
    ]

    return {
        'canteen': {'id': str(canteen.id), 'name': canteen.name},
        'slots': serialized_slots,
        'items': serialized_items,
    }


def _parse_order_payload(payload):
    slot_id = str(payload.get('slot_id') or '').strip()
    try:
        parsed_slot_id = uuid.UUID(slot_id)
    except ValueError:
        return None, None, Response({'slot_id': 'A valid slot_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

    payload_items = payload.get('items')
    if not isinstance(payload_items, list) or not payload_items:
        return None, None, Response({'items': 'At least one item is required.'}, status=status.HTTP_400_BAD_REQUEST)

    quantities_by_item_id = {}
    for row in payload_items:
        menu_item_id = str((row or {}).get('menu_item_id') or '').strip()
        try:
            quantity = int((row or {}).get('quantity', 1))
        except (TypeError, ValueError):
            quantity = 0
        if not menu_item_id or quantity <= 0:
            return None, None, Response({'items': 'Each item needs menu_item_id and positive quantity.'}, status=status.HTTP_400_BAD_REQUEST)
        quantities_by_item_id[menu_item_id] = quantities_by_item_id.get(menu_item_id, 0) + quantity

    return parsed_slot_id, quantities_by_item_id, None


def _load_menu_items_for_order(menu_item_ids, canteen):
    return {
        str(item.id): item
        for item in CanteenMenuItem.objects.filter(
            id__in=menu_item_ids,
            canteen=canteen,
            is_active=True,
            is_available=True,
        ).select_related('category')
    }


def _select_slot_for_order(parsed_slot_id, canteen):
    try:
        slot = MealSlot.objects.select_for_update().get(id=parsed_slot_id, canteen=canteen, is_active=True)
        return slot, None
    except MealSlot.DoesNotExist:
        return None, Response({'slot_id': 'A valid slot_id is required.'}, status=status.HTTP_400_BAD_REQUEST)


def _load_ordered_totals(slot, quantities_by_item_id):
    return {
        str(r['menu_item_id']): r['total'] or 0
        for r in (
            OrderItem.objects.filter(
                order__slot=slot,
                menu_item_id__in=[uuid.UUID(i) for i in quantities_by_item_id.keys()],
                order__status__in=_SLOT_ORDER_ACTIVE_STATUSES,
            )
            .values('menu_item_id')
            .annotate(total=Sum('quantity'))
        )
    }


def _validate_slot_menu_item_quantity(item_id, quantity, smi, menu_items, ordered_totals):
    min_qty = max(1, smi.min_order_quantity)
    max_qty = max(min_qty, smi.max_order_quantity or smi.max_qty_per_order)
    if quantity < min_qty:
        return Response(
            {'error': f"Minimum quantity for this item is {min_qty} ({menu_items[item_id].name})."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if quantity > max_qty:
        return Response(
            {'error': f"Maximum quantity for this item is {max_qty} ({menu_items[item_id].name})."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if smi.available_quantity is not None:
        already = ordered_totals.get(item_id, 0)
        if already + quantity > smi.available_quantity:
            return Response(
                {
                    'items': (
                        f"Only {smi.available_quantity} portion(s) of {menu_items[item_id].name} "
                        f"are available for this slot ({already} already ordered)."
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
    return None


def _validate_order_slot_items(slot, menu_items, quantities_by_item_id):
    slot_item_rows = list(
        SlotMenuItem.objects.select_for_update().filter(
            slot=slot,
            is_enabled=True,
            menu_item_id__in=quantities_by_item_id.keys(),
        )
    )
    enabled_item_ids = {str(row.menu_item_id) for row in slot_item_rows}
    if enabled_item_ids != set(quantities_by_item_id.keys()):
        unavailable_names = [
            menu_items[item_id].name
            for item_id in quantities_by_item_id.keys()
            if item_id not in enabled_item_ids and item_id in menu_items
        ]
        suffix = f": {', '.join(unavailable_names)}" if unavailable_names else "."
        return None, Response(
            {'items': f"One or more items are not assigned or enabled for {slot.name}{suffix}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    smi_by_item_id = {str(row.menu_item_id): row for row in slot_item_rows}
    ordered_totals = _load_ordered_totals(slot, quantities_by_item_id)

    for item_id, quantity in quantities_by_item_id.items():
        smi = smi_by_item_id.get(item_id)
        if smi is None:
            continue

        error_response = _validate_slot_menu_item_quantity(item_id, quantity, smi, menu_items, ordered_totals)
        if error_response:
            return None, error_response

    return smi_by_item_id, None


def _calculate_order_subtotal(menu_items, quantities_by_item_id, employee):
    return sum(
        _menu_item_effective_price(menu_items[item_id], employee) * Decimal(quantity)
        for item_id, quantity in quantities_by_item_id.items()
    )


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsEmployee])
def employee_menu_view(request):
    employee = _current_employee(request)
    role_type = _token_value(request, 'role_type')
    if employee is None and role_type == RoleChoices.EMPLOYEE:
        return Response({'detail': EMPLOYEE_NOT_FOUND_MESSAGE}, status=status.HTTP_404_NOT_FOUND)

    canteen = _current_canteen(request, employee)
    if canteen is None:
        return Response({'detail': 'No active canteen found.'}, status=status.HTTP_404_NOT_FOUND)

    slots = _build_active_slots_for_canteen(canteen)
    response_data = _build_employee_menu_response(request, canteen, slots, employee)
    return Response(response_data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, IsEmployeeOrAdmin])
def employee_orders_view(request):
    employee = _current_employee(request)
    if employee is None:
        return Response({'detail': EMPLOYEE_NOT_FOUND_MESSAGE}, status=status.HTTP_404_NOT_FOUND)

    canteen = _current_canteen(request, employee)
    if canteen is None:
        return Response({'detail': 'No active canteen found.'}, status=status.HTTP_404_NOT_FOUND)

    expire_due_orders(Order.objects.filter(employee=employee, canteen=canteen))

    if request.method == 'GET':
        orders = (
            Order.objects
            .filter(employee=employee)
            .select_related('employee', 'employee__department')
            .prefetch_related('items')
            .order_by('-placed_at')
        )
        return Response({'results': [_serialize_order(order) for order in orders]}, status=status.HTTP_200_OK)

    parsed_slot_id, quantities_by_item_id, error_response = _parse_order_payload(request.data)
    if error_response:
        return error_response

    menu_items = _load_menu_items_for_order(quantities_by_item_id.keys(), canteen)
    if len(menu_items) != len(quantities_by_item_id):
        return Response({'items': 'One or more menu items are unavailable.'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        slot, error_response = _select_slot_for_order(parsed_slot_id, canteen)
        if error_response:
            return error_response

        if _slot_status(slot) == 'expired':
            return Response({'slot_id': 'This slot is closed for ordering.'}, status=status.HTTP_400_BAD_REQUEST)

        _, error_response = _validate_order_slot_items(slot, menu_items, quantities_by_item_id)
        if error_response:
            return error_response

        list(
            Order.objects.select_for_update()
            .filter(slot=slot, status__in=_SLOT_ORDER_ACTIVE_STATUSES)
            .values_list('id', flat=True)
        )

        subtotal = sum(
            _menu_item_effective_price(menu_items[item_id], employee) * Decimal(quantity)
            for item_id, quantity in quantities_by_item_id.items()
        )

        effective_date, _ = _resolve_slot_effective_date_and_status(slot)
        order = Order.objects.create(
            order_code=_generate_order_code(),
            employee=employee,
            canteen=canteen,
            slot=slot,
            order_date=effective_date,
            status=OrderStatus.PENDING,
            subtotal=subtotal,
            total_amount=subtotal,
        )

        for item_id, quantity in quantities_by_item_id.items():
            menu_item = menu_items[item_id]
            item_price = _menu_item_effective_price(menu_item, employee)
            OrderItem.objects.create(
                order=order,
                menu_item=menu_item,
                item_name_snapshot=menu_item.name,
                unit_price=item_price,
                base_price_snapshot=menu_item.base_price,
                quantity=quantity,
            )

        OrderStatusLog.objects.create(
            order=order,
            from_status=None,
            to_status=OrderStatus.PENDING,
            changed_by=employee,
            changed_by_role=ChangedByRole.EMPLOYEE,
            note='Order placed by employee.',
        )

    order = (
        Order.objects
        .select_related('employee', 'employee__department')
        .prefetch_related('items')
        .get(pk=order.pk)
    )
    return Response(_serialize_order(order), status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsEmployeeOrAdmin])
def employee_order_cancel_view(request, order_id):
    employee = _current_employee(request)
    if employee is None:
        return Response({'detail': EMPLOYEE_NOT_FOUND_MESSAGE}, status=status.HTTP_404_NOT_FOUND)

    try:
        order = (
            Order.objects
            .select_related('employee', 'employee__department')
            .prefetch_related('items')
            .get(id=order_id, employee=employee)
        )
    except Order.DoesNotExist:
        return Response({'detail': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)

    if expire_order_if_needed(order):
        return Response({'detail': 'This order has expired and cannot be cancelled.'}, status=status.HTTP_400_BAD_REQUEST)

    if not order.can_cancel:
        return Response({'detail': 'Only placed orders can be cancelled.'}, status=status.HTTP_400_BAD_REQUEST)

    previous_status = order.status
    order.status = OrderStatus.CANCELLED
    order.cancelled_at = timezone.now()
    order.cancelled_by = employee
    order.cancellation_reason = request.data.get('reason') or 'Cancelled by employee.'
    order.save(update_fields=['status', 'cancelled_at', 'cancelled_by', 'cancellation_reason', 'updated_at'])

    OrderStatusLog.objects.create(
        order=order,
        from_status=previous_status,
        to_status=OrderStatus.CANCELLED,
        changed_by=employee,
        changed_by_role=ChangedByRole.EMPLOYEE,
        note=order.cancellation_reason,
    )

    return Response(_serialize_order(order), status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsEmployeeOrAdmin])
def employee_order_mark_delivered_view(request, order_id):
    """
    POST /orders/{id}/mark-delivered/
    Cafinity — Simplified Order Status: Print = Delivered
    """
    with transaction.atomic():
        order = (
            Order.objects
            .select_for_update()
            .select_related('employee', 'employee__department', 'slot')
            .prefetch_related('items')
            .filter(id=order_id)
            .first()
        )
        if order is None:
            return Response({'detail': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)

        if expire_order_if_needed(order):
            return Response({'detail': 'This order has expired.'}, status=status.HTTP_400_BAD_REQUEST)

        if order.status == OrderStatus.DELIVERED:
            return Response(_serialize_order(order), status=status.HTTP_200_OK)

        if not OrderStatus.can_transition(order.status, OrderStatus.DELIVERED):
            return Response(
                {'detail': f'Cannot mark order as delivered from {order.status}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        previous_status = order.status
        now = timezone.now()
        order.status = OrderStatus.DELIVERED
        order.collected_at = now
        order.receipt_printed_at = now
        order.save(update_fields=['status', 'collected_at', 'receipt_printed_at', 'updated_at'])

        OrderStatusLog.objects.create(
            order=order,
            from_status=previous_status,
            to_status=OrderStatus.DELIVERED,
            changed_by=_current_employee(request),
            changed_by_role=ChangedByRole.ADMIN,
            note='Order marked delivered (print action).',
        )

    order = (
        Order.objects
        .select_related('employee', 'employee__department', 'slot')
        .prefetch_related('items')
        .get(pk=order.id)
    )
    return Response(_serialize_order(order), status=status.HTTP_200_OK)
