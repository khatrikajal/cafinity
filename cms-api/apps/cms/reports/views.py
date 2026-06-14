# Cafinity Security Fix Round 2 — VAPT June 2026 — Fix G+M (canteen scope + report PII)
"""Report API endpoints."""

from __future__ import annotations

from django.db.models import Count, Sum
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import RoleChoices
from apps.cms.models import Order
from apps.cms.models.order import OrderStatus
from apps.cms.services.orders import expire_due_orders
from apps.core.permissions import IsAdminOrLimitedAdmin
from apps.common.auth_utils import get_effective_role
from apps.cms.reports.filters import ReportQuerySerializer
from apps.cms.reports.selectors import (
    cancelled_orders_queryset,
    employee_activity_rows,
    item_sales_rows,
    orders_report_queryset,
    paginate_queryset,
    period_rollup_rows,
    revenue_rows,
    slot_utilization_rows,
)
from apps.cms.reports.services import cache_key, csv_response, excel_response, envelope, get_cached_report, set_cached_report


class ReportViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, IsAdminOrLimitedAdmin]

    @staticmethod
    def _redact_order_row(request, row):
        if get_effective_role(request) == RoleChoices.LIMITED_ADMIN:
            row.pop('customerName', None)
            row.pop('customerId', None)
        return row

    @staticmethod
    def _redact_cancelled_row(request, row):
        if get_effective_role(request) == RoleChoices.LIMITED_ADMIN:
            row.pop('customerName', None)
        return row

    def _current_canteen(self, request):
        try:
            from apps.cms.views.admin import _current_canteen as admin_current_canteen
            from apps.cms.views.admin import _current_employee as admin_current_employee
            from apps.cms.views.admin import _requested_canteens as admin_requested_canteens
        except Exception:
            return None
        employee = admin_current_employee(request)
        requested_canteen_id = request.query_params.get("canteen_id", "").strip()
        if requested_canteen_id and requested_canteen_id.lower() != "all":
            return admin_requested_canteens(request, employee).first()
        return admin_current_canteen(request, employee)

    def _is_admin(self, request):
        token = getattr(request, "auth", None)
        role = token.get("role_type") if token else ""
        return role in RoleChoices.CMS_ADMIN_ROLES or role in RoleChoices.ALL_ADMIN_ROLES

    def _parse_params(self, request):
        serializer = ReportQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    def _can_access(self, request):
        if not self._is_admin(request):
            return Response({"detail": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)
        canteen = self._current_canteen(request)
        if canteen is None:
            return Response({"detail": "No active canteen found."}, status=status.HTTP_404_NOT_FOUND)
        return canteen

    @action(detail=False, methods=["get"], url_path="orders")
    def orders(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        expire_due_orders(Order.objects.filter(canteen=canteen))
        qs = orders_report_queryset(canteen, params)
        data = paginate_queryset(qs, params)
        results = [
            self._redact_order_row(
                request,
                {
                    "id": str(order.id),
                    "orderNumber": order.order_code,
                    "customerId": str(order.employee_id),
                    "customerName": order.employee.full_name,
                    "empId": order.employee.employee_code,
                    "department": order.employee.department.name if order.employee.department else "",
                    "slotId": str(order.slot_id) if order.slot_id else "",
                    "slotName": order.slot.name if order.slot else "Slot",
                    "subtotal": float(order.subtotal),
                    "total": float(order.total_amount),
                    "status": order.status.lower(),
                    "createdAt": order.placed_at.isoformat(),
                    "updatedAt": order.updated_at.isoformat(),
                    "items": [
                        {
                            "id": str(item.id),
                            "orderId": str(order.id),
                            "menuItemId": str(item.menu_item_id),
                            "name": item.item_name_snapshot,
                            "quantity": item.quantity,
                            "unitPrice": float(item.unit_price),
                            "price": float(item.unit_price),
                            "totalPrice": float(item.line_total),
                            "slotId": str(order.slot_id) if order.slot_id else "",
                        }
                        for item in order.items.all()
                    ],
                },
            )
            for order in data["results"]
        ]
        data["results"] = results
        if params.get("export") in {"csv", "xlsx", "excel"}:
            return csv_response(
                f"orders-report-{canteen.id}.csv",
                results,
                ["orderNumber", "empId", "customerName", "department", "slotName", "subtotal", "total", "status", "createdAt"],
            )
        return Response(envelope(**data), status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="revenue")
    def revenue(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        rows = revenue_rows(canteen, params)
        total_revenue = sum(row["revenue"] for row in rows)
        total_units = sum(row["quantity"] for row in rows)
        payload = envelope(rows, len(rows), totalRevenue=total_revenue, totalUnits=total_units)
        if params.get("export") in {"csv", "xlsx", "excel"}:
            return csv_response(
                f"revenue-report-{canteen.id}.csv",
                rows,
                ["slot", "item", "quantity", "revenue"],
            )
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="slot-utilization")
    def slot_utilization(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        rows = slot_utilization_rows(canteen, params)
        payload = envelope(rows, len(rows))
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="kitchen-performance")
    def kitchen_performance(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        qs = orders_report_queryset(canteen, params)
        total_orders = qs.count()
        delivered = qs.filter(status=OrderStatus.DELIVERED).count()
        cancelled = qs.filter(status=OrderStatus.CANCELLED).count()
        ready = qs.filter(status=OrderStatus.READY).count()
        preparing = qs.filter(status=OrderStatus.PREPARING).count()
        avg_processing = 0
        delivered_orders = qs.filter(status=OrderStatus.DELIVERED, collected_at__isnull=False)
        if delivered_orders.exists():
            total_seconds = 0
            count = 0
            for order in delivered_orders:
                if order.collected_at and order.placed_at:
                    total_seconds += (order.collected_at - order.placed_at).total_seconds()
                    count += 1
            if count:
                avg_processing = round((total_seconds / count) / 60, 2)
        payload = envelope(
            [
                {"label": "placed", "count": qs.filter(status=OrderStatus.PLACED).count()},
                {"label": "preparing", "count": preparing},
                {"label": "ready", "count": ready},
                {"label": "delivered", "count": delivered},
                {"label": "cancelled", "count": cancelled},
            ],
            total_orders,
            totalOrders=total_orders,
            averageProcessingMinutes=avg_processing,
        )
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="item-sales")
    def item_sales(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        rows = item_sales_rows(canteen, params)
        payload = envelope(rows, len(rows), totalUnits=sum(row["quantity"] for row in rows), totalRevenue=sum(row["revenue"] for row in rows))
        if params.get("export") in {"csv", "xlsx", "excel"}:
            return csv_response(
                f"item-sales-report-{canteen.id}.csv",
                rows,
                ["item", "quantity", "revenue"],
            )
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="cancelled-orders")
    def cancelled_orders(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        qs = cancelled_orders_queryset(canteen, params)
        data = paginate_queryset(qs, params)
        data["results"] = [
            self._redact_cancelled_row(
                request,
                {
                    "id": str(order.id),
                    "orderNumber": order.order_code,
                    "customerName": order.employee.full_name,
                    "slotName": order.slot.name if order.slot else "Slot",
                    "cancelledAt": order.cancelled_at.isoformat() if order.cancelled_at else None,
                    "reason": order.cancellation_reason or "",
                },
            )
            for order in data["results"]
        ]
        return Response(envelope(**data), status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="employee-activity")
    def employee_activity(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        rows = employee_activity_rows(canteen, params)
        payload = envelope(rows, len(rows), totalRevenue=sum(row["total"] for row in rows))
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="period")
    def period(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        rows = period_rollup_rows(canteen, params)
        payload = envelope(rows, len(rows), totalRevenue=sum(row["totalRevenue"] for row in rows))
        return Response(payload, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="salary-deductions")
    def salary_deductions(self, request):
        canteen = self._can_access(request)
        if not hasattr(canteen, "id"):
            return canteen
        params = self._parse_params(request)
        rows = employee_activity_rows(canteen, params)
        if params.get("export") == "excel":
            return excel_response(
                f"salary-deductions-{canteen.id}.xlsx",
                rows,
                ["employeeId", "name", "department", "orderCount", "meals", "total"],
            )
        payload = envelope(rows, len(rows), totalRevenue=sum(row["total"] for row in rows))
        return Response(payload, status=status.HTTP_200_OK)
