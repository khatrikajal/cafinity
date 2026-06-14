# Cafinity Security Fix — VAPT June 2026 — Serializer sanitization mixin
# Cafinity Security Fix Round 2 — VAPT June 2026 — CanteenScopeMixin
from apps.core.canteen_scope import scope_queryset_by_canteen, validate_canteen_access
from apps.core.sanitizers import sanitize_text
from django.utils.html import strip_tags
from rest_framework import serializers



class CanteenScopeMixin:
    canteen_scope_field = 'canteen_id'

    def scope_canteen_queryset(self, queryset):
        return scope_queryset_by_canteen(self.request, queryset, self.canteen_scope_field)

    def validate_request_canteen(self, canteen_id):
        return validate_canteen_access(self.request, canteen_id)


class SanitizeInputMixin:
    """
    Generic sanitization mixin.

    FIELDS_TO_SANITIZE:
        Fields that should be sanitized before saving.

    FIELDS_TO_REJECT_HTML:
        Fields that should reject HTML entirely.
        This is opt-in so existing serializers continue working.
    """

    FIELDS_TO_SANITIZE = []
    FIELDS_TO_REJECT_HTML = []

    def validate(self, attrs):
        attrs = super().validate(attrs)

        # Reject HTML only for explicitly configured fields
        for field in self.FIELDS_TO_REJECT_HTML:
            value = attrs.get(field)

            if not isinstance(value, str):
                continue

            if value != strip_tags(value):
                raise serializers.ValidationError({
                    field: "HTML content is not allowed."
                })

        fields = self.FIELDS_TO_SANITIZE or [
            field
            for field, value in attrs.items()
            if isinstance(value, str)
        ]

        for field in fields:
            if field in attrs and isinstance(attrs[field], str):
                attrs[field] = sanitize_text(attrs[field])

        return attrs
