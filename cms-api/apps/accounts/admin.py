# Cafinity Security Fix — VAPT June 2026 — Harden Django admin registrations
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.accounts.models import User, Company, Employee, Location, EmployeeCategory
from apps.core.admin_mixins import ReadOnlyForNonSuperuserAdminMixin


@admin.register(User)
class UserAdmin(ReadOnlyForNonSuperuserAdminMixin, BaseUserAdmin):
    list_display = (
        "username",
        "email",
        "first_name",
        "last_name",
        "role_type",
        "is_staff",
    )

    list_filter = (
        "role_type",
        "is_staff",
        "is_superuser",
        "is_active",
    )

    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "Custom Fields",
            {
                "fields": ("role_type",),
            },
        ),
    )

    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        (
            "Custom Fields",
            {
                "fields": ("role_type",),
            },
        ),
    )


@admin.register(Company)
class CompanyAdmin(ReadOnlyForNonSuperuserAdminMixin, admin.ModelAdmin):
    list_display = ('name', 'code', 'is_active')


@admin.register(Employee)
class EmployeeAdmin(ReadOnlyForNonSuperuserAdminMixin, admin.ModelAdmin):
    list_display = ('employee_code', 'full_name', 'department', 'is_active')


@admin.register(Location)
class LocationAdmin(ReadOnlyForNonSuperuserAdminMixin, admin.ModelAdmin):
    list_display = ('name', 'company', 'is_active')


@admin.register(EmployeeCategory)
class EmployeeCategoryAdmin(ReadOnlyForNonSuperuserAdminMixin, admin.ModelAdmin):
    list_display = ('name', 'code', 'is_discount_eligible', 'is_active')
    list_filter = ('is_discount_eligible', 'is_active')
    search_fields = ('name', 'code')
