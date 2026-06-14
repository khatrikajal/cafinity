"""Optimized queryset selectors for reports."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Count, DecimalField, F, Q, Sum
from django.db.models.functions import Coalesce, TruncDate, TruncMonth, TruncWeek
from django.utils import timezone

from apps.accounts.models import Employee
from apps.cms.models.order import Order, OrderStatus
from apps.cms.models.slot import MealSlot

LIVE_STATUSES = [OrderStatus.PLACED, OrderStatus.PREPARING, OrderStatus.READY]
FINISHED_STATUSES = [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.EXPIRED]


@dataclass(frozen=True)
class ReportWindow:
    date_from: object | None
    date_to: object | None
    tz: ZoneInfo


def resolve_timezone(value: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(value or timezone.get_current_timezone_name())
    except Exception:
        return ZoneInfo(timezone.get_current_timezone_name())


def resolve_window(params: dict) -> ReportWindow:
    tz = resolve_timezone(params.get("timezone"))
    today = timezone.localdate()
    range_name = (params.get("range") or "").lower()
    date_from = params.get("date_from")
    date_to = params.get("date_to")

    if range_name == "today":
        return ReportWindow(today, today, tz)
    if range_name == "7d":
        return ReportWindow(today - timedelta(days=7), today, tz)
    if range_name == "30d":
        return ReportWindow(today - timedelta(days=30), today, tz)
    if range_name == "month":
        return ReportWindow(today.replace(day=1), today, tz)

    return ReportWindow(date_from, date_to, tz)


def _apply_date_filters(queryset, window: ReportWindow):
    if window.date_from:
        queryset = queryset.filter(order_date__gte=window.date_from)
    if window.date_to:
        queryset = queryset.filter(order_date__lte=window.date_to)
    return queryset


def base_order_queryset(canteen, params: dict, include_cancelled: bool = True):
    qs = (
        Order.objects.filter(canteen=canteen)
        .select_related("employee", "employee__department", "slot", "cancelled_by", "accepted_by")
        .prefetch_related("items")
        .order_by("-placed_at")
    )
    window = resolve_window(params)
    qs = _apply_date_filters(qs, window)

    if not include_cancelled:
        qs = qs.exclude(status=OrderStatus.CANCELLED)

    status_value = (params.get("status") or "").strip().lower()
    status_map = {
        "placed": OrderStatus.PLACED,
        "pending": OrderStatus.PLACED,
        "preparing": OrderStatus.PREPARING,
        "ready": OrderStatus.READY,
        "delivered": OrderStatus.DELIVERED,
        "cancelled": OrderStatus.CANCELLED,
        "expired": OrderStatus.EXPIRED,
    }
    if status_value in status_map:
        qs = qs.filter(status=status_map[status_value])

    slot_id = params.get("slot_id")
    if slot_id:
        qs = qs.filter(slot_id=slot_id)

    employee_id = params.get("employee_id")
    if employee_id:
        qs = qs.filter(employee_id=employee_id)

    search = (params.get("search") or "").strip()
    if search:
        qs = qs.filter(
            Q(order_code__icontains=search)
            | Q(employee__first_name__icontains=search)
            | Q(employee__last_name__icontains=search)
            | Q(employee__employee_code__icontains=search)
            | Q(slot__name__icontains=search)
        )

    if (params.get("live_only") or "").lower() == "true":
        qs = qs.exclude(status__in=FINISHED_STATUSES)

    return qs


def paginate_queryset(qs, params: dict):
    page = int(params.get("page") or 1)
    page_size = int(params.get("page_size") or 10)
    count = qs.count()
    total_pages = max(1, (count + page_size - 1) // page_size)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "results": list(qs[start:end]),
        "count": count,
        "page": page,
        "pageSize": page_size,
        "totalPages": total_pages,
    }


def orders_report_queryset(canteen, params: dict):
    return base_order_queryset(canteen, params, include_cancelled=True)


def cancelled_orders_queryset(canteen, params: dict):
    params = dict(params)
    params["status"] = "cancelled"
    return base_order_queryset(canteen, params, include_cancelled=True)


def revenue_rows(canteen, params: dict):
    qs = base_order_queryset(canteen, params, include_cancelled=False)
    rows = defaultdict(lambda: {"quantity": 0, "revenue": Decimal("0")})
    for order in qs.prefetch_related("items"):
        slot_name = order.slot.name if order.slot else "Unassigned"
        for item in order.items.all():
            key = (slot_name, item.item_name_snapshot)
            rows[key]["quantity"] += item.quantity
            rows[key]["revenue"] += item.line_total
    return [
        {"slot": slot, "item": item, "quantity": payload["quantity"], "revenue": float(payload["revenue"])}
        for (slot, item), payload in rows.items()
    ]


def item_sales_rows(canteen, params: dict):
    qs = base_order_queryset(canteen, params, include_cancelled=False)
    rows = defaultdict(lambda: {"quantity": 0, "revenue": Decimal("0")})
    for order in qs.prefetch_related("items"):
        for item in order.items.all():
            key = (str(item.menu_item_id), item.item_name_snapshot)
            rows[key]["quantity"] += item.quantity
            rows[key]["revenue"] += item.line_total
    return [
        {"menuItemId": menu_item_id, "item": item, "quantity": payload["quantity"], "revenue": float(payload["revenue"])}
        for (menu_item_id, item), payload in rows.items()
    ]


def slot_utilization_rows(canteen, params: dict):
    qs = base_order_queryset(canteen, params, include_cancelled=False)
    slot_ids = list(qs.values_list("slot_id", flat=True).distinct())
    slots = MealSlot.objects.filter(id__in=slot_ids).select_related("canteen")
    rows = []
    for slot in slots:
        orders = qs.filter(slot=slot)
        total_orders = orders.count()
        total_items = orders.aggregate(total=Coalesce(Sum("items__quantity"), 0))['total'] or 0
        rows.append({
            "slotId": str(slot.id),
            "slot": slot.name,
            "date": slot.date.isoformat(),
            "capacity": slot.capacity,
            "orders": total_orders,
            "items": int(total_items),
            "utilization": round((total_orders / slot.capacity) * 100, 2) if slot.capacity else 0,
        })
    return rows


def employee_activity_rows(canteen, params: dict):
    qs = base_order_queryset(canteen, params, include_cancelled=False)
    rows = defaultdict(lambda: {"orderCount": 0, "meals": 0, "total": Decimal("0")})
    for order in qs.prefetch_related("items"):
        emp_id = str(order.employee_id)
        rows[emp_id]["orderCount"] += 1
        rows[emp_id]["total"] += order.total_amount
        rows[emp_id]["meals"] += sum(item.quantity for item in order.items.all())

    employees = Employee.objects.filter(id__in=[key for key in rows.keys()]).select_related("department")
    employee_map = {str(emp.id): emp for emp in employees}
    payload = []
    for emp_id, stats in rows.items():
        employee = employee_map.get(emp_id)
        if not employee:
            continue
        payload.append({
            "id": emp_id,
            "name": employee.full_name,
            "empId": employee.employee_code,
            "department": employee.department.name if employee.department else "",
            "orderCount": stats["orderCount"],
            "meals": stats["meals"],
            "total": float(stats["total"]),
        })
    return payload


def period_rollup_rows(canteen, params: dict):
    qs = base_order_queryset(canteen, params, include_cancelled=False)
    group_by = (params.get("group_by") or "day").lower()
    date_expr = TruncDate("placed_at")
    if group_by == "week":
        date_expr = TruncWeek("placed_at")
    elif group_by == "month":
        date_expr = TruncMonth("placed_at")

    rows = (
        qs.annotate(period=date_expr)
        .values("period")
        .annotate(
            orderCount=Count("id"),
            totalRevenue=Coalesce(Sum("total_amount"), 0),
        )
        .order_by("period")
    )
    return [
        {
            "period": row["period"].isoformat() if row["period"] else "unknown",
            "orderCount": row["orderCount"],
            "totalRevenue": float(row["totalRevenue"]),
        }
        for row in rows
    ]
