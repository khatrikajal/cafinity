# Cafinity Security Fix Round 2 — VAPT June 2026 — Fix G+M (canteen IDOR + admin auth)
"""
apps/cms/views/admin.py

Admin dashboard and reporting endpoints for Cafinity CMS.

Endpoints:
  GET  /admin/dashboard/                  → Dashboard stats (today's orders, revenue, etc.)
  GET  /admin/orders/                     → List all orders with filters
  GET  /admin/reports/sales/              → Sales summary by slot/item
  GET  /admin/reports/customers/          → Customer list with order stats
  GET  /admin/reports/customers/{id}/orders/ → Customer order history
  POST /admin/wallet/fund/                → Add funds to employee wallet

All endpoints require authentication + admin role.
"""

from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
import logging

from django.db import DatabaseError
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Employee, RoleChoices
from apps.cms.models.canteen import CanteenLocation
from apps.cms.models.order import Order, OrderStatus
from apps.cms.models.slot import MealSlot
from apps.cms.models.wallet import CanteenWallet, WalletTransaction
from apps.cms.services.orders import expire_due_orders
from apps.cms.services.wallet import credit_wallet, get_or_create_wallet
from apps.common.permissions import IsEmployee, IsEmployeeOrAdmin, IsEmployeeOrFullAdmin, IsLimitedAdminOrHigher, IsCMSAdmin
from apps.core.canteen_scope import validate_canteen_access
from apps.core.permissions import IsAdminOrLimitedAdmin

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────────────────────────────────────

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
        .select_related('company', 'department')
        .filter(id=employee_id, is_active=True)
        .first()
    )


def _current_canteen(request, employee):
    company_id = getattr(request, 'tenant_company_id', None) or _token_value(request, 'company_id')
    if not company_id and employee and employee.company_id:
        company_id = employee.company_id

    qs = CanteenLocation.objects.filter(is_active=True, deleted_at__isnull=True)
    if company_id:
        qs = qs.filter(company_id=company_id)

    return qs.order_by('name').first()


def _accessible_canteens(request, employee):
    company_id = getattr(request, 'tenant_company_id', None) or _token_value(request, 'company_id')
    if not company_id and employee and employee.company_id:
        company_id = employee.company_id

    qs = CanteenLocation.objects.filter(is_active=True, deleted_at__isnull=True)
    if company_id:
        qs = qs.filter(company_id=company_id)

    role_type = _token_value(request, 'role_type')
    if role_type == RoleChoices.LIMITED_ADMIN and employee and employee.canteen_id:
        qs = qs.filter(id=employee.canteen_id)

    return qs.order_by('name')


def _requested_canteens(request, employee):
    canteens = _accessible_canteens(request, employee)
    requested_canteen_id = request.query_params.get('canteen_id', '').strip()
    if requested_canteen_id and requested_canteen_id.lower() != 'all':
        validate_canteen_access(request, requested_canteen_id)
        canteens = canteens.filter(id=requested_canteen_id)
    return canteens


def _is_limited_admin(request):
    return _token_value(request, 'role_type') == RoleChoices.LIMITED_ADMIN


def _redact_order_pii(request, row):
    if _is_limited_admin(request):
        row.pop('customerName', None)
        row.pop('customerId', None)
    return row


def _redact_customer_pii(request, row):
    if _is_limited_admin(request):
        row.pop('email', None)
        row.pop('phone', None)
        row.pop('name', None)
    return row


def _is_admin(request):
    """Check if current user has admin role."""
    role_type = _token_value(request, 'role_type')
    return role_type in RoleChoices.CMS_ADMIN_ROLES or role_type in RoleChoices.ALL_ADMIN_ROLES


def _status_to_frontend(value):
    return {
        OrderStatus.PENDING: 'pending',
        OrderStatus.PLACED: 'preparing',
        OrderStatus.PREPARING: 'preparing',
        OrderStatus.READY: 'ready',
        OrderStatus.DELIVERED: 'delivered',
        OrderStatus.CANCELLED: 'cancelled',
        OrderStatus.EXPIRED: 'expired',
    }.get(value, 'placed')


def _serialize_order(order, include_items=True, request=None):
    """Serialize order for admin views."""
    try:
        slot = order.slot
    except MealSlot.DoesNotExist:
        slot = None

    employee = order.employee

    result = {
        'id': str(order.id),
        'orderNumber': order.order_code,
        'customerId': str(employee.id),
        'customerName': employee.full_name,
        'department': employee.department.name if employee.department else '',
        'empId': employee.employee_code,
        'slotId': str(order.slot_id) if order.slot_id else '',
        'slotName': slot.name if slot else 'Slot',
        'subtotal': float(order.subtotal),
        'tax': 0,
        'total': float(order.total_amount),
        'totalAmount': float(order.total_amount),
        'status': _status_to_frontend(order.status),
        'paymentMethod': 'wallet',
        'createdAt': order.placed_at.isoformat(),
        'updatedAt': order.updated_at.isoformat(),
    }

    if include_items:
        result['items'] = [
            {
                'id': str(item.id),
                'orderId': str(order.id),
                'menuItemId': str(item.menu_item_id),
                'name': item.item_name_snapshot,
                'quantity': item.quantity,
                'unitPrice': float(item.unit_price),
                'price': float(item.unit_price),
                'totalPrice': float(item.line_total),
                'slotId': str(order.slot_id) if order.slot_id else '',
            }
            for item in order.items.all()
        ]

    result['statusLogs'] = [
        {
            'id': str(log.id),
            'fromStatus': _status_to_frontend(log.from_status) if log.from_status else None,
            'toStatus': _status_to_frontend(log.to_status),
            'changedAt': log.changed_at.isoformat(),
            'changedByRole': log.changed_by_role,
            'note': log.note or '',
        }
        for log in order.status_logs.all()
    ]

    if request is not None:
        _redact_order_pii(request, result)
    return result


def _parse_date(date_str):
    """Parse date string in various formats."""
    if not date_str:
        return None

    formats = ['%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y']
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Admin Dashboard
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminOrLimitedAdmin])
def admin_dashboard_view(request):
    """
    GET /admin/dashboard/

    Returns dashboard statistics with graceful degradation per metric.
    """
    return _admin_dashboard_view_impl(request)


def _admin_dashboard_view_impl(request):
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    data_warnings = []
    data = {
        'todayOrders': 0,
        'todayRevenue': 0.0,
        'slotCounts': [],
        'statusCounts': {
            'placed': 0,
            'preparing': 0,
            'ready': 0,
            'delivered': 0,
            'expired': 0,
        },
        'activeUsers': 0,
        'avgProcessingTime': 0,
        'data_warnings': data_warnings,
    }

    employee = _current_employee(request)
    try:
        canteens = _requested_canteens(request, employee)
    except Exception as exc:
        logger.error('Dashboard canteen scope error: %s', exc)
        data_warnings.append('canteen scope unavailable')
        return Response(data, status=status.HTTP_200_OK)

    if not canteens.exists():
        return Response(data, status=status.HTTP_200_OK)

    today = timezone.localdate()

    try:
        expire_due_orders(Order.objects.filter(canteen__in=canteens))
    except Exception as exc:
        logger.error('Dashboard expire_due_orders error: %s', exc)
        data_warnings.append('order expiry sync unavailable')

    today_orders = Order.objects.none()
    try:
        today_orders = Order.objects.filter(
            canteen__in=canteens,
            order_date=today,
        ).exclude(status=OrderStatus.CANCELLED)
        data['todayOrders'] = today_orders.count()
    except Exception as exc:
        logger.error('Dashboard today_orders error: %s', exc)
        data_warnings.append('today orders unavailable')

    try:
        today_revenue = today_orders.aggregate(total=Sum('total_amount'))['total'] or Decimal('0')
        data['todayRevenue'] = float(today_revenue)
    except Exception as exc:
        logger.error('Dashboard revenue error: %s', exc)
        data_warnings.append('revenue data unavailable')

    try:
        data['activeUsers'] = today_orders.values('employee_id').distinct().count()
    except Exception as exc:
        logger.error('Dashboard active_users error: %s', exc)
        data_warnings.append('active users unavailable')

    live_orders = Order.objects.none()
    try:
        live_orders = Order.objects.filter(
            canteen__in=canteens,
        ).exclude(
            status__in=[OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.EXPIRED]
        )
    except Exception as exc:
        logger.error('Dashboard live_orders error: %s', exc)
        data_warnings.append('live orders unavailable')

    try:
        data['slotCounts'] = [
            {
                'slotId': str(row['slot_id']) if row['slot_id'] else '',
                'slot': row['slot__name'] or 'Unassigned',
                'orders': row['orders'],
            }
            for row in (
                live_orders
                .values('slot_id', 'slot__name')
                .annotate(orders=Count('id'))
                .order_by('slot__start_time', 'slot__name')
            )
        ]
    except Exception as exc:
        logger.error('Dashboard slot_counts error: %s', exc)
        data_warnings.append('slot counts unavailable')

    try:
        data['statusCounts'] = {
            'placed': 0,
            'preparing': live_orders.filter(
                status__in=[OrderStatus.PENDING, OrderStatus.PLACED, OrderStatus.PREPARING]
            ).count(),
            'ready': live_orders.filter(status=OrderStatus.READY).count(),
            'delivered': today_orders.filter(status=OrderStatus.DELIVERED).count(),
            'expired': today_orders.filter(status=OrderStatus.EXPIRED).count(),
        }
    except Exception as exc:
        logger.error('Dashboard status_counts error: %s', exc)
        data_warnings.append('status counts unavailable')

    try:
        delivered_orders = today_orders.filter(
            status=OrderStatus.DELIVERED,
            collected_at__isnull=False,
        )
        if delivered_orders.exists():
            total_time = timedelta()
            count = 0
            for order in delivered_orders:
                if order.collected_at and order.placed_at:
                    total_time += (order.collected_at - order.placed_at)
                    count += 1
            if count > 0:
                data['avgProcessingTime'] = int(total_time.total_seconds() / 60 / count)
    except Exception as exc:
        logger.error('Dashboard avg_processing_time error: %s', exc)
        data_warnings.append('processing time unavailable')

    return Response(data, status=status.HTTP_200_OK)


# ──────────────────────────────────────────────────────────────────────────────
# Admin Orders List
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminOrLimitedAdmin])
def admin_orders_view(request):
    """
    GET /admin/orders/

    List all orders with filtering and pagination.

    Query params:
    - status: filter by status (placed, preparing, ready, delivered, cancelled)
    - slot_id: filter by slot UUID
    - date_from: filter orders from this date (YYYY-MM-DD)
    - date_to: filter orders up to this date (YYYY-MM-DD)
    - range: quick date filter (today, 7d, 30d, all)
    - search: search by order code, customer name, or employee code
    - live_only: if 'true', exclude delivered/cancelled orders
    - page: page number (default 1)
    - page_size: items per page (default 10, max 100)
    """
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    employee = _current_employee(request)
    canteens = _requested_canteens(request, employee)

    if not canteens.exists():
        return Response({'detail': 'No active canteen found.'}, status=status.HTTP_404_NOT_FOUND)

    # Build queryset
    expire_due_orders(Order.objects.filter(canteen__in=canteens))

    queryset = (
        Order.objects
        .filter(canteen__in=canteens)
        .select_related('employee', 'employee__department', 'slot')
        .prefetch_related('items')
        .order_by('-placed_at')
    )

    # Status filter
    status_param = request.query_params.get('status', '').strip().lower()
    status_map = {
        'placed': OrderStatus.PLACED,
        'pending': OrderStatus.PLACED,
        'preparing': [OrderStatus.PLACED, OrderStatus.PREPARING],
        'ready': OrderStatus.READY,
        'delivered': OrderStatus.DELIVERED,
        'cancelled': OrderStatus.CANCELLED,
        'expired': OrderStatus.EXPIRED,
    }
    if status_param in status_map:
        status_value = status_map[status_param]
        if isinstance(status_value, list):
            queryset = queryset.filter(status__in=status_value)
        else:
            queryset = queryset.filter(status=status_value)

    # Live only filter
    live_only = request.query_params.get('live_only', '').lower() == 'true'
    if live_only:
        queryset = queryset.exclude(
            status__in=[OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.EXPIRED]
        )

    # Slot filter
    slot_id = request.query_params.get('slot_id', '').strip()
    if slot_id:
        queryset = queryset.filter(slot_id=slot_id)

    # Date range filter
    range_param = request.query_params.get('range', '').strip().lower()
    today = timezone.localdate()

    if range_param == 'today':
        queryset = queryset.filter(order_date=today)
    elif range_param == '7d':
        date_from = today - timedelta(days=7)
        queryset = queryset.filter(order_date__gte=date_from)
    elif range_param == '30d':
        date_from = today - timedelta(days=30)
        queryset = queryset.filter(order_date__gte=date_from)
    else:
        # Custom date range
        date_from = _parse_date(request.query_params.get('date_from', ''))
        date_to = _parse_date(request.query_params.get('date_to', ''))

        if date_from:
            queryset = queryset.filter(order_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(order_date__lte=date_to)

    # Search filter
    search = request.query_params.get('search', '').strip()
    if search:
        queryset = queryset.filter(
            Q(order_code__icontains=search) |
            Q(employee__first_name__icontains=search) |
            Q(employee__last_name__icontains=search) |
            Q(employee__employee_code__icontains=search)
        )

    # Pagination
    try:
        page = max(1, int(request.query_params.get('page', 1)))
        page_size = min(100, max(1, int(request.query_params.get('page_size', 10))))
    except (ValueError, TypeError):
        page = 1
        page_size = 10

    total_count = queryset.count()
    total_pages = max(1, (total_count + page_size - 1) // page_size)

    start = (page - 1) * page_size
    end = start + page_size

    orders = list(queryset[start:end])

    return Response({
        'results': [_serialize_order(order, request=request) for order in orders],
        'count': total_count,
        'page': page,
        'pageSize': page_size,
        'totalPages': total_pages,
    })


# ──────────────────────────────────────────────────────────────────────────────
# Admin Reports - Sales Summary
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminOrLimitedAdmin])
def admin_sales_report_view(request):
    """
    GET /admin/reports/sales/

    Sales summary grouped by slot and item.

    Query params:
    - date_from: filter orders from this date
    - date_to: filter orders up to this date
    - range: quick date filter (today, 7d, 30d, all)
    - page: page number (default 1)
    - page_size: items per page (default 10)
    """
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    employee = _current_employee(request)
    canteen = _current_canteen(request, employee)

    if canteen is None:
        return Response({'detail': 'No active canteen found.'}, status=status.HTTP_404_NOT_FOUND)

    # Build base queryset (billable orders only - delivered, not cancelled)
    queryset = (
        Order.objects
        .filter(canteen=canteen)
        .exclude(status=OrderStatus.CANCELLED)
        .select_related('slot')
        .prefetch_related('items')
    )

    # Date range filter
    range_param = request.query_params.get('range', '').strip().lower()
    today = timezone.localdate()

    if range_param == 'today':
        queryset = queryset.filter(order_date=today)
    elif range_param == '7d':
        date_from = today - timedelta(days=7)
        queryset = queryset.filter(order_date__gte=date_from)
    elif range_param == '30d':
        date_from = today - timedelta(days=30)
        queryset = queryset.filter(order_date__gte=date_from)
    elif range_param != 'all':
        date_from = _parse_date(request.query_params.get('date_from', ''))
        date_to = _parse_date(request.query_params.get('date_to', ''))

        if date_from:
            queryset = queryset.filter(order_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(order_date__lte=date_to)

    # Aggregate sales by slot and item
    sales_data = defaultdict(lambda: {'quantity': 0, 'revenue': Decimal('0')})

    for order in queryset:
        slot_name = order.slot.name if order.slot else 'Unassigned'
        for item in order.items.all():
            key = (slot_name, item.item_name_snapshot)
            sales_data[key]['quantity'] += item.quantity
            sales_data[key]['revenue'] += item.line_total

    # Convert to list and sort
    sales_rows = [
        {
            'slot': slot,
            'item': item,
            'quantity': data['quantity'],
            'revenue': float(data['revenue'])
        }
        for (slot, item), data in sales_data.items()
    ]
    sales_rows.sort(key=lambda x: (x['slot'], -x['revenue']))

    # Pagination
    try:
        page = max(1, int(request.query_params.get('page', 1)))
        page_size = min(100, max(1, int(request.query_params.get('page_size', 10))))
    except (ValueError, TypeError):
        page = 1
        page_size = 10

    total_count = len(sales_rows)
    total_pages = max(1, (total_count + page_size - 1) // page_size)

    start = (page - 1) * page_size
    end = start + page_size

    # Summary stats
    total_units = sum(row['quantity'] for row in sales_rows)
    total_revenue = sum(row['revenue'] for row in sales_rows)

    return Response({
        'results': sales_rows[start:end],
        'count': total_count,
        'page': page,
        'pageSize': page_size,
        'totalPages': total_pages,
        'totalUnits': total_units,
        'totalRevenue': total_revenue,
    })


# ──────────────────────────────────────────────────────────────────────────────
# Admin Reports - Customer Reports
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsCMSAdmin])
def admin_customer_report_view(request):
    """
    GET /admin/reports/customers/

    Customer list with order statistics.

    Query params:
    - date_from: filter orders from this date
    - date_to: filter orders up to this date
    - range: quick date filter (month, 30d, all)
    - search: search by name, employee code, or department
    - page: page number (default 1)
    - page_size: items per page (default 8)
    """
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    employee = _current_employee(request)
    canteen = _current_canteen(request, employee)

    if canteen is None:
        return Response({'detail': 'No active canteen found.'}, status=status.HTTP_404_NOT_FOUND)

    # Get company from canteen
    company_id = canteen.company_id

    # Get all employees for this company
    employees_qs = Employee.objects.filter(
        company_id=company_id,
        is_active=True
    ).select_related('department')

    # Search filter
    search = request.query_params.get('search', '').strip()
    if search:
        employees_qs = employees_qs.filter(
            Q(first_name__icontains=search) |
            Q(last_name__icontains=search) |
            Q(employee_code__icontains=search) |
            Q(department__name__icontains=search)
        )

    employees = list(employees_qs.order_by('first_name', 'last_name'))

    # Build base order queryset
    orders_qs = (
        Order.objects
        .filter(canteen=canteen)
        .exclude(status=OrderStatus.CANCELLED)
        .prefetch_related('items')
    )

    # Date range filter
    range_param = request.query_params.get('range', '').strip().lower()
    today = timezone.localdate()

    if range_param == 'month':
        # This month
        first_of_month = today.replace(day=1)
        orders_qs = orders_qs.filter(order_date__gte=first_of_month)
    elif range_param == '30d':
        date_from = today - timedelta(days=30)
        orders_qs = orders_qs.filter(order_date__gte=date_from)
    elif range_param != 'all':
        date_from = _parse_date(request.query_params.get('date_from', ''))
        date_to = _parse_date(request.query_params.get('date_to', ''))

        if date_from:
            orders_qs = orders_qs.filter(order_date__gte=date_from)
        if date_to:
            orders_qs = orders_qs.filter(order_date__lte=date_to)

    # Aggregate orders by employee
    employee_stats = defaultdict(lambda: {'orderCount': 0, 'meals': 0, 'total': Decimal('0')})

    for order in orders_qs.select_related('employee'):
        emp_id = str(order.employee_id)
        employee_stats[emp_id]['orderCount'] += 1
        employee_stats[emp_id]['total'] += order.total_amount
        for item in order.items.all():
            employee_stats[emp_id]['meals'] += item.quantity

    # Build customer rows
    customer_rows = []
    for emp in employees:
        stats = employee_stats.get(str(emp.id), {'orderCount': 0, 'meals': 0, 'total': Decimal('0')})

        # Get wallet balance
        wallet_balance = Decimal('0')
        try:
            wallet = CanteenWallet.objects.get(employee=emp)
            wallet_balance = wallet.balance
        except CanteenWallet.DoesNotExist:
            pass

        customer_rows.append(_redact_customer_pii(request, {
            'id': str(emp.id),
            'name': emp.full_name,
            'empId': emp.employee_code,
            'department': emp.department.name if emp.department else '',
            'email': emp.email,
            'phone': emp.phone or '',
            'walletBalance': float(wallet_balance),
            'orderCount': stats['orderCount'],
            'meals': stats['meals'],
            'total': float(stats['total']),
            'createdAt': emp.created_at.isoformat(),
        }))

    # Pagination
    try:
        page = max(1, int(request.query_params.get('page', 1)))
        page_size = min(100, max(1, int(request.query_params.get('page_size', 8))))
    except (ValueError, TypeError):
        page = 1
        page_size = 8

    total_count = len(customer_rows)
    total_pages = max(1, (total_count + page_size - 1) // page_size)

    start = (page - 1) * page_size
    end = start + page_size

    # Summary stats
    total_revenue = sum(row['total'] for row in customer_rows)
    lifetime_revenue = Order.objects.filter(
        canteen=canteen
    ).exclude(
        status=OrderStatus.CANCELLED
    ).aggregate(total=Sum('total_amount'))['total'] or Decimal('0')

    return Response({
        'results': customer_rows[start:end],
        'count': total_count,
        'page': page,
        'pageSize': page_size,
        'totalPages': total_pages,
        'totalRevenue': float(total_revenue),
        'lifetimeRevenue': float(lifetime_revenue),
    })


# ──────────────────────────────────────────────────────────────────────────────
# Admin Reports - Customer Order History
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsCMSAdmin])
def admin_customer_orders_view(request, customer_id):
    """
    GET /admin/reports/customers/{customer_id}/orders/

    Get order history for a specific customer.

    Query params:
    - date_from: filter orders from this date
    - date_to: filter orders up to this date
    - range: quick date filter (month, 30d, all)
    - page: page number (default 1)
    - page_size: items per page (default 8)
    """
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    employee = _current_employee(request)
    canteen = _current_canteen(request, employee)

    if canteen is None:
        return Response({'detail': 'No active canteen found.'}, status=status.HTTP_404_NOT_FOUND)

    # Get customer
    try:
        customer = Employee.objects.select_related('department').get(id=customer_id, is_active=True)
    except Employee.DoesNotExist:
        return Response({'detail': 'Customer not found.'}, status=status.HTTP_404_NOT_FOUND)

    # Build order queryset
    queryset = (
        Order.objects
        .filter(canteen=canteen, employee=customer)
        .exclude(status=OrderStatus.CANCELLED)
        .select_related('slot')
        .prefetch_related('items')
        .order_by('-placed_at')
    )

    # Date range filter
    range_param = request.query_params.get('range', '').strip().lower()
    today = timezone.localdate()

    if range_param == 'month':
        first_of_month = today.replace(day=1)
        queryset = queryset.filter(order_date__gte=first_of_month)
    elif range_param == '30d':
        date_from = today - timedelta(days=30)
        queryset = queryset.filter(order_date__gte=date_from)
    elif range_param != 'all':
        date_from = _parse_date(request.query_params.get('date_from', ''))
        date_to = _parse_date(request.query_params.get('date_to', ''))

        if date_from:
            queryset = queryset.filter(order_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(order_date__lte=date_to)

    # Pagination
    try:
        page = max(1, int(request.query_params.get('page', 1)))
        page_size = min(100, max(1, int(request.query_params.get('page_size', 8))))
    except (ValueError, TypeError):
        page = 1
        page_size = 8

    total_count = queryset.count()
    total_pages = max(1, (total_count + page_size - 1) // page_size)

    start = (page - 1) * page_size
    end = start + page_size

    orders = list(queryset[start:end])

    # Summary stats
    all_orders = queryset.all()
    total_spent = sum(order.total_amount for order in all_orders)
    total_meals = sum(
        item.quantity
        for order in all_orders
        for item in order.items.all()
    )

    return Response({
        'customer': {
            'id': str(customer.id),
            'name': customer.full_name,
            'empId': customer.employee_code,
            'department': customer.department.name if customer.department else '',
        },
        'results': [_serialize_order(order, request=request) for order in orders],
        'count': total_count,
        'page': page,
        'pageSize': page_size,
        'totalPages': total_pages,
        'totalSpent': float(total_spent),
        'totalMeals': total_meals,
    })


# ──────────────────────────────────────────────────────────────────────────────
# Admin Wallet - Add Funds
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated, IsEmployeeOrAdmin])
def admin_wallet_fund_view(request):
    """
    POST /admin/wallet/fund/

    Add funds to an employee's wallet.

    Body:
    - employee_id: UUID of the employee (required)
    - emp_id: Employee code (alternative to employee_id)
    - amount: Amount to add (required, positive number)
    - reason: Reason for adding funds (optional)
    """
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    admin_employee = _current_employee(request)

    # Get employee by ID or employee code
    employee_id = request.data.get('employee_id')
    emp_code = request.data.get('emp_id', '').strip()

    employee = None
    if employee_id:
        try:
            employee = Employee.objects.get(id=employee_id, is_active=True)
        except Employee.DoesNotExist:
            pass

    if not employee and emp_code:
        employee = Employee.objects.filter(
            employee_code__iexact=emp_code,
            is_active=True
        ).first()

    if not employee:
        return Response({'detail': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

    # Validate amount
    try:
        amount = Decimal(str(request.data.get('amount', 0)))
    except (TypeError, ValueError):
        return Response({'amount': 'Invalid amount.'}, status=status.HTTP_400_BAD_REQUEST)

    if amount <= 0:
        return Response({'amount': 'Amount must be positive.'}, status=status.HTTP_400_BAD_REQUEST)

    reason = request.data.get('reason', '').strip() or 'Admin credit'

    # Add funds
    try:
        wallet = get_or_create_wallet(employee)
        credit_wallet(
            employee=employee,
            amount=amount,
            description=reason,
            reference=f"ADMIN-CREDIT-{timezone.now().strftime('%Y%m%d%H%M%S')}",
        )

        # Refresh wallet balance
        wallet.refresh_from_db()

        return Response({
            'success': True,
            'employee': {
                'id': str(employee.id),
                'name': employee.full_name,
                'empId': employee.employee_code,
            },
            'amount': float(amount),
            'newBalance': float(wallet.balance),
        })
    except Exception as e:
        return Response({'detail': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated, IsEmployeeOrAdmin])
def admin_wallet_monthly_limit_view(request):
    """
    POST /admin/wallet/monthly-limit/

    Set or clear monthly spending limit for an employee wallet.

    Body:
    - employee_id: UUID of the employee (required)
    - monthly_limit: positive number, or null/empty to clear the limit
    """
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    employee_id = request.data.get('employee_id')
    if not employee_id:
        return Response({'employee_id': 'employee_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(id=employee_id, is_active=True)
    except Employee.DoesNotExist:
        return Response({'detail': 'Employee not found.'}, status=status.HTTP_404_NOT_FOUND)

    raw_limit = request.data.get('monthly_limit', None)
    monthly_limit = None

    if raw_limit not in [None, '', 'null']:
        try:
            monthly_limit = Decimal(str(raw_limit))
        except (TypeError, ValueError):
            return Response({'monthly_limit': 'Invalid monthly limit.'}, status=status.HTTP_400_BAD_REQUEST)

        if monthly_limit <= 0:
            return Response({'monthly_limit': 'Monthly limit must be positive.'}, status=status.HTTP_400_BAD_REQUEST)

    wallet = get_or_create_wallet(employee)
    wallet.monthly_spending_limit = monthly_limit
    wallet.save(update_fields=['monthly_spending_limit', 'updated_at'])

    return Response({
        'success': True,
        'employee': {
            'id': str(employee.id),
            'name': employee.full_name,
            'empId': employee.employee_code,
        },
        'monthlyLimit': float(wallet.monthly_spending_limit) if wallet.monthly_spending_limit is not None else None,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated, IsEmployeeOrAdmin])
def admin_employee_search_view(request):
    """
    GET /admin/employees/search/

    Search employees by employee code.

    Query params:
    - emp_id: Employee code to search
    """
    if not _is_admin(request):
        return Response({'detail': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    emp_code = request.query_params.get('emp_id', '').strip()

    if not emp_code:
        return Response({'detail': 'emp_id parameter required.'}, status=status.HTTP_400_BAD_REQUEST)

    employee = Employee.objects.filter(
        employee_code__iexact=emp_code,
        is_active=True
    ).select_related('department').first()

    if not employee:
        return Response({'found': False, 'employee': None})

    # Get wallet balance
    wallet_balance = Decimal('0')
    try:
        wallet = CanteenWallet.objects.get(employee=employee)
        wallet_balance = wallet.balance
    except CanteenWallet.DoesNotExist:
        pass

    return Response({
        'found': True,
        'employee': {
            'id': str(employee.id),
            'name': employee.full_name,
            'empId': employee.employee_code,
            'department': employee.department.name if employee.department else '',
            'email': employee.email,
            'walletBalance': float(wallet_balance),
        }
    })


# ──────────────────────────────────────────────────────────────────────────────
# Debug - Slot Diagnostics
# ──────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsEmployeeOrAdmin])
def admin_debug_slots_view(request):
    """
    GET /admin/debug/slots/

    Debug endpoint to diagnose why slots might not be showing in the employee dashboard.
    Returns all slots and their filtering status.
    """
    from apps.cms.models.menu import CanteenMenuItem
    from apps.cms.models.slot import SlotMenuItem

    employee = _current_employee(request)
    canteen = _current_canteen(request, employee)

    today = timezone.localdate()
    now = timezone.localtime().time()

    # Get all canteens
    all_canteens = list(CanteenLocation.objects.all().values(
        'id', 'name', 'is_active', 'company_id'
    ))

    # Get current canteen info
    canteen_info = None
    if canteen:
        canteen_info = {
            'id': str(canteen.id),
            'name': canteen.name,
            'is_active': canteen.is_active,
            'company_id': str(canteen.company_id),
        }

    # Get all slots (unfiltered)
    all_slots = list(MealSlot.objects.all().order_by('-date', 'start_time'))

    # Get slots that would pass the filter
    if canteen:
        filtered_slots = list(
            MealSlot.objects
            .filter(canteen=canteen, date=today, is_active=True)
            .order_by('start_time', 'name')
        )
    else:
        filtered_slots = []

    # Build diagnostic info for all slots
    slot_diagnostics = []
    for slot in all_slots:
        # Check each filter condition
        issues = []
        passes_filter = True

        if canteen and str(slot.canteen_id) != str(canteen.id):
            issues.append(f"Wrong canteen: slot belongs to {slot.canteen_id}, but user's canteen is {canteen.id}")
            passes_filter = False

        if slot.date != today:
            issues.append(f"Wrong date: slot date is {slot.date}, but today is {today}")
            passes_filter = False

        if not slot.is_active:
            issues.append("is_active=False: Slot is deactivated")
            passes_filter = False

        # Check time status
        time_status = 'unknown'
        if slot.date < today:
            time_status = 'expired (past date)'
        elif slot.date > today:
            time_status = 'future'
        elif now < slot.start_time:
            time_status = 'upcoming (not started yet)'
        elif slot.start_time <= now <= slot.end_time:
            time_status = 'active (current time within window)'
        else:
            time_status = 'expired (past end time)'

        # Get slot menu items
        slot_items = list(SlotMenuItem.objects.filter(slot=slot).values(
            'menu_item_id', 'is_enabled'
        ))
        enabled_items = [si for si in slot_items if si['is_enabled']]

        if passes_filter and len(enabled_items) == 0:
            issues.append("No SlotMenuItem records: Items won't appear without linking menu items to this slot")

        slot_diagnostics.append({
            'id': str(slot.id),
            'name': slot.name,
            'canteen_id': str(slot.canteen_id),
            'date': slot.date.isoformat(),
            'start_time': slot.start_time.strftime('%H:%M'),
            'end_time': slot.end_time.strftime('%H:%M'),
            'is_active': slot.is_active,
            'meal_type': slot.meal_type,
            'passes_filter': passes_filter and len(issues) == 0,
            'time_status': time_status,
            'issues': issues if issues else ['OK - This slot should be visible'],
            'slot_items_count': len(slot_items),
            'enabled_items_count': len(enabled_items),
        })

    # Get all menu items in the canteen
    menu_items_info = []
    if canteen:
        menu_items = list(CanteenMenuItem.objects.filter(canteen=canteen).values(
            'id', 'name', 'is_active', 'is_available', 'item_type', 'category__name'
        ))
        menu_items_info = [
            {
                'id': str(item['id']),
                'name': item['name'],
                'is_active': item['is_active'],
                'is_available': item['is_available'],
                'item_type': item['item_type'],
                'category': item['category__name'],
                'would_show': item['is_active'] and item['is_available'],
            }
            for item in menu_items
        ]

    return Response({
        'debug_info': {
            'server_date': today.isoformat(),
            'server_time': now.strftime('%H:%M:%S'),
            'timezone': str(timezone.get_current_timezone()),
        },
        'current_canteen': canteen_info,
        'all_canteens': [
            {
                'id': str(c['id']),
                'name': c['name'],
                'is_active': c['is_active'],
                'company_id': str(c['company_id']),
            }
            for c in all_canteens
        ],
        'filter_criteria': {
            'canteen_id': str(canteen.id) if canteen else None,
            'date': today.isoformat(),
            'is_active': True,
            'label_not': 'CLOSED',
        },
        'total_slots_in_db': len(all_slots),
        'slots_passing_filter': len(filtered_slots),
        'slot_diagnostics': slot_diagnostics,
        'menu_items': menu_items_info,
        'summary': {
            'slots_for_today': len([s for s in slot_diagnostics if s['date'] == today.isoformat()]),
            'active_slots': len([s for s in slot_diagnostics if s['is_active']]),
            'slots_with_items': len([s for s in slot_diagnostics if s['enabled_items_count'] > 0]),
        }
    })
