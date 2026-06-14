# Cafinity Security Fix Round 2 — VAPT June 2026 — Fix G (canteen IDOR)
"""
apps/cms/views/slot.py

Corrections applied vs original:
  FIX D  — today() and upcoming() now filter by canteen_id (from authenticated user
             or explicit query param). Without this, all slots across all canteens
             are returned — broken after canteen FK was added to MealSlot.
  FIX 5  — Queryset annotated with occupancy_count to avoid N+1. The annotation
             is picked up automatically by MealSlotListSerializer.
  NEW    — is_active filter added to filterset_fields so admin can filter
             active/inactive slots.
  NEW    — canteen_id filter added to filterset_fields for multi-tenant filtering.

Note on canteen resolution:
  get_canteen_id() below shows the recommended pattern — pull canteen_id from the
  authenticated user's profile. Adjust to match your auth model (e.g. request.user.canteen_id,
  or a URL kwarg if you use nested routers like /canteens/{canteen_id}/slots/).
"""

from datetime import datetime, timedelta
import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db.models import Count, Q
from django.db.models.deletion import ProtectedError
from django.db import DatabaseError
from rest_framework import status
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from apps.common.permissions import IsCMSAdmin
from apps.accounts.models import Employee, RoleChoices
from apps.audit.models import AuditLog
from apps.audit.service import log_action
from apps.cms.models import CanteenLocation, MealSlot, SlotMenuItem
from apps.cms.models.order import OrderStatus
from apps.cms.serializers.slot import (
    MealSlotListSerializer,
    MealSlotDetailSerializer,
    MealSlotWriteSerializer,
    SlotMenuItemSerializer,
    SlotMenuItemToggleSerializer,
)
from apps.common.permissions import IsAnyAdmin

# Import the order statuses that count toward occupancy.
# Adjust the import path to match your project structure.
# from apps.cms.models.order import OrderStatus
# OCCUPANCY_STATUSES = [OrderStatus.PLACED, OrderStatus.PREPARING, OrderStatus.READY]
OCCUPANCY_STATUSES = [
    OrderStatus.PENDING,
    OrderStatus.PLACED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
]


def _slot_snapshot(slot):
    return {
        "id": str(slot.id),
        "name": slot.name,
        "date": slot.date.isoformat() if slot.date else None,
        "start_time": slot.start_time.isoformat() if slot.start_time else None,
        "end_time": slot.end_time.isoformat() if slot.end_time else None,
        "is_active": slot.is_active,
        "canteen_id": str(slot.canteen_id),
    }


def _annotate_occupancy(queryset):
    """
    Annotate each MealSlot with occupancy_count.
    Requires Order.slot to be a proper FK with related_name='slot_orders'.
    Until that FK is in place, occupancy_count will always be 0.
    """
    return queryset.annotate(
        occupancy_count=Count(
            'slot_orders',
            filter=Q(slot_orders__status__in=OCCUPANCY_STATUSES),
        )
    )


def _token_value(request, key, default=None):
    try:
        return request.auth.get(key, default) if request.auth else default
    except Exception:
        return default


def _current_employee(request):
    employee_id = _token_value(request, 'employee_id')
    if not employee_id:
        return getattr(request.user, 'employee_profile', None)

    return (
        Employee.objects
        .select_related('canteen', 'company')
        .filter(id=employee_id, is_active=True)
        .first()
    )


logger = logging.getLogger(__name__)


class MealSlotViewSet(viewsets.ModelViewSet):
    """
    ┌─────────────────────────────────────────────────────────────┐
    │  ENDPOINT                              │  UI ACTION          │
    ├─────────────────────────────────────────────────────────────┤
    │  GET    /api/slots/                    │  Slot card grid     │
    │  POST   /api/slots/                    │  Add New Slot modal │
    │  GET    /api/slots/{id}/               │  Slot detail        │
    │  PUT    /api/slots/{id}/               │  Edit Slot modal    │
    │  PATCH  /api/slots/{id}/               │  Partial edit       │
    │  DELETE /api/slots/{id}/               │  Trash icon         │
    │  GET    /api/slots/today/              │  Today's slots      │
    │  GET    /api/slots/upcoming/           │  Upcoming slots     │
    │  GET    /api/slots/{id}/items/         │  Availability modal │
    │  PATCH  /api/slots/{id}/items/{item}/  │  Toggle switch      │
    └─────────────────────────────────────────────────────────────┘
    """

    filter_backends  = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    permission_classes = [IsAuthenticated, IsAnyAdmin]
    filterset_fields = [
        "date",
        "meal_type",
        "canteen_id",   # NEW: required for multi-tenant filtering
        "is_active",    # NEW: admin can filter active/inactive slots
    ]
    search_fields   = ["name"]
    ordering_fields = ["date", "start_time", "name"]
    ordering        = ["date", "start_time"]

    def dispatch(self, request, *args, **kwargs):
        try:
            return super().dispatch(request, *args, **kwargs)
        except DatabaseError:
            logger.exception('MEALSLOT_DATABASE_ERROR path=%s', request.path)
            return Response(
                {
                    'detail': (
                        'Server database schema is out of date. '
                        'Run "python manage.py migrate" on the API server and restart.'
                    ),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    def get_queryset(self):
        from apps.core.canteen_scope import validate_canteen_access

        explicit_canteen = self.request.query_params.get('canteen_id')
        if explicit_canteen:
            validate_canteen_access(self.request, explicit_canteen)

        company_id = _token_value(self.request, 'company_id')
        role_type = _token_value(self.request, 'role_type')
        employee = _current_employee(self.request)
        qs = (
            MealSlot.objects
            .select_related('canteen')
            .prefetch_related('slot_items')
            .defer('summary_sent')
            .all()
        )
        assigned_canteen_id = getattr(employee, 'canteen_id', None) or _token_value(self.request, 'canteen_id')
        if role_type == RoleChoices.LIMITED_ADMIN:
            qs = qs.filter(canteen_id=assigned_canteen_id) if assigned_canteen_id else qs.none()
        elif role_type != RoleChoices.SUPER_ADMIN and company_id:
            qs = qs.filter(canteen__company_id=company_id)
        return _annotate_occupancy(qs)

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return MealSlotWriteSerializer
        if self.action == "retrieve":
            return MealSlotDetailSerializer
        return MealSlotListSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.action == "create":
            context["write_canteen"] = self._get_write_canteen()
        elif self.action in ("update", "partial_update"):
            context["write_canteen"] = self.get_object().canteen
        return context

    # ── helper: resolve canteen from request ──────────────────────
    def _get_canteen_id(self):
        """
        Return the canteen_id to scope queries for the current user.
        Adjust to match your auth model — examples:
          - request.user.canteen_id         (profile FK)
          - self.kwargs.get('canteen_pk')   (nested router)
          - request.query_params.get('canteen_id')  (explicit param)
        """
        explicit = self.request.query_params.get('canteen_id')
        if explicit:
            return explicit
        token_canteen_id = _token_value(self.request, 'canteen_id')
        if token_canteen_id:
            return token_canteen_id
        return getattr(self.request.user, 'canteen_id', None)

    def _get_write_canteen(self):
        from apps.core.canteen_scope import validate_canteen_access

        canteen_id = self.request.data.get('canteen_id') or self.request.query_params.get('canteen_id')
        company_id = _token_value(self.request, 'company_id')
        role_type = _token_value(self.request, 'role_type')
        employee = _current_employee(self.request)

        qs = CanteenLocation.objects.filter(is_active=True, deleted_at__isnull=True)
        assigned_canteen_id = getattr(employee, 'canteen_id', None) or _token_value(self.request, 'canteen_id')
        if role_type == RoleChoices.LIMITED_ADMIN:
            if not assigned_canteen_id:
                raise ValidationError({"canteen_id": "Limited admin is not assigned to a canteen."})
            return get_object_or_404(qs, id=assigned_canteen_id)
        if role_type != RoleChoices.SUPER_ADMIN and company_id:
            qs = qs.filter(company_id=company_id)
        if canteen_id:
            validate_canteen_access(self.request, canteen_id)
            return get_object_or_404(qs, id=canteen_id)
        return qs.order_by('name').first()

    def perform_create(self, serializer):
        slot = serializer.save(canteen=self._get_write_canteen())
        log_action(
            actor=self.request.user,
            action_category=AuditLog.ACTION_SLOT,
            action='slot_created',
            target=slot,
            new_state=_slot_snapshot(slot),
            request=self.request,
        )
        item_count = slot.slot_items.count()
        if item_count:
            log_action(
                actor=self.request.user,
                action_category=AuditLog.ACTION_SLOT,
                action='bulk_slot_mapping_done',
                target=slot,
                request=self.request,
                metadata={
                    'item_count': item_count,
                    'slot_count': 1,
                    'canteen_name': slot.canteen.name if slot.canteen else '',
                    'date_range': str(slot.date),
                },
            )

    def partial_update(self, request, *args, **kwargs):
        before = _slot_snapshot(self.get_object())
        response = super().partial_update(request, *args, **kwargs)
        slot = self.get_object()
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_SLOT,
            action='slot_updated',
            target=slot,
            previous_state=before,
            new_state=_slot_snapshot(slot),
            request=request,
        )

        is_reopening = str(request.data.get("is_active")).lower() == "true"
        if is_reopening:
            today = timezone.localdate()
            now = timezone.localtime()
            close_time = timezone.make_aware(
                datetime.combine(today, slot.start_time),
                timezone.get_current_timezone(),
            ) - timedelta(minutes=int(getattr(slot, "buffer_minutes", 0) or 0))

            update_fields = ["updated_at"]
            if slot.date < today:
                slot.date = today if now < close_time else today + timedelta(days=1)
                update_fields.append("date")
            elif slot.date == today and now >= close_time:
                slot.date = today + timedelta(days=1)
                update_fields.append("date")

            slot.slot_items.update(is_enabled=True)
            if len(update_fields) > 1:
                slot.save(update_fields=update_fields)
            log_action(
                actor=request.user,
                action_category=AuditLog.ACTION_SLOT,
                action='slot_reopened',
                target=slot,
                request=request,
                metadata={'slot_name': slot.name},
            )

            return Response(MealSlotDetailSerializer(slot).data, status=response.status_code)

        return response

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        before = _slot_snapshot(instance)
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return Response(
                {
                    "detail": 
                        "Slot cannot be deleted because existing orders reference it. "
                        "Please close or archive the slot instead."
                },
                status=status.HTTP_409_CONFLICT,
            )
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_SLOT,
            action='slot_deleted',
            target=instance,
            previous_state=before,
            new_state=None,
            request=request,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ── GET /api/slots/today/ ──────────────────────────────────────
    @action(detail=False, methods=["get"], url_path="today")
    def today(self, request):
        # FIX D: scope to canteen — without this, all canteens' slots are returned
        canteen_id = self._get_canteen_id()
        qs = self.get_queryset().filter(date=timezone.localdate())
        if canteen_id:
            qs = qs.filter(canteen_id=canteen_id)
        return Response(MealSlotListSerializer(qs, many=True).data)

    # ── GET /api/slots/upcoming/ ───────────────────────────────────
    @action(detail=False, methods=["get"], url_path="upcoming")
    def upcoming(self, request):
        # FIX D: scope to canteen
        canteen_id = self._get_canteen_id()
        qs = self.get_queryset().filter(date__gte=timezone.localdate())
        if canteen_id:
            qs = qs.filter(canteen_id=canteen_id)
        return Response(MealSlotListSerializer(qs, many=True).data)

    # ── GET /api/slots/{id}/items/ ─────────────────────────────────
    @action(detail=True, methods=["get"], url_path="items")
    def items(self, request, pk=None):
        """
        Returns assigned items with their is_enabled toggle.
        Frontend merges with menu-app data using menu_item_id.
        Matches the "Slot Item Availability" modal (eye icon).
        """
        slot = self.get_object()
        slot_items = slot.slot_items.all()
        return Response(SlotMenuItemSerializer(slot_items, many=True).data)

    # ── PATCH /api/slots/{id}/items/{item_id}/ ─────────────────────
    @action(detail=True, methods=["patch"], url_path=r"items/(?P<item_id>[0-9a-f-]+)")
    def toggle_item(self, request, pk=None, item_id=None):
        """
        Toggle is_enabled for one menu item inside this slot.
        Body: { "is_enabled": true | false }
        Matches the orange toggle switch in the Availability modal.

        NOTE: item_id regex updated from \\d+ to [0-9a-f-]+ to accept UUIDs.
        """
        slot = self.get_object()
        slot_item = get_object_or_404(SlotMenuItem, slot=slot, menu_item_id=item_id)
        serializer = SlotMenuItemToggleSerializer(slot_item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        was_enabled = slot_item.is_enabled
        serializer.save()
        action = 'item_mapped_to_slot' if slot_item.is_enabled and not was_enabled else 'item_removed_from_slot'
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_SLOT,
            action=action,
            target=slot,
            request=request,
            metadata={
                'item_id': str(slot_item.menu_item_id),
                'slot_name': slot.name,
                'canteen_name': slot.canteen.name if slot.canteen else '',
            },
        )
        return Response(SlotMenuItemSerializer(slot_item).data)

    # ── POST /api/slots/{id}/close/ ───────────────────────────────
    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        """
        Close a slot for ordering and disable all slot items.
        """
        slot = self.get_object()
        slot.is_active = False
        slot.save(update_fields=["is_active", "updated_at"])

        slot.slot_items.update(is_enabled=False)
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_SLOT,
            action='slot_closed',
            target=slot,
            request=request,
            metadata={'slot_name': slot.name},
        )

        return Response(MealSlotDetailSerializer(slot).data)

    # ── POST /api/slots/{id}/items/{item_id}/force-close/ ─────────
    @action(detail=True, methods=["post"], url_path=r"items/(?P<item_id>[0-9a-f-]+)/force-close")
    def force_close_item(self, request, pk=None, item_id=None):
        """
        Force-disable one item inside a slot, regardless of the normal toggle flow.
        """
        slot = self.get_object()
        slot_item = get_object_or_404(SlotMenuItem, slot=slot, menu_item_id=item_id)
        slot_item.is_enabled = False
        slot_item.save(update_fields=["is_enabled", "updated_at"])
        log_action(
            actor=request.user,
            action_category=AuditLog.ACTION_SLOT,
            action='item_removed_from_slot',
            target=slot,
            request=request,
            metadata={
                'item_id': str(slot_item.menu_item_id),
                'slot_name': slot.name,
                'canteen_name': slot.canteen.name if slot.canteen else '',
            },
        )
        return Response(SlotMenuItemSerializer(slot_item).data)

    # ── POST /api/slots/{id}/archive/ ─────────────────────────────
    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        """
        Archive a closed/past slot by soft-deactivating it.
        """
        slot = self.get_object()
        if slot.is_active and slot.date >= timezone.localdate():
            return Response(
                {"detail": "Only closed or past slots can be archived."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        slot.is_active = False
        slot.save(update_fields=["is_active", "updated_at"])
        return Response(MealSlotDetailSerializer(slot).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="send-summary-email")
    def send_summary_email(self, request, pk=None):
        """POST /slots/{id}/send-summary-email/ — manual summary email trigger."""
        from apps.common.permissions import IsLimitedAdminOrSuperAdmin
        from apps.cms.tasks import send_kitchen_cutoff_summary_for_slot, send_limited_admin_slot_summary_for_slot

        if not IsLimitedAdminOrSuperAdmin().has_permission(request, self):
            return Response(
                {'detail': "You don't have permission for this action. Contact Super Admin."},
                status=status.HTTP_403_FORBIDDEN,
            )

        slot = self.get_object()
        if not slot.canteen_id:
            return Response(
                {'detail': 'This slot is not linked to a canteen.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        on_date = slot.date
        try:
            kitchen_sent = send_kitchen_cutoff_summary_for_slot(slot, on_date)
            admin_sent = send_limited_admin_slot_summary_for_slot(slot, on_date)
        except Exception:
            logger.exception('MANUAL_SUMMARY_EMAIL_FAILED slot_id=%s', slot.id)
            return Response(
                {'detail': 'Failed to send summary email. Please try again or contact support.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if not kitchen_sent and not admin_sent:
            return Response(
                {'detail': 'Unable to send summary email. Check email configuration.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({'detail': 'Summary email sent.'}, status=status.HTTP_200_OK)

    # ── GET /api/slots/archived/ ──────────────────────────────────
    @action(detail=False, methods=["get"], url_path="archived")
    def archived(self, request):
        """
        List archived slots for history views.
        """
        qs = self.get_queryset().filter(is_active=False).order_by("-date", "-start_time")
        return Response(MealSlotListSerializer(qs, many=True).data)
