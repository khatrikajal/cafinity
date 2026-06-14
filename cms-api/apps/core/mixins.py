# Cafinity Security Fix — VAPT June 2026 — Serializer sanitization mixin
# Cafinity Security Fix Round 2 — VAPT June 2026 — CanteenScopeMixin
from apps.core.canteen_scope import scope_queryset_by_canteen, validate_canteen_access
from apps.core.sanitizers import sanitize_text


class CanteenScopeMixin:
    canteen_scope_field = 'canteen_id'

    def scope_canteen_queryset(self, queryset):
        return scope_queryset_by_canteen(self.request, queryset, self.canteen_scope_field)

    def validate_request_canteen(self, canteen_id):
        return validate_canteen_access(self.request, canteen_id)


class SanitizeInputMixin:
    FIELDS_TO_SANITIZE = []

    def validate(self, attrs):
        attrs = super().validate(attrs)
        fields = self.FIELDS_TO_SANITIZE or [
            field for field, value in attrs.items() if isinstance(value, str)
        ]
        for field in fields:
            if field in attrs and isinstance(attrs[field], str):
                attrs[field] = sanitize_text(attrs[field])
        return attrs
