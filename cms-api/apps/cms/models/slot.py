"""
apps/cms/models/slot.py

Corrections applied vs original:
  FIX 1  — MealSlot.id: integer PK → UUIDField (matches Order.slot_id type)
  FIX 2  — MealSlot.canteen FK added for tenant isolation
  FIX 3  — SlotMenuItem.menu_item_id: PositiveIntegerField → UUIDField
  FIX 4  — MealSlot.categories JSONField removed (derived from SlotMenuItems)
  FIX 5  — occupancy_count / occupancy_percentage properties removed
             (compute via .annotate() in views to avoid N+1)
  FIX 6  — DB indexes added on MealSlot and SlotMenuItem
  FIX 8  — MealSlot.is_active added for soft-deactivation
  NEW    — MealType values normalised to UPPER_UNDERSCORE (requires data migration
             if rows already store "Breakfast"/"Meal" — see note below)
  NEW    — SlotMenuItem.max_qty_per_order snapshot field added
"""

import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q


class MealType(models.TextChoices):
    # WARNING: original stored "Breakfast" / "Meal" (Title case).
    # Changing to UPPER requires a data migration:
    #   MealSlot.objects.filter(meal_type="Breakfast").update(meal_type="BREAKFAST")
    #   MealSlot.objects.filter(meal_type="Meal").update(meal_type="MEAL")
    BREAKFAST = "BREAKFAST", "Breakfast"
    MEAL      = "MEAL",      "Meal"


# ──────────────────────────────────────────────────────────────────────────────
# MealSlot
# ──────────────────────────────────────────────────────────────────────────────

class MealSlot(models.Model):
    """
    cms_meal_slots

    A dining time window for a specific canteen on a specific date.
    Admin creates slots and assigns menu items via SlotMenuItem.
    Employees can only order within an ACTIVE slot's time window.

    Relationship to Order:
      Order.slot_id (UUIDField) must reference MealSlot.id (UUIDField) — types now match.
      Once Order.slot_id is upgraded to a proper FK, occupancy can be annotated:
          MealSlot.objects.annotate(
              occupancy_count=Count(
                  'slot_orders',
                  filter=Q(slot_orders__status__in=[PLACED, PREPARING, READY])
              )
          )
    """

    # FIX 1: explicit UUID PK — must match Order.slot_id (UUIDField)
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # FIX 2: canteen FK — required for tenant isolation
    canteen = models.ForeignKey(
        'cms.CanteenLocation',
        on_delete=models.CASCADE,
        related_name='meal_slots',
        db_column='canteen_id',
    )

    name = models.CharField(max_length=100)
    meal_type = models.CharField(
        max_length=20,
        choices=MealType.choices,
        db_index=True,
    )

    date       = models.DateField()
    start_time = models.TimeField()
    end_time   = models.TimeField()
    buffer_minutes = models.PositiveIntegerField(
        default=0,
        help_text="Minutes before start_time when employee ordering closes.",
    )
    capacity   = models.PositiveIntegerField(default=100)

    # FIX 8: soft-deactivation flag
    # is_active=False = admin closed/deactivated this slot for ordering
    is_active = models.BooleanField(default=True, db_index=True)

    # Cafinity — Post-Cutoff Order Summary Email
    summary_sent = models.BooleanField(
        default=False,
        db_index=True,
        help_text='True after post-cutoff summary email has been dispatched.',
    )

    # Categories served in this slot (list of strings)
    categories = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cms_meal_slots'
        ordering = ['date', 'start_time']

        # FIX 6: composite indexes
        indexes = [
            # Kitchen board / employee ordering: "Today's slots for canteen X"
            models.Index(
                fields=['canteen_id', 'date'],
                name='idx_slot_canteen_date',
            ),
            # Admin list: "All active slots for canteen X"
            models.Index(
                fields=['canteen_id', 'is_active', 'date'],
                name='idx_slot_canteen_active_date',
            ),
            # Meal-type filter: "Breakfast slots for canteen X on date Y"
            models.Index(
                fields=['canteen_id', 'date', 'meal_type'],
                name='idx_slot_canteen_date_mealtype',
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['canteen', 'date', 'name'],
                name='uniq_slot_canteen_date_name',
            ),
        ]

    def __str__(self):
        return f"{self.name} [{self.meal_type}] {self.date} {self.start_time}–{self.end_time}"

    @property
    def is_ordering_open(self) -> bool:
        """True when the slot is marked active."""
        return self.is_active

    # FIX 5: occupancy_count and occupancy_percentage removed from model.
    # Compute in the view via annotation — avoids hidden N+1 in list views.
    # Example:
    #
    #   from django.db.models import Count, Q
    #   from apps.cms.models.order import OrderStatus
    #
    #   slots = MealSlot.objects.annotate(
    #       occupancy_count=Count(
    #           'slot_orders',
    #           filter=Q(slot_orders__status__in=[
    #               OrderStatus.PLACED,
    #               OrderStatus.PREPARING,
    #               OrderStatus.READY,
    #           ])
    #       )
    #   ).filter(canteen_id=canteen_id, date=today)


# ──────────────────────────────────────────────────────────────────────────────
# SlotMenuItem
# ──────────────────────────────────────────────────────────────────────────────

class SlotMenuItem(models.Model):
    """
    cms_slot_menu_items

    Through-table linking a MealSlot to a CanteenMenuItem.
    menu_item_id is a UUIDField — no FK constraint across apps, but column
    type now matches CanteenMenuItem.id. Validated at the serializer layer
    (item must exist and belong to the same canteen as the slot).

    N+1 pattern — load items for a slot in 2 queries:
        slot_items = SlotMenuItem.objects.filter(slot_id=slot_id, is_enabled=True)
        item_ids   = slot_items.values_list('menu_item_id', flat=True)
        items      = CanteenMenuItem.objects.filter(id__in=item_ids).select_related('category')
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    slot = models.ForeignKey(
        MealSlot,
        on_delete=models.CASCADE,
        related_name='slot_items',
        db_column='slot_id',
    )

    # FIX 3: UUIDField — matches CanteenMenuItem.id type
    menu_item_id = models.UUIDField(
        help_text=(
            "UUID of CanteenMenuItem. No DB FK constraint — "
            "validated at app layer to ensure item belongs to slot's canteen."
        )
    )

    is_enabled = models.BooleanField(
        default=True,
        help_text="Admin toggle — False hides this item from the slot's menu.",
    )

    # Max units of this dish one employee may order in a single checkout for this slot.
    max_qty_per_order = models.PositiveIntegerField(
        default=4,
        help_text="Maximum quantity of this dish one employee may order in a single order for this slot.",
    )

    min_order_quantity = models.PositiveIntegerField(
        default=1,
        help_text="Minimum quantity required per order for this dish in this slot.",
    )

    # Legacy DB column still exists in some deployed schemas and is NOT NULL.
    # Keep it synchronized with min_order_quantity so inserts do not fail.
    min_qty_per_order = models.PositiveIntegerField(
        default=1,
        db_column='min_qty_per_order',
        editable=False,
    )

    max_order_quantity = models.PositiveIntegerField(
        default=10,
        help_text="Maximum quantity allowed per order for this dish in this slot.",
    )

    # Total portions available for this item in this slot (all employees). Null = unlimited.
    available_quantity = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Total portions available for this item in this slot across all employees. Empty = no slot-level cap.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cms_slot_menu_items'

        constraints = [
            models.UniqueConstraint(
                fields=['slot', 'menu_item_id'],
                name='uniq_slot_menu_item',
            ),
            models.CheckConstraint(
                check=Q(min_order_quantity__gte=1),
                name='chk_smi_min_order_quantity_gte_1',
            ),
            models.CheckConstraint(
                check=Q(max_order_quantity__gte=F('min_order_quantity')),
                name='chk_smi_max_order_quantity_gte_min',
            ),
        ]

        # FIX 6: indexes on SlotMenuItem
        indexes = [
            # "Which items are enabled in slot X?" — employee menu view
            models.Index(
                fields=['slot_id', 'is_enabled'],
                name='idx_smi_slot_enabled',
            ),
            # "Which slots contain item X?" — admin reverse lookup
            models.Index(
                fields=['menu_item_id'],
                name='idx_smi_menuitem',
            ),
        ]

    def __str__(self):
        status = 'enabled' if self.is_enabled else 'disabled'
        return f"Item {self.menu_item_id} in slot '{self.slot.name}' ({status})"

    def clean(self):
        super().clean()
        if self.min_order_quantity < 1:
            raise ValidationError({'min_order_quantity': 'Minimum order quantity must be at least 1.'})
        if self.max_order_quantity < self.min_order_quantity:
            raise ValidationError({'max_order_quantity': 'Maximum order quantity must be greater than or equal to minimum order quantity.'})

    def save(self, *args, **kwargs):
        self.min_qty_per_order = self.min_order_quantity
        update_fields = kwargs.get('update_fields')
        if update_fields is not None and 'min_order_quantity' in update_fields:
            kwargs['update_fields'] = set(update_fields) | {'min_qty_per_order'}
        super().save(*args, **kwargs)
