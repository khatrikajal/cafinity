from rest_framework import serializers
from apps.cms.models import Announcement, SpecialDish
from apps.core.mixins import SanitizeInputMixin
from apps.core.sanitizers import sanitize_text


class AnnouncementSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    FIELDS_TO_SANITIZE = ['title', 'message', 'special_dish']
    time_range = serializers.ReadOnlyField()

    class Meta:
        model = Announcement
        fields = [
            'id',
            'title',
            'message',
            'date',
            'time_from',
            'time_to',
            'time_range',
            'special_dish',
            'status',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'time_range']

    def validate(self, data):
        time_from = data.get('time_from', getattr(self.instance, 'time_from', None))
        time_to = data.get('time_to', getattr(self.instance, 'time_to', None))
        if time_from and time_to and time_from >= time_to:
            raise serializers.ValidationError(
                {"time_to": "End time must be after start time."}
            )
        return data


class AnnouncementStatsSerializer(serializers.Serializer):
    total = serializers.IntegerField()
    active = serializers.IntegerField()
    inactive = serializers.IntegerField()
    with_special_dish = serializers.IntegerField()


class AnnouncementToggleStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Announcement.STATUS_CHOICES)


class SpecialDishSerializer(SanitizeInputMixin, serializers.ModelSerializer):
    class Meta:
        model = SpecialDish
        fields = ['id', 'name', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate_name(self, value):
        normalized = sanitize_text(value)
        if not normalized:
            raise serializers.ValidationError("Special dish name is required.")
        return normalized
