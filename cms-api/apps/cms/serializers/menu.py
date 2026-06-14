"""
apps/cms/serializers/menu.py

Serializers for:
  - MenuCategorySerializer      : read-only list (for filter tabs + dropdown)
  - MenuItemSerializer          : full read representation
  - MenuItemCreateSerializer    : create + update (write side)

Field ↔ UI mapping is documented inline.
"""

import base64
import binascii
import uuid

from django.core.files.base import ContentFile
from rest_framework import serializers

from apps.cms.models.menu import MenuCategory, CanteenMenuItem as MenuItem
from apps.core.mixins import SanitizeInputMixin


# ──────────────────────────────────────────────────────────────────────────────
# Category
# ──────────────────────────────────────────────────────────────────────────────

class MenuCategorySerializer(serializers.ModelSerializer):
    """
    Used for:
      - GET /menu/categories/  → populates the filter tabs (All, Veg, Non-Veg, Beverages)
      - Nested inside MenuItemSerializer.category
      - The "Category" dropdown in the Add New Item modal
    """

    class Meta:
        model  = MenuCategory
        fields = ['id', 'name', 'is_active']


class MenuCategoryCreateSerializer(serializers.ModelSerializer):
    """
    Write serializer for admin-created menu categories.
    The canteen is injected from the nested URL after tenant validation.
    """

    class Meta:
        model = MenuCategory
        fields = ['name', 'is_active']
        extra_kwargs = {
            'is_active': {'required': False},
        }

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Category name is required.")

        canteen_id = self.context.get('canteen_id')
        qs = MenuCategory.objects.filter(canteen_id=canteen_id, name__iexact=name, is_active=True)

        # When updating an existing instance, exclude it from the duplicate check
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)

        if qs.exists():
            raise serializers.ValidationError("Category already exists for this canteen.")

        return name

    def create(self, validated_data):
        canteen_id = self.context['canteen_id']
        name = validated_data['name']
        is_active = validated_data.get('is_active', True)

        existing = MenuCategory.objects.filter(canteen_id=canteen_id, name__iexact=name).first()
        if existing:
            existing.name = name
            existing.is_active = is_active
            existing.save(update_fields=['name', 'is_active', 'updated_at'])
            return existing

        return MenuCategory.objects.create(canteen_id=canteen_id, **validated_data)

    def update(self, instance, validated_data):
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save(update_fields=list(validated_data.keys()) + ['updated_at'])
        return instance


# ──────────────────────────────────────────────────────────────────────────────
# MenuItem — Read
# ──────────────────────────────────────────────────────────────────────────────

class MenuItemSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    FIELDS_TO_SANITIZE = ['name', 'description']
    """
    Full representation returned by GET list and GET detail.

    Extra computed fields:
      - category_name : flattened from category.name (saves a join on the frontend)
      - initials      : first two chars of name, uppercased (drives the avatar in the list)
    """

    category      = MenuCategorySerializer(read_only=True)
    category_name = serializers.CharField(source='category.name', read_only=True)

    # Avatar initials: "Idli" → "ID", "Dosa" → "DO"
    initials = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model  = MenuItem
        fields = [
            'id',
            'canteen_id',
            'category',
            'category_name',
            'name',
            'initials',
            'description',
            'photo_url',
            'base_price',
            'discounted_price',
            'is_veg',
            'is_available',
            'is_active',
            'item_type',         # BREAKFAST | MEAL  → badge in list
            'display_tag',       # e.g. POPULAR, NEW → optional badge
            'tags',
            'created_at',
            'updated_at',
        ]

    def get_initials(self, obj) -> str:
        words = obj.name.strip().split()
        if len(words) >= 2:
            return (words[0][0] + words[1][0]).upper()
        return obj.name[:2].upper()

    def get_photo_url(self, obj):
        if not obj.photo:
            return None
        request = self.context.get('request')
        try:
            url = obj.photo.url
        except ValueError:
            return None
        return request.build_absolute_uri(url) if request else url


# ──────────────────────────────────────────────────────────────────────────────
# MenuItem — Write (Create + Update)
# ──────────────────────────────────────────────────────────────────────────────

class MenuItemCreateSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    FIELDS_TO_SANITIZE = ['name', 'description', 'display_tag']
    """
    Used for POST (create) and PATCH (partial update).

    UI → field mapping:
      "Item Name"             → name             (required)
      "Price (₹)"             → base_price        (required)
      "Category"              → category_id       (required, UUID FK)
      "Item Type"             → item_type         (required: BREAKFAST | MEAL)
      "Display Tag"           → display_tag       (optional)
      "Description"           → description       (required by UI)
      "Item Image"            → photo_url         (optional, URL after upload)

    Fields NOT in the Add modal (auto-set server-side):
      canteen_id    — injected from JWT claim in the view
      created_by    — injected from JWT employee_id in the view
      is_veg        — derived from category.name ('Veg' → True, else False)
                      Can be overridden explicitly if needed.
    """

    # Accept UUID string directly for the FK
    category_id = serializers.UUIDField(write_only=True)

    # is_veg is optional — auto-derived from category if not provided
    is_veg = serializers.BooleanField(required=False)
    photo_url = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    photo = serializers.ImageField(
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model  = MenuItem
        fields = [
            'category_id',
            'name',
            'description',
            'photo',
            'photo_url',
            'base_price',
            'discounted_price',
            'is_veg',
            'is_available',
            'item_type',
            'display_tag',
            'tags',
        ]
        extra_kwargs = {
            'description':       {'required': False, 'allow_blank': True},
            'base_price':        {'required': True},
            'discounted_price':  {'required': False},
            'item_type':         {'required': True},
            'is_available':      {'required': False},
            'tags':              {'required': False},
            'display_tag':       {'required': False},
            'photo':             {'required': False},
            'photo_url':         {'required': False},
        }

    def validate_base_price(self, value):
        if value < 0:
            raise serializers.ValidationError("Price cannot be negative.")
        return value

    def validate_discounted_price(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Discounted price cannot be negative.")
        return value

    def validate_item_type(self, value):
        allowed = [MenuItem.ITEM_TYPE_BREAKFAST, MenuItem.ITEM_TYPE_MEAL]
        if value.upper() not in allowed:
            raise serializers.ValidationError(f"item_type must be one of: {allowed}")
        return value.upper()

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Item name is required.")

        canteen_id = self.context.get('canteen_id')
        qs = MenuItem.all_objects.filter(
            canteen_id=canteen_id,
            deleted_at__isnull=True,
            name__iexact=name,
        )
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)

        if qs.exists():
            raise serializers.ValidationError("Menu item already exists for this canteen.")

        return name

    def validate(self, attrs):
        canteen_id = self.context.get('canteen_id')
        category_id = attrs.pop('category_id', None)

        if category_id is None:
            if self.instance is None:
                raise serializers.ValidationError({
                    'category_id': 'Category is required.'
                })
            category = self.instance.category
        else:
            try:
                category = MenuCategory.objects.get(
                    id=category_id,
                    canteen_id=canteen_id,
                    is_active=True,
                )
            except MenuCategory.DoesNotExist:
                raise serializers.ValidationError({
                    'category_id': 'Category not found or does not belong to this canteen.'
                })
            attrs['category'] = category

        photo_url = attrs.pop('photo_url', None)
        if photo_url:
            photo_file = self._decode_photo_data_url(photo_url)
            if photo_file is None:
                raise serializers.ValidationError({
                    'photo_url': 'Image must be a base64 data URL.'
                })
            attrs['photo'] = photo_file

        # Auto-derive is_veg from category name if not explicitly set
        if 'is_veg' not in attrs:
            attrs['is_veg'] = (category.name.lower() == 'veg')

        return attrs

    def _decode_photo_data_url(self, value):
        if not isinstance(value, str) or not value.startswith('data:image/'):
            return None

        try:
            header, encoded = value.split(';base64,', 1)
            extension = header.split('/')[1].lower()
            if extension == 'jpeg':
                extension = 'jpg'
            data = base64.b64decode(encoded)
        except (ValueError, TypeError, binascii.Error):
            return None

        filename = f"menu-{uuid.uuid4()}.{extension}"
        return ContentFile(data, name=filename)

    def create(self, validated_data):
        validated_data['canteen_id']  = self.context['canteen_id']
        validated_data['created_by_id'] = self.context.get('employee_id')
        return MenuItem.objects.create(**validated_data)

    def update(self, instance, validated_data):
        # category_id → category object already resolved in validate()
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


# ──────────────────────────────────────────────────────────────────────────────
# Availability toggle — lightweight PATCH for the daily on/off switch
# ──────────────────────────────────────────────────────────────────────────────

class MenuItemAvailabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model  = MenuItem
        fields = ['is_available']
