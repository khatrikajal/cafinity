import uuid

from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    ACTOR_SUPER_ADMIN = "SUPER_ADMIN"
    ACTOR_LIMITED_ADMIN = "LIMITED_ADMIN"
    ACTOR_SYSTEM = "SYSTEM"
    ACTOR_TYPE_CHOICES = [
        (ACTOR_SUPER_ADMIN, "Super Admin"),
        (ACTOR_LIMITED_ADMIN, "Limited Admin"),
        (ACTOR_SYSTEM, "System"),
    ]

    ACTION_AUTH = "AUTH"
    ACTION_USER_MGMT = "USER_MGMT"
    ACTION_MENU = "MENU"
    ACTION_SLOT = "SLOT"
    ACTION_CANTEEN = "CANTEEN"
    ACTION_GUEST_MENU = "GUEST_MENU"
    ACTION_ORDERS = "ORDERS"
    ACTION_EVENTS = "EVENTS"
    ACTION_SETTINGS = "SETTINGS"
    ACTION_PERMISSIONS = "PERMISSIONS"
    ACTION_CATEGORY_CHOICES = [
        (ACTION_AUTH, "Auth"),
        (ACTION_USER_MGMT, "User Management"),
        (ACTION_MENU, "Menu"),
        (ACTION_SLOT, "Slot"),
        (ACTION_CANTEEN, "Canteen"),
        (ACTION_GUEST_MENU, "Guest Menu"),
        (ACTION_ORDERS, "Orders"),
        (ACTION_EVENTS, "Events"),
        (ACTION_SETTINGS, "Settings"),
        (ACTION_PERMISSIONS, "Permissions"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    actor_type = models.CharField(max_length=32, choices=ACTOR_TYPE_CHOICES)
    actor_email = models.CharField(max_length=255, blank=True, default="")
    actor_role = models.CharField(max_length=64, blank=True, default="")
    action_category = models.CharField(max_length=32, choices=ACTION_CATEGORY_CHOICES)
    action = models.CharField(max_length=128)
    target_model = models.CharField(max_length=128, blank=True, default="")
    target_id = models.CharField(max_length=128, null=True, blank=True)
    target_display = models.CharField(max_length=255, blank=True, default="")
    previous_state = models.JSONField(null=True, blank=True)
    new_state = models.JSONField(null=True, blank=True)
    changed_fields = models.JSONField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    metadata = models.JSONField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    is_sensitive = models.BooleanField(default=False)

    class Meta:
        db_table = "audit_logs"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["actor"]),
            models.Index(fields=["action_category"]),
            models.Index(fields=["action"]),
            models.Index(fields=["target_model"]),
            models.Index(fields=["timestamp"]),
        ]

    def __str__(self):
        return f"{self.action_category}:{self.action} @ {self.timestamp}"
