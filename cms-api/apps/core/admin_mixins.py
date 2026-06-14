# Cafinity Security Fix — VAPT June 2026 — Hardened Django admin defaults
class ReadOnlyForNonSuperuserAdminMixin:
    """Make model fields read-only and disable delete for non-superusers."""

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if not request.user.is_superuser:
            for field in self.model._meta.fields:
                if field.name not in readonly:
                    readonly.append(field.name)
        return readonly

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser
