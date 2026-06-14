"""Serializers for report endpoints."""

from __future__ import annotations

from rest_framework import serializers


class ReportEnvelopeSerializer(serializers.Serializer):
    """Generic paginated/enveloped report response."""

    results = serializers.JSONField()
    count = serializers.IntegerField()
    page = serializers.IntegerField(required=False)
    pageSize = serializers.IntegerField(required=False)
    totalPages = serializers.IntegerField(required=False)
    totalRevenue = serializers.FloatField(required=False)
    totalUnits = serializers.IntegerField(required=False)
    totalOrders = serializers.IntegerField(required=False)
    averageOrderValue = serializers.FloatField(required=False)
    generatedAt = serializers.DateTimeField(required=False)


class ReportSummarySerializer(serializers.Serializer):
    """Generic report summary payload."""

    label = serializers.CharField()
    value = serializers.FloatField()
    count = serializers.IntegerField(required=False)


class ReportErrorSerializer(serializers.Serializer):
    """Standard error response for report endpoints."""

    detail = serializers.CharField(required=False)
    error = serializers.CharField(required=False)
