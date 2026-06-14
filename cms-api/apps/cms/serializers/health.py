from rest_framework import serializers


class HealthResponseSerializer(serializers.Serializer):
    api = serializers.CharField()
    database = serializers.CharField()