"""
apps/cms/serializers/slot.py

Corrections applied vs original:
  FIX A  — Removed 'categories' from all serializer field lists (field deleted from model)
  FIX B  — menu_item_ids ListField child changed from IntegerField → UUIDField
             (matches new SlotMenuItem.menu_item_id UUIDField type)
  FIX 5  — occupancy_count / occupancy_percentage are now annotated on the queryset
             in the view. Serializers expose them as read-only IntegerField /
             FloatField with default=0 so the field still appears in responses.
  NEW    — SlotMenuItemSerializer exposes max_qty_per_order (new model field)
  NEW    — MealSlotListSerializer exposes is_active (new model field)
"""

import uuid

from rest_framework import serializers
from apps.cms.models import MealSlot, SlotMenuItem
from apps.cms.models.menu import CanteenMenuItem
from django.db import IntegrityError


# ---------------------------------------------------------------------------
# SlotMenuItem
# ---------------------------------------------------------------------------

class SlotMenuItemSerializer(serializers.ModelSerializer):
    """
    Read: item id, toggle state, slot stock, and per-employee per-order cap.
    Frontend merges full item details (name, price, category) from the menu app
    using menu_item_id.
    """

    class Meta:
        model = SlotMenuItem
        fields = [
            "menu_item_id",
            "is_enabled",
            "max_qty_per_order",
            "min_order_quantity",
            "max_order_quantity",
            "available_quantity",
        ]


class SlotMenuItemAssignSerializer(serializers.Serializer):
    """One row in the Edit Slot \"Assign Menu Items\" payload."""

    menu_item_id = serializers.UUIDField()
    available_quantity = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=1,
    )
    max_qty_per_order = serializers.IntegerField(required=False, min_value=1, max_value=99)
    min_order_quantity = serializers.IntegerField(required=False, min_value=1, max_value=99)
    max_order_quantity = serializers.IntegerField(required=False, min_value=1, max_value=99)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        min_qty = attrs.get('min_order_quantity', 1)
        max_qty = attrs.get('max_order_quantity', attrs.get('max_qty_per_order', 10))
        if max_qty < min_qty:
            raise serializers.ValidationError({'max_order_quantity': 'Maximum order quantity must be greater than or equal to minimum order quantity.'})
        attrs['min_order_quantity'] = min_qty
        attrs['max_order_quantity'] = max_qty
        return attrs


class SlotMenuItemToggleSerializer(serializers.ModelSerializer):
    """PATCH body: { "is_enabled": true }"""

    class Meta:
        model = SlotMenuItem
        fields = ["is_enabled"]


# ---------------------------------------------------------------------------
# MealSlot — read
# ---------------------------------------------------------------------------

class MealSlotListSerializer(serializers.ModelSerializer):
    # FIX 5: computed via annotation in the view (annotate occupancy_count).
    # default=0 ensures the field is present even when the view omits the annotation.
    occupancy_count      = serializers.IntegerField(read_only=True, default=0)
    occupancy_percentage = serializers.FloatField(read_only=True, default=0)
    canteen_id           = serializers.UUIDField(read_only=True)

    class Meta:
        model = MealSlot
        fields = [
            "id",
            "canteen_id",
            "name",
            "date",
            "start_time",
            "end_time",
            "buffer_minutes",
            "capacity",
            "meal_type",
            "categories",       # Restored field
            "is_active",        # FIX 8 (new field)
            "occupancy_count",
            "occupancy_percentage",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class MealSlotDetailSerializer(MealSlotListSerializer):
    """Includes assigned items with toggle state — used in the slot detail view."""

    items = SlotMenuItemSerializer(source="slot_items", many=True, read_only=True)

    class Meta(MealSlotListSerializer.Meta):
        fields = MealSlotListSerializer.Meta.fields + ["items"]


# ---------------------------------------------------------------------------
# MealSlot — write (Add New Slot / Edit Slot modals)
# ---------------------------------------------------------------------------

class MealSlotWriteSerializer(serializers.ModelSerializer):
    """
    `menu_item_ids` — list of UUID strings referencing CanteenMenuItem records.
    We store them in SlotMenuItem without a hard FK.
    Validated here: each UUID must exist and belong to the same canteen as the slot.
    """

    # FIX B: child changed to UUIDField — matches SlotMenuItem.menu_item_id (UUIDField)
    menu_item_ids = serializers.ListField(
        child=serializers.UUIDField(),
        write_only=True,
        required=False,
        default=list,
    )

    menu_items = SlotMenuItemAssignSerializer(
        many=True,
        write_only=True,
        required=False,
    )

    class Meta:
        model = MealSlot
        fields = [
            "id",
            "name",
            "date",
            "start_time",
            "end_time",
            "buffer_minutes",
            "capacity",
            "meal_type",
            "categories",       # Restored field
            "is_active",        # FIX 8 (new field)
            "menu_item_ids",
            "menu_items",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs):
        start = attrs.get("start_time")
        end   = attrs.get("end_time")
        buffer_minutes = attrs.get(
            "buffer_minutes",
            getattr(self.instance, "buffer_minutes", 0) if self.instance else 0,
        )
        if start and end and start >= end:
            raise serializers.ValidationError(
                {"end_time": "End time must be after start time."}
            )
        if buffer_minutes is not None:
            if buffer_minutes < 0:
                raise serializers.ValidationError({"buffer_minutes": "Buffer time cannot be negative."})
            if start:
                start_minutes = start.hour * 60 + start.minute
                if buffer_minutes > start_minutes:
                    raise serializers.ValidationError(
                        {"buffer_minutes": "Buffer time cannot be earlier than the start of the day."}
                    )

        write_canteen = self.context.get("write_canteen")
        menu_items = attrs.get("menu_items")
        menu_item_ids = attrs.get("menu_item_ids") or []

        if menu_items:
            ids_to_check = [row["menu_item_id"] for row in menu_items]
            if len(ids_to_check) != len(set(ids_to_check)):
                raise serializers.ValidationError(
                    {"menu_items": "Duplicate menu_item_id entries are not allowed."}
                )
        else:
            ids_to_check = list(menu_item_ids)

        if write_canteen and ids_to_check:
            found = set(
                CanteenMenuItem.objects.filter(
                    id__in=ids_to_check,
                    canteen_id=write_canteen.id,
                    is_active=True,
                ).values_list("id", flat=True)
            )
            missing_ids = sorted(str(item_id) for item_id in set(ids_to_check) - found)
            if missing_ids:
                raise serializers.ValidationError(
                    {
                        "menu_items": (
                            "One or more menu items are invalid or not in this canteen: "
                            + ", ".join(missing_ids)
                        )
                    }
                )

        return attrs

    def _sync_item_specs(self, slot, specs: list[dict]):
        """
        Reconcile SlotMenuItem rows from structured specs (ids + quantities).
        Preserves is_enabled for rows that still exist.
        """
        incoming_ids = {spec["menu_item_id"] for spec in specs}
        existing = {smi.menu_item_id: smi for smi in slot.slot_items.all()}

        for item_id, smi in existing.items():
            if item_id not in incoming_ids:
                smi.delete()

        existing = {smi.menu_item_id: smi for smi in slot.slot_items.all()}

        for spec in specs:
            item_id = spec["menu_item_id"]
            aq = spec.get("available_quantity")
            mq = spec.get("max_qty_per_order") or 4
            min_qty = spec.get("min_order_quantity") or 1
            max_qty = spec.get("max_order_quantity") or mq

            if item_id not in existing:
                SlotMenuItem.objects.create(
                    slot=slot,
                    menu_item_id=item_id,
                    is_enabled=True,
                    available_quantity=aq,
                    max_qty_per_order=mq,
                    min_order_quantity=min_qty,
                    max_order_quantity=max_qty,
                )
            else:
                smi = existing[item_id]
                smi.available_quantity = aq
                smi.max_qty_per_order = mq
                smi.min_order_quantity = min_qty
                smi.max_order_quantity = max_qty
                smi.save(update_fields=[
                    "available_quantity",
                    "max_qty_per_order",
                    "min_order_quantity",
                    "max_order_quantity",
                    "updated_at",
                ])

    def create(self, validated_data):
        menu_items = validated_data.pop("menu_items", None)
        item_ids = validated_data.pop("menu_item_ids", [])
        try:
            slot = MealSlot.objects.create(**validated_data)
        except IntegrityError:
            raise serializers.ValidationError({
                'name': 'A slot with this name already exists for the selected canteen and date.'
            })

        if menu_items is not None:
            specs = []
            for row in menu_items:
                specs.append(
                    {
                        "menu_item_id": row["menu_item_id"],
                        "available_quantity": row.get("available_quantity"),
                        "max_qty_per_order": row.get("max_qty_per_order") or 4,
                        "min_order_quantity": row.get("min_order_quantity") or 1,
                        "max_order_quantity": row.get("max_order_quantity") or row.get("max_qty_per_order") or 10,
                    }
                )
            self._sync_item_specs(slot, specs)
        else:
            specs = [
                {
                    "menu_item_id": uid,
                    "available_quantity": None,
                    "max_qty_per_order": 4,
                    "min_order_quantity": 1,
                    "max_order_quantity": 10,
                }
                for uid in item_ids
            ]
            self._sync_item_specs(slot, specs)
        return slot

    def update(self, instance, validated_data):
        menu_items = validated_data.pop("menu_items", None)
        item_ids = validated_data.pop("menu_item_ids", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        try:
            instance.save()
        except IntegrityError:
            raise serializers.ValidationError({
                'name': 'A slot with this name already exists for the selected canteen and date.'
            })

        if menu_items is not None:
            specs = []
            for row in menu_items:
                specs.append(
                    {
                        "menu_item_id": row["menu_item_id"],
                        "available_quantity": row.get("available_quantity"),
                        "max_qty_per_order": row.get("max_qty_per_order") or 4,
                        "min_order_quantity": row.get("min_order_quantity") or 1,
                        "max_order_quantity": row.get("max_order_quantity") or row.get("max_qty_per_order") or 10,
                    }
                )
            self._sync_item_specs(instance, specs)
        elif item_ids is not None:
            specs = [
                {
                    "menu_item_id": uid,
                    "available_quantity": None,
                    "max_qty_per_order": 4,
                    "min_order_quantity": 1,
                    "max_order_quantity": 10,
                }
                for uid in item_ids
            ]
            self._sync_item_specs(instance, specs)
        return instance
