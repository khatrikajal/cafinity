# Cafinity Security Fix Round 2 — VAPT June 2026 — Fix K (guest order PII)
# Cafinity Security Fix — VAPT June 2026 — Guest order serializers with XSS sanitization
from datetime import datetime, time, timedelta

from rest_framework import serializers

from apps.cms.models import CanteenMenuItem, MenuItem, GuestOrder, GuestOrderItem, GuestType
from apps.core.mixins import SanitizeInputMixin
from apps.core.sanitizers import sanitize_text


class MenuItemSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    FIELDS_TO_SANITIZE = ['name', 'description']

    class Meta:
        model = MenuItem
        fields = ['id', 'name', 'description', 'price', 'category', 'slot', 'tag', 'live', 'days', 'available_for']


class GuestOrderItemSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    name = serializers.CharField()
    quantity = serializers.IntegerField(min_value=1, required=False, source='qty')
    price = serializers.DecimalField(max_digits=10, decimal_places=2)
    is_custom = serializers.BooleanField(required=False, default=False)

    class Meta:
        model = GuestOrderItem
        fields = ['name', 'qty', 'quantity', 'price', 'is_custom']

    def to_internal_value(self, data):
        if isinstance(data, dict):
            data = data.copy()
            if 'quantity' in data and 'qty' not in data:
                data['qty'] = data['quantity']
        return super().to_internal_value(data)

    def validate_name(self, value):
        cleaned = sanitize_text(value)
        if not cleaned:
            raise serializers.ValidationError('Item name is required.')
        return cleaned

    def validate(self, attrs):
        qty = attrs.get('qty')
        if qty is None or qty <= 0:
            raise serializers.ValidationError({'quantity': 'Item quantity must be greater than 0'})
        price = attrs.get('price')
        if price is not None and price <= 0:
            raise serializers.ValidationError({'price': 'Item price must be greater than 0'})
        return super().validate(attrs)


class GuestOrderAdminSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    """Full guest order payload for admin roles."""
    items = serializers.SerializerMethodField()
    order_number = serializers.CharField(read_only=True)
    FIELDS_TO_SANITIZE = ['guest_name', 'guest_email', 'phone', 'special_instructions']

    class Meta:
        model = GuestOrder
        fields = [
            'id', 'order_number', 'guest_name', 'guest_email', 'phone', 'items', 'total',
            'status', 'guest_type', 'created_at', 'updated_at', 'estimated_time', 'special_instructions'
        ]
        read_only_fields = ['id', 'order_number', 'created_at', 'updated_at']

    def get_items(self, obj):
        return GuestOrderItemSerializer(obj.items.all(), many=True).data


class GuestOrderKitchenItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = GuestOrderItem
        fields = ['name', 'qty', 'price']


class GuestOrderKitchenSerializer(serializers.ModelSerializer):
    """Reduced payload — no guest PII."""
    items = serializers.SerializerMethodField()
    order_number = serializers.CharField(read_only=True)

    class Meta:
        model = GuestOrder
        fields = [
            'id', 'order_number', 'items', 'total', 'status',
            'created_at', 'updated_at', 'estimated_time',
        ]
        read_only_fields = fields

    def get_items(self, obj):
        return GuestOrderKitchenItemSerializer(obj.items.all(), many=True).data


# Backward-compatible alias used by existing imports
GuestOrderSerializer = GuestOrderAdminSerializer


class GuestOrderCreateSerializer(SanitizeInputMixin, serializers.Serializer):
    guest_name = serializers.CharField(max_length=200)
    guest_email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=20)
    guest_type = serializers.ChoiceField(
        choices=GuestType.CHOICES,
        default=GuestType.GUEST,
        required=False,
    )
    estimated_time = serializers.TimeField(required=False, allow_null=True)
    special_instructions = serializers.CharField(required=False, allow_blank=True)
    items = serializers.ListField(child=serializers.DictField())
    FIELDS_TO_SANITIZE = ['guest_name', 'guest_email', 'phone', 'special_instructions']

    def to_internal_value(self, data):
        if isinstance(data, dict):
            data = data.copy()
            estimated_time = data.get('estimated_time')
            if isinstance(estimated_time, str):
                estimated_time = estimated_time.strip()
                if estimated_time == '':
                    data['estimated_time'] = None
                else:
                    parsed_time = self._parse_estimated_time(estimated_time)
                    if parsed_time is not None:
                        data['estimated_time'] = parsed_time
            normalized_items = []
            for item in data.get('items', []):
                if isinstance(item, dict):
                    item = item.copy()
                    if 'quantity' in item and 'qty' not in item:
                        item['qty'] = item['quantity']
                normalized_items.append(item)
            data['items'] = normalized_items
        return super().to_internal_value(data)

    def _parse_estimated_time(self, value: str):
        normalized = value.strip().lower().replace(' ', '')

        if normalized.isdigit():
            if len(normalized) <= 2:
                normalized = f"{normalized.zfill(2)}:00"
            elif len(normalized) == 3:
                normalized = f"{normalized[0]}:{normalized[1:]}"
            elif len(normalized) == 4:
                normalized = f"{normalized[:2]}:{normalized[2:]}"

        if ':' in normalized:
            parts = normalized.split(':')
            if len(parts) in (2, 3):
                try:
                    hour = int(parts[0])
                    minute = int(parts[1])
                    second = int(parts[2]) if len(parts) == 3 else 0
                    if 0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60:
                        return time(hour, minute, second)
                except ValueError:
                    pass

        return None

    def _resolve_item_qty(self, item_data):
        qty = item_data.get('qty') or item_data.get('quantity') or 0
        try:
            qty = int(qty)
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            raise serializers.ValidationError({'items': 'Item quantity must be greater than 0'})
        return qty

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        canteen = validated_data.pop('canteen')

        order = GuestOrder.objects.create(canteen=canteen, **validated_data)
        total = 0

        for item_data in items_data:
            qty = self._resolve_item_qty(item_data)
            if item_data.get('menu_item_id'):
                menu_item_id = item_data['menu_item_id']
                try:
                    cms_menu_item = CanteenMenuItem.objects.get(id=menu_item_id, canteen=canteen)
                    item_name = cms_menu_item.name
                    item_price = cms_menu_item.base_price
                except CanteenMenuItem.DoesNotExist:
                    legacy_menu_item = MenuItem.objects.get(id=menu_item_id)
                    item_name = legacy_menu_item.name
                    item_price = legacy_menu_item.price

                item = GuestOrderItem.objects.create(
                    order=order,
                    name=sanitize_text(item_name),
                    price=item_price,
                    qty=qty,
                    is_custom=False,
                )
            else:
                name = sanitize_text(item_data.get('name', ''))
                if not name:
                    raise serializers.ValidationError({'items': 'Item name is required.'})
                price = item_data.get('price')
                if price is None or price <= 0:
                    raise serializers.ValidationError({'items': 'Item price must be greater than 0'})
                item = GuestOrderItem.objects.create(
                    order=order,
                    name=name,
                    price=price,
                    qty=qty,
                    is_custom=True,
                )

            total += item.subtotal

        order.total = total
        order.save()
        return order

    def to_representation(self, instance):
        return {
            'id': str(instance.id),
            'order_number': instance.order_number,
            'total': float(instance.total),
            'status': instance.status,
        }


class GuestOrderStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=GuestOrder.STATUS_CHOICES)

    def to_internal_value(self, data):
        if isinstance(data, dict) and 'status' in data and isinstance(data['status'], str):
            data = data.copy()
            data['status'] = data['status'].strip().lower()
        return super().to_internal_value(data)


class GuestOrderStatsSerializer(serializers.Serializer):
    total_guests = serializers.IntegerField()
    active_orders = serializers.IntegerField()
    todays_revenue = serializers.DecimalField(max_digits=10, decimal_places=2)
    average_order = serializers.DecimalField(max_digits=10, decimal_places=2)
