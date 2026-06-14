# Cafinity Security Fix — VAPT June 2026 — Harden audit admin
from django.contrib import admin

from apps.audit.models import AuditLog
from apps.core.admin_mixins import ReadOnlyForNonSuperuserAdminMixin


@admin.register(AuditLog)
class AuditLogAdmin(ReadOnlyForNonSuperuserAdminMixin, admin.ModelAdmin):
    list_display = (
        "timestamp",
        "actor_email",
        "actor_role",
        "action_category",
        "action",
        "target_model",
        "target_display",
        "is_sensitive",
    )
    list_filter = ("action_category", "actor_role", "is_sensitive", "timestamp")
    search_fields = ("actor_email", "action", "target_model", "target_display", "target_id")
    readonly_fields = [field.name for field in AuditLog._meta.fields]
    ordering = ("-timestamp",)
    date_hierarchy = "timestamp"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
