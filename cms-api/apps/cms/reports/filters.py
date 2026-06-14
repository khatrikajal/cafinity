"""Query parameter validation for report endpoints."""

from __future__ import annotations

from datetime import date

from django.utils import timezone
from rest_framework import serializers


class ReportQuerySerializer(serializers.Serializer):
    """Shared filter validation for report endpoints."""

    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    range = serializers.ChoiceField(required=False, choices=["today", "7d", "30d", "month", "all"])
    search = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    status = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    canteen_id = serializers.UUIDField(required=False)
    slot_id = serializers.UUIDField(required=False)
    employee_id = serializers.UUIDField(required=False)
    page = serializers.IntegerField(required=False, min_value=1, default=1)
    page_size = serializers.IntegerField(required=False, min_value=1, max_value=100, default=10)
    ordering = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    group_by = serializers.ChoiceField(required=False, choices=["day", "week", "month", "slot", "item", "employee"])
    export = serializers.ChoiceField(required=False, choices=["csv", "xlsx", "excel", "json"])
    timezone = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True, default=timezone.get_current_timezone_name())

    def validate(self, attrs):
        attrs = super().validate(attrs)
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_from > date_to:
            raise serializers.ValidationError({"date_to": "date_to must be greater than or equal to date_from."})
        return attrs


class ExportQuerySerializer(serializers.Serializer):
    """Simple export toggle validator."""

    export = serializers.ChoiceField(required=False, choices=["csv", "xlsx", "excel", "json"])
