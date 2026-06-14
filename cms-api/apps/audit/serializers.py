from rest_framework import serializers

from apps.audit.models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor",
            "actor_name",
            "actor_type",
            "actor_email",
            "actor_role",
            "action_category",
            "action",
            "target_model",
            "target_id",
            "target_display",
            "previous_state",
            "new_state",
            "changed_fields",
            "ip_address",
            "user_agent",
            "metadata",
            "timestamp",
            "is_sensitive",
        ]

    def get_actor_name(self, obj):
        if obj.actor is None:
            return "SYSTEM"
        return obj.actor.get_full_name() or obj.actor.username

    def to_representation(self, instance):
        data = super().to_representation(instance)
        can_view_sensitive = bool(self.context.get("can_view_sensitive", False))
        if instance.is_sensitive and not can_view_sensitive:
            data["previous_state"] = "***RESTRICTED***"
            data["new_state"] = "***RESTRICTED***"
        return data
