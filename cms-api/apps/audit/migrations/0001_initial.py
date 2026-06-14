import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("actor_type", models.CharField(choices=[("SUPER_ADMIN", "Super Admin"), ("LIMITED_ADMIN", "Limited Admin"), ("SYSTEM", "System")], max_length=32)),
                ("actor_email", models.CharField(blank=True, default="", max_length=255)),
                ("actor_role", models.CharField(blank=True, default="", max_length=64)),
                ("action_category", models.CharField(choices=[("AUTH", "Auth"), ("USER_MGMT", "User Management"), ("MENU", "Menu"), ("SLOT", "Slot"), ("CANTEEN", "Canteen"), ("GUEST_MENU", "Guest Menu"), ("ORDERS", "Orders"), ("EVENTS", "Events"), ("SETTINGS", "Settings"), ("PERMISSIONS", "Permissions")], max_length=32)),
                ("action", models.CharField(max_length=128)),
                ("target_model", models.CharField(blank=True, default="", max_length=128)),
                ("target_id", models.CharField(blank=True, max_length=128, null=True)),
                ("target_display", models.CharField(blank=True, default="", max_length=255)),
                ("previous_state", models.JSONField(blank=True, null=True)),
                ("new_state", models.JSONField(blank=True, null=True)),
                ("changed_fields", models.JSONField(blank=True, null=True)),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.TextField(blank=True, null=True)),
                ("metadata", models.JSONField(blank=True, null=True)),
                ("timestamp", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("is_sensitive", models.BooleanField(default=False)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audit_logs", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "audit_logs",
                "ordering": ["-timestamp"],
            },
        ),
        migrations.AddIndex(model_name="auditlog", index=models.Index(fields=["actor"], name="audit_logs_actor_i_0badd2_idx")),
        migrations.AddIndex(model_name="auditlog", index=models.Index(fields=["action_category"], name="audit_logs_action__e82efb_idx")),
        migrations.AddIndex(model_name="auditlog", index=models.Index(fields=["action"], name="audit_logs_action_31f574_idx")),
        migrations.AddIndex(model_name="auditlog", index=models.Index(fields=["target_model"], name="audit_logs_target__241275_idx")),
        migrations.AddIndex(model_name="auditlog", index=models.Index(fields=["timestamp"], name="audit_logs_timesta_423be6_idx")),
    ]
