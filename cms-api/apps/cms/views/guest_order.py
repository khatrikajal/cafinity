import csv
import logging
from datetime import date, datetime
from io import BytesIO
from django.http import HttpResponse
from django.db.models import Q, Sum, Avg, Count
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ViewSet
from rest_framework.permissions import IsAuthenticated
from apps.audit.models import AuditLog
from apps.audit.service import log_action
from apps.cms.models import (
    CanteenLocation,
    CanteenMenuItem,
    GuestOrder,
    GuestType,
    MealSlot,
    SlotMenuItem,
)
from apps.cms.serializers import (
    MenuItemSerializer, GuestOrderAdminSerializer, GuestOrderKitchenSerializer,
    GuestOrderCreateSerializer,
    GuestOrderStatusUpdateSerializer, GuestOrderStatsSerializer
)
from openpyxl import Workbook
from apps.notifications.models import Notification
from apps.notifications.utils import notify_admins
from apps.core.permissions import IsAdminOrLimitedAdmin
from apps.core.mixins import CanteenScopeMixin
from apps.common.auth_utils import get_effective_role
from apps.accounts.models import RoleChoices

logger = logging.getLogger(__name__)


def _time_to_minutes(value):
    return value.hour * 60 + value.minute


def _slot_order_close_minutes(slot):
    return max(0, _time_to_minutes(slot.start_time) - int(getattr(slot, 'buffer_minutes', 0) or 0))


def _is_slot_orderable(slot):
    if not slot.is_active:
        return False

    today = timezone.localdate()
    if slot.date > today:
        return True
    if slot.date < today:
        return False

    current = timezone.localtime().time()
    return _time_to_minutes(current) < _slot_order_close_minutes(slot)


def _orderable_slots(queryset):
    return [slot for slot in queryset if _is_slot_orderable(slot)]


def excel_response(filename, headers, rows, sheet_name="Report"):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = sheet_name
    worksheet.append(headers)
    for row in rows:
        worksheet.append(row)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    response = HttpResponse(
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


class GuestOrderViewSet(CanteenScopeMixin, ModelViewSet):
    queryset = GuestOrder.objects.all()
    serializer_class = GuestOrderAdminSerializer
    permission_classes = [IsAuthenticated, IsAdminOrLimitedAdmin]

    def _get_canteen(self):
        """Resolve the canteen for the current admin user."""
        canteen = CanteenLocation.objects.filter(is_active=True).first()
        if canteen is None:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'canteen': 'No active canteen found. Please create a canteen first.'})
        return canteen

    def _get_authorized_canteen_ids(self, request):
        """
        Get list of canteen IDs the current user has access to.
        SECURITY: Ensures users can only access data from their authorized canteens.
        """
        from apps.accounts.models import RoleChoices
        
        auth_payload = getattr(request, 'auth', None)
        if not auth_payload:
            return []
        
        role_type = auth_payload.get('role_type', '')
        canteen_id = auth_payload.get('canteen_id')
        company_id = auth_payload.get('company_id')
        
        # SUPER_ADMIN: can see all canteens across all companies
        if role_type == RoleChoices.SUPER_ADMIN:
            return list(CanteenLocation.objects.filter(is_active=True).values_list('id', flat=True))
        
        # COMPANY_ADMIN: can see all canteens in their company
        if role_type == RoleChoices.COMPANY_ADMIN:
            if company_id:
                return list(CanteenLocation.objects.filter(
                    company_id=company_id, is_active=True
                ).values_list('id', flat=True))
            return []
        
        # CANTEEN_ADMIN: can see only their assigned canteen
        if role_type == RoleChoices.CANTEEN_ADMIN:
            if canteen_id:
                return [canteen_id]
            return []
        
        # LIMITED_ADMIN: can see only their assigned canteen
        if role_type == RoleChoices.LIMITED_ADMIN:
            if canteen_id:
                return [canteen_id]
            return []
        
        # Default: no access
        return []

    def get_serializer_class(self):
        if self.action == 'create':
            return GuestOrderCreateSerializer
        role = get_effective_role(self.request)
        if role in {RoleChoices.SUPER_ADMIN, RoleChoices.LIMITED_ADMIN}:
            return GuestOrderAdminSerializer
        return GuestOrderKitchenSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        queryset = self.scope_canteen_queryset(queryset)
        
        status_filter = self.request.query_params.get('status', 'all')
        guest_type_filter = self.request.query_params.get('guest_type', '').strip().upper()
        search = self.request.query_params.get('search', '')
        if guest_type_filter in GuestType.ALL:
            queryset = queryset.filter(guest_type=guest_type_filter)
        if status_filter != 'all':
            queryset = queryset.filter(status=status_filter)
        if search:
            queryset = queryset.filter(
                Q(guest_name__icontains=search) | Q(phone__icontains=search)
            )
        return queryset

    def create(self, request, *args, **kwargs):
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            order = serializer.instance
            return Response(
                {
                    'id': str(order.id),
                    'order_number': order.order_number,
                    'total': float(order.total),
                    'status': order.status,
                },
                status=status.HTTP_201_CREATED,
            )
        except serializers.ValidationError:
            raise
        except Exception as exc:
            logger.exception('GUEST_ORDER_CREATE_FAILED: %s', type(exc).__name__)
            return Response(
                {'detail': 'Unable to create guest order. Please verify item details and try again.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    def perform_create(self, serializer):
        canteen = self._get_canteen()
        self.validate_request_canteen(canteen.id)
        order = serializer.save(canteen=canteen)
        log_action(
            actor=self.request.user,
            action_category=AuditLog.ACTION_GUEST_MENU,
            action='guest_item_created',
            target=order,
            new_state=GuestOrderAdminSerializer(order).data,
            request=self.request,
        )
        notify_admins(
            "Guest order created",
            f"{order.order_number} for {order.guest_name} was created.",
            notification_type=Notification.TYPE_ORDER,
            company_id=getattr(canteen, "company_id", None),
            canteen_id=getattr(canteen, "id", None),
        )

    def destroy(self, request, *args, **kwargs):
        return Response(
            {'detail': 'Delete is not allowed for guest orders.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED
        )

    @action(detail=True, methods=['patch'], url_path='status', url_name='guest-order-status')
    def status(self, request, pk=None):
        """Update guest order status."""
        try:
            order = self.get_object()
            serializer = GuestOrderStatusUpdateSerializer(data=request.data)
            if serializer.is_valid():
                previous_status = order.status
                order.status = serializer.validated_data['status']
                order.save()
                log_action(
                    actor=request.user,
                    action_category=AuditLog.ACTION_ORDERS,
                    action='order_status_changed',
                    target=order,
                    previous_state={'status': previous_status},
                    new_state={'status': order.status},
                    request=request,
                    metadata={'source': 'guest_order'},
                )
                notify_admins(
                    "Guest order updated",
                    f"{order.order_number} for {order.guest_name} is now {order.status}.",
                    notification_type=Notification.TYPE_ORDER,
                    company_id=getattr(order.canteen, "company_id", None),
                    canteen_id=getattr(order, "canteen_id", None),
                )
                return Response(self.get_serializer(order).data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except GuestOrder.DoesNotExist:
            return Response(
                {'detail': 'Guest order not found.'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        """GET /guest-orders/summary/?guest_type=GUEST|NEW_JOINEE|VENDOR"""
        today = date.today()
        authorized_canteen_ids = self._get_authorized_canteen_ids(request)
        qs = GuestOrder.objects.filter(
            canteen_id__in=authorized_canteen_ids,
            created_at__date=today,
        )
        guest_type_filter = request.query_params.get('guest_type', '').strip().upper()
        if guest_type_filter in GuestType.ALL:
            qs = qs.filter(guest_type=guest_type_filter)

        active_orders = qs.filter(
            status__in=['pending', 'accepted', 'preparing', 'prepared', 'ready']
        ).count()
        completed = qs.filter(status__in=['completed', 'collected']).count()
        revenue = qs.filter(status__in=['completed', 'collected']).aggregate(
            total=Sum('total')
        )['total'] or 0

        return Response({
            'total_orders': qs.count(),
            'active_orders': active_orders,
            'completed_orders': completed,
            'todays_revenue': revenue,
            'guest_type': guest_type_filter or 'ALL',
        })

    @action(detail=False, methods=['get'])
    def stats(self, request):
        today = date.today()
        authorized_canteen_ids = self._get_authorized_canteen_ids(request)
        orders_today = GuestOrder.objects.filter(
            canteen_id__in=authorized_canteen_ids,
            created_at__date=today,
        )
        guest_type_filter = request.query_params.get('guest_type', '').strip().upper()
        if guest_type_filter in GuestType.ALL:
            orders_today = orders_today.filter(guest_type=guest_type_filter)
        total_guests = orders_today.values('guest_name').distinct().count()
        active_orders = orders_today.filter(status__in=['pending', 'accepted', 'preparing', 'prepared', 'ready']).count()
        todays_revenue = orders_today.filter(status__in=['completed', 'collected']).aggregate(
            total=Sum('total')
        )['total'] or 0
        average_order = orders_today.filter(status__in=['completed', 'collected']).aggregate(
            avg=Avg('total')
        )['avg'] or 0
        data = {
            'total_guests': total_guests,
            'active_orders': active_orders,
            'todays_revenue': todays_revenue,
            'average_order': average_order,
        }
        serializer = GuestOrderStatsSerializer(data)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def export_csv(self, request):
        """
        Export guest orders to CSV.
        SECURITY: Only exports orders for canteens the user has access to.
        """
        status_filter = request.query_params.get('status')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        # Get user's authorized canteens
        authorized_canteen_ids = self._get_authorized_canteen_ids(request)
        
        # SECURITY: Only export orders from authorized canteens
        queryset = GuestOrder.objects.filter(canteen_id__in=authorized_canteen_ids)
        
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        headers = ['Order ID', 'Guest Name', 'Phone', 'Total', 'Status', 'Created At', 'Estimated Time', 'Special Instructions']
        rows = []
        for order in queryset:
            rows.append([
                order.order_number,
                order.guest_name,
                order.phone,
                order.total,
                order.status,
                order.created_at.strftime('%Y-%m-%d %H:%M:%S'),
                order.estimated_time.strftime('%H:%M') if order.estimated_time else '',
                order.special_instructions,
            ])
        return excel_response("guest_orders.xlsx", headers, rows, "Guest Orders")

    @action(detail=False, methods=['get'])
    def export_detailed(self, request):
        """
        Export detailed guest orders to CSV.
        SECURITY: Only exports orders for canteens the user has access to.
        """
        status_filter = request.query_params.get('status')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        # Get user's authorized canteens
        authorized_canteen_ids = self._get_authorized_canteen_ids(request)
        
        # SECURITY: Only export orders from authorized canteens
        queryset = GuestOrder.objects.prefetch_related('items').filter(canteen_id__in=authorized_canteen_ids)
        
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        headers = ['Order ID', 'Guest Name', 'Phone', 'Item Name', 'Qty', 'Price', 'Subtotal', 'Status', 'Created At']
        rows = []
        for order in queryset:
            for item in order.items.all():
                rows.append([
                    order.order_number,
                    order.guest_name,
                    order.phone,
                    item.name,
                    item.qty,
                    item.price,
                    item.subtotal,
                    order.status,
                    order.created_at.strftime('%Y-%m-%d %H:%M:%S'),
                ])
        return excel_response("guest_orders_detailed.xlsx", headers, rows, "Guest Order Details")


class MenuViewSet(ViewSet):
    permission_classes = [IsAuthenticated]
    DAY_NAME_TO_WEEKDAY = {
        "monday": 0,
        "mon": 0,
        "tuesday": 1,
        "tue": 1,
        "tues": 1,
        "wednesday": 2,
        "wed": 2,
        "thursday": 3,
        "thu": 3,
        "thurs": 3,
        "friday": 4,
        "fri": 4,
        "saturday": 5,
        "sat": 5,
        "sunday": 6,
        "sun": 6,
    }

    def _get_canteen(self):
        canteen_id = self.request.query_params.get('canteen_id')
        if canteen_id:
            canteen = CanteenLocation.objects.filter(id=canteen_id, is_active=True).first()
            if canteen is not None:
                return canteen
        return CanteenLocation.objects.filter(is_active=True).first()

    def _parse_weekday_filter(self, day_value):
        if not day_value:
            return None
        return self.DAY_NAME_TO_WEEKDAY.get(str(day_value).strip().lower())

    def _serialize_cms_menu_item(self, request, item, slot):
        category_name = item.category.name if item.category else ''
        normalized_category = {
            'veg': 'Veg',
            'non-veg': 'Non-Veg',
            'nonveg': 'Non-Veg',
            'beverages': 'Beverages',
        }.get(category_name.strip().lower(), category_name)

        return {
            'id': str(item.id),
            'name': item.name,
            'description': item.description or '',
            'price': float(item.base_price),
            'category': normalized_category,
            'slot': slot.name,
            'slotId': str(slot.id),
            'tag': item.display_tag or '',
            'live': bool(item.is_active and item.is_available and slot.is_active),
            'days': [slot.date.strftime('%A')],
            'available': bool(item.is_active and item.is_available),
            'image': request.build_absolute_uri(item.photo.url) if item.photo else None,
        }

    def _serialize_base_menu_item(self, request, item, day_name):
        """Serialize a CanteenMenuItem without a specific MealSlot (regular menu fallback)."""
        category_name = item.category.name if item.category else ''
        normalized_category = {
            'veg': 'Veg',
            'non-veg': 'Non-Veg',
            'nonveg': 'Non-Veg',
            'beverages': 'Beverages',
        }.get(category_name.strip().lower(), category_name)

        return {
            'id': str(item.id),
            'name': item.name,
            'description': item.description or '',
            'price': float(item.base_price),
            'category': normalized_category,
            'slot': 'Regular Menu',
            'slotId': '',
            'tag': item.display_tag or '',
            'live': bool(item.is_active and item.is_available),
            'days': [day_name],
            'available': bool(item.is_active and item.is_available),
            'image': request.build_absolute_uri(item.photo.url) if item.photo else None,
        }

    @action(detail=False, methods=['get'])
    def available(self, request):
        slot = request.query_params.get('slot')
        category = request.query_params.get('category')
        search = request.query_params.get('search')
        day = request.query_params.get('day')
        weekday_filter = self._parse_weekday_filter(day)
        requested_day_name = day if day else date.today().strftime('%A')

        canteen = self._get_canteen()
        if canteen is None:
            return Response({'results': []})

        # --- Try slot-based menu items for today (or future) first ---
        slots = MealSlot.objects.filter(
            canteen=canteen,
            date__gte=date.today(),
            is_active=True,
        ).order_by('date', 'start_time', 'name')
        if weekday_filter is not None:
            django_weekday = ((weekday_filter + 1) % 7) + 1
            slots = slots.filter(date__week_day=django_weekday)
        if slot and slot != 'Regular Menu':
            slots = slots.filter(name__iexact=slot)
        has_configured_slots = slots.exists()
        slots = _orderable_slots(slots)

        slot_items = (
            SlotMenuItem.objects
            .filter(slot__in=slots, is_enabled=True)
            .select_related('slot')
            .order_by('slot__date', 'slot__start_time', 'slot__name')
        )
        item_ids = {row.menu_item_id for row in slot_items}
        items = (
            CanteenMenuItem.objects
            .filter(id__in=item_ids, canteen=canteen, is_active=True, is_available=True)
            .select_related('category')
            .order_by('name')
        )
        if category:
            items = items.filter(category__name__iexact=category)
        if search:
            items = items.filter(Q(name__icontains=search) | Q(description__icontains=search))

        item_by_id = {item.id: item for item in items}
        results = []
        seen_item_ids = set()
        for row in slot_items:
            item = item_by_id.get(row.menu_item_id)
            if item is not None:
                results.append(self._serialize_cms_menu_item(request, item, row.slot))
                seen_item_ids.add(item.id)

        # --- Fallback: if no slot-based items, show all active menu items ---
        # This ensures the guest order form always has items to choose from
        # even when no MealSlot has been created for today.
        if not results and not has_configured_slots and (not slot or slot == 'Regular Menu'):
            base_items = (
                CanteenMenuItem.objects
                .filter(canteen=canteen, is_active=True, is_available=True)
                .select_related('category')
                .order_by('name')
            )
            if category:
                base_items = base_items.filter(category__name__iexact=category)
            if search:
                base_items = base_items.filter(
                    Q(name__icontains=search) | Q(description__icontains=search)
                )
            for item in base_items:
                if item.id not in seen_item_ids:
                    results.append(self._serialize_base_menu_item(request, item, requested_day_name))

        return Response({'results': results})

    @action(detail=False, methods=['get'])
    def slots(self, request):
        canteen = self._get_canteen()
        if canteen is None:
            return Response({'slots': []})

        slots_qs = (
            MealSlot.objects
            .filter(canteen=canteen, date__gte=date.today(), is_active=True)
            .order_by('date', 'start_time', 'name')
        )
        has_configured_slots = slots_qs.exists()
        slot_names = [slot.name for slot in _orderable_slots(slots_qs)]
        slots = list(dict.fromkeys(slot_names))

        # If no meal slots exist for today, add "Regular Menu" as a virtual
        # slot so the frontend shows it and guests can browse the base menu.
        if not slots and not has_configured_slots:
            has_base_items = (
                CanteenMenuItem.objects
                .filter(canteen=canteen, is_active=True, is_available=True)
                .exists()
            )
            if has_base_items:
                slots = ['Regular Menu']

        return Response({'slots': slots})
