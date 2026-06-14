import uuid
from django.db import models
from django.core.validators import MinValueValidator


class GuestType:
    GUEST = 'GUEST'
    NEW_JOINEE = 'NEW_JOINEE'
    VENDOR = 'VENDOR'
    ALL = [GUEST, NEW_JOINEE, VENDOR]
    CHOICES = [
        (GUEST, 'Guest'),
        (NEW_JOINEE, 'New Joinee'),
        (VENDOR, 'Vendor'),
    ]


class MenuItem(models.Model):
    SLOT_CHOICES = [
        ('Breakfast', 'Breakfast'),
        ('Lunch', 'Lunch'),
        ('Dinner', 'Dinner'),
        ('Snacks', 'Snacks'),
    ]

    CATEGORY_CHOICES = [
        ('Veg', 'Veg'),
        ('Non-Veg', 'Non-Veg'),
        ('Beverages', 'Beverages'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0)], db_column='price')
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, db_column='category')
    slot = models.CharField(max_length=20, choices=SLOT_CHOICES, db_column='slot')
    tag = models.CharField(max_length=50, blank=True, db_column='tag')
    live = models.BooleanField(default=True, db_column='is_live')
    days = models.JSONField(default=list, db_column='available_days')
    available_for = models.JSONField(
        default=list,
        blank=True,
        help_text='Guest types this item is shown for: GUEST, NEW_JOINEE, VENDOR.',
    )

    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')

    class Meta:
        db_table = 'cms_menu_items'
        ordering = ['name']

    def __str__(self):
        return self.name


class GuestOrder(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('preparing', 'Preparing'),
        ('prepared', 'Prepared'),
        ('collected', 'Collected'),
        ('ready', 'Ready'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, db_column='id')
    canteen = models.ForeignKey(
        'cms.CanteenLocation',
        on_delete=models.PROTECT,
        db_column='canteen_id',
        related_name='guest_orders',
        null=True,
        blank=True
    )
    order_number = models.CharField(max_length=50, unique=True, null=True, blank=True, db_column='order_number')
    guest_name = models.CharField(max_length=200, db_column='guest_name')
    guest_email = models.CharField(max_length=254, blank=True, default='', db_column='guest_email')
    phone = models.CharField(max_length=20, db_column='guest_mobile')
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0, validators=[MinValueValidator(0)], db_column='total_amount')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending', db_column='status')
    created_at = models.DateTimeField(auto_now_add=True, db_column='created_at')
    updated_at = models.DateTimeField(auto_now=True, db_column='updated_at')
    estimated_time = models.TimeField(null=True, blank=True, db_column='estimated_time')
    special_instructions = models.TextField(blank=True, db_column='special_instructions')
    guest_type = models.CharField(
        max_length=20,
        choices=GuestType.CHOICES,
        default=GuestType.GUEST,
        db_column='guest_type',
        db_index=True,
    )

    class Meta:
        db_table = 'cms_guest_orders'
        ordering = ['-created_at']

    def __str__(self):
        return f"Order {self.order_number} - {self.guest_name}"

    def save(self, *args, **kwargs):
        if not self.order_number:
            latest_order = GuestOrder.objects.order_by('-order_number').first()
            if latest_order and latest_order.order_number.startswith('GUEST-'):
                try:
                    num = int(latest_order.order_number.split('-')[-1])
                except (ValueError, IndexError):
                    num = 0
            else:
                num = 0
            self.order_number = f"GUEST-{num + 1:03d}"
        super().save(*args, **kwargs)


class GuestOrderItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, db_column='id')
    order = models.ForeignKey(
        GuestOrder,
        on_delete=models.CASCADE,
        related_name='items',
        db_column='order_id',
        to_field='id'
    )
    name = models.CharField(max_length=200, db_column='item_name')
    price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0)], db_column='unit_price')
    qty = models.PositiveIntegerField(validators=[MinValueValidator(1)], db_column='quantity')
    is_custom = models.BooleanField(default=False, db_column='is_custom')
    description = models.TextField(
        blank=True,
        default='',
        db_column='item_description'
    )

    class Meta:
        db_table = 'cms_guest_order_items'

    def __str__(self):
        return f"{self.qty}x {self.name}"

    @property
    def subtotal(self):
        return self.price * self.qty