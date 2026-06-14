from rest_framework import serializers
from apps.cms.models.order import Order, OrderItem, OrderStatus


class KitchenOrderItemSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    orderId = serializers.UUIDField(source='order_id', read_only=True)
    menuItemId = serializers.UUIDField(source='menu_item_id', read_only=True)
    name = serializers.CharField(source='item_name_snapshot', read_only=True)
    quantity = serializers.IntegerField(read_only=True)
    unitPrice = serializers.DecimalField(source='unit_price', max_digits=10, decimal_places=2, read_only=True)
    price = serializers.DecimalField(source='unit_price', max_digits=10, decimal_places=2, read_only=True)
    totalPrice = serializers.DecimalField(source='line_total', max_digits=10, decimal_places=2, read_only=True)
    slotId = serializers.SerializerMethodField()

    def get_slotId(self, obj):
        return str(obj.order.slot_id) if obj.order else None


class KitchenOrderSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    orderNumber = serializers.CharField(source='order_code', read_only=True)
    customerId = serializers.SerializerMethodField()
    customerName = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    slotId = serializers.SerializerMethodField()
    slotName = serializers.SerializerMethodField()
    items = KitchenOrderItemSerializer(many=True, read_only=True)
    subtotal = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    tax = serializers.SerializerMethodField()
    total = serializers.DecimalField(source='total_amount', max_digits=10, decimal_places=2, read_only=True)
    totalAmount = serializers.DecimalField(source='total_amount', max_digits=10, decimal_places=2, read_only=True)
    status = serializers.SerializerMethodField()
    paymentMethod = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='placed_at', read_only=True)
    updatedAt = serializers.DateTimeField(read_only=True)

    def get_customerId(self, obj):
        return str(obj.employee_id)

    def get_customerName(self, obj):
        return obj.employee.full_name if obj.employee else ''

    def get_department(self, obj):
        return obj.employee.department.name if obj.employee and obj.employee.department else ''

    def get_slotId(self, obj):
        return str(obj.slot_id)

    def get_slotName(self, obj):
        try:
            return obj.slot.name if obj.slot else 'Slot'
        except Exception:
            return 'Slot'

    def get_tax(self, obj):
        return 0

    def get_status(self, obj):
        status_map = {
            OrderStatus.PLACED: 'preparing',
            OrderStatus.PREPARING: 'preparing',
            OrderStatus.READY: 'ready',
            OrderStatus.DELIVERED: 'delivered',
            OrderStatus.CANCELLED: 'cancelled',
        }
        return status_map.get(obj.status, 'placed')

    def get_paymentMethod(self, obj):
        return 'wallet'


class KitchenOrderStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=['preparing', 'ready'],
        required=True,
        help_text="New status: 'preparing' or 'ready'"
    )
    note = serializers.CharField(required=False, allow_blank=True, max_length=500)
