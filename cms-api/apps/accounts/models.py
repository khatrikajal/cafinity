# Cafinity rebrand — logo + favicon update
"""
apps/accounts/models.py

Phase 1 — Standalone stub.
Contains:
  - User          : Custom AbstractUser (AUTH_USER_MODEL = 'accounts.User')
  - Employee      : Stub mirroring HRMS schema exactly.
  - Company / Location / Department / SalaryGrade / EmployeeCategory : HRMS stubs.

Phase 2 — Remove this entire app.
  - Point AUTH_USER_MODEL at the HRMS User model.
  - Point all cms_ FK columns at live HRMS tables.
  - Zero CMS schema changes required.
"""

import uuid
from django.utils import timezone

from django.contrib.auth.models import AbstractUser
from django.db import models


# ──────────────────────────────────────────────────────────────────────────────
# Role constants — used by permission classes in apps/common/permissions.py
# ──────────────────────────────────────────────────────────────────────────────

class RoleChoices:
    SUPER_ADMIN      = 'SUPER_ADMIN'
    COMPANY_ADMIN    = 'COMPANY_ADMIN'
    CANTEEN_ADMIN    = 'CANTEEN_ADMIN'   # CMS-specific admin role
    LIMITED_ADMIN    = 'LIMITED_ADMIN'   # Limited admin with specific section access
    HR_MANAGER       = 'HR_MANAGER'
    PAYROLL_MANAGER  = 'PAYROLL_MANAGER'
    EMPLOYEE         = 'EMPLOYEE'

    ALL_ADMIN_ROLES = {SUPER_ADMIN, COMPANY_ADMIN, CANTEEN_ADMIN, LIMITED_ADMIN, HR_MANAGER, PAYROLL_MANAGER}
    CMS_ADMIN_ROLES = {SUPER_ADMIN, COMPANY_ADMIN, CANTEEN_ADMIN}


# ──────────────────────────────────────────────────────────────────────────────
# Custom User — AUTH_USER_MODEL
# ──────────────────────────────────────────────────────────────────────────────

class User(AbstractUser):
    """
    Custom user model for all human users (Employees + Admins).
    Kitchen / Counter device accounts are NOT here — see apps/cms/models/device.py.

    AUTH_USER_MODEL = 'accounts.User'
    """

    ROLE_CHOICES = [
        (RoleChoices.SUPER_ADMIN,     'Super Admin'),
        (RoleChoices.COMPANY_ADMIN,   'Company Admin'),
        (RoleChoices.CANTEEN_ADMIN,   'Canteen Admin'),   # CMS-specific
        (RoleChoices.LIMITED_ADMIN,   'Limited Admin'),   # Limited admin with specific section access
        (RoleChoices.HR_MANAGER,      'HR Manager'),
        (RoleChoices.PAYROLL_MANAGER, 'Payroll Manager'),
        (RoleChoices.EMPLOYEE,        'Employee'),
    ]

    id        = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role_type = models.CharField(
        max_length=50,
        choices=ROLE_CHOICES,
        default=RoleChoices.EMPLOYEE,
        db_index=True,
    )
    
    # 2FA and password policy for employees
    must_change_password = models.BooleanField(
        default=False,
        help_text="If true, employee must reset password before normal login"
    )
    require_otp_after_password_change = models.BooleanField(
        default=False,
        help_text="If true, next login requires OTP after password was changed/reset"
    )
    password_changed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When password was last changed or reset"
    )
    last_2fa_verified_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When user last completed OTP verification"
    )

    class Meta:
        db_table = 'core_users'

    def __str__(self):
        return self.get_full_name() or self.username
    
    def save(self, *args, **kwargs):
        if self.is_superuser:
            self.role_type = RoleChoices.SUPER_ADMIN
        super().save(*args, **kwargs)

    @property
    def is_any_admin(self):
        return self.role_type in RoleChoices.ALL_ADMIN_ROLES

    @property
    def is_cms_admin(self):
        return self.role_type in RoleChoices.CMS_ADMIN_ROLES


# ──────────────────────────────────────────────────────────────────────────────
# HRMS Stub models — mirrors exact HRMS schema so Phase 2 FK swap is additive
# ──────────────────────────────────────────────────────────────────────────────

class Company(models.Model):
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name       = models.CharField(max_length=200)
    code       = models.CharField(max_length=20, unique=True)
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'companies'

    def __str__(self):
        return f"{self.name} ({self.code})"


class Location(models.Model):
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company    = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='locations')
    name       = models.CharField(max_length=200)
    city       = models.CharField(max_length=100, blank=True)
    state      = models.CharField(max_length=100, blank=True)
    country    = models.CharField(max_length=100, default='India')
    timezone   = models.CharField(max_length=60, default='Asia/Kolkata')
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'mst_location'

    def __str__(self):
        return f"{self.name} ({self.city})"


class Department(models.Model):
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company    = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='departments')
    name       = models.CharField(max_length=200)
    code       = models.CharField(max_length=20, blank=True)
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'departments'

    def __str__(self):
        return self.name


class SalaryGrade(models.Model):
    id        = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company   = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='salary_grades')
    name      = models.CharField(max_length=100)
    code      = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'mst_salary_grade'

    def __str__(self):
        return self.name


class EmployeeCategory(models.Model):
    id                   = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company              = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='employee_categories')
    name                 = models.CharField(max_length=100)
    code                 = models.CharField(max_length=20, blank=True)
    is_discount_eligible = models.BooleanField(
        default=False,
        help_text='Mark this employee category as eligible for discounted menu pricing.',
    )
    is_active            = models.BooleanField(default=True)

    class Meta:
        db_table = 'employee_categories'

    def __str__(self):
        return self.name


class Employee(models.Model):
    """
    Phase 1 stub — mirrors HRMS Employee schema exactly.

    The 'user' OneToOne allows:
        request.user.employee_profile  (from ESS views)

    Phase 2: this model is removed. FK constraints in cms_ tables
    re-point to the live HRMS Employee model. Zero column changes.

    NOTE: related_name='employee_profile' is intentional —
    CmsTokenObtainPairSerializer uses user.employee_profile to
    pull company_id and employee_id into the JWT.
    """

    GENDER_CHOICES = [
        ('Male', 'Male'),
        ('Female', 'Female'),
        ('Other', 'Other'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.OneToOneField(
        'accounts.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='employee_profile',   # access via request.user.employee_profile
    )

    company           = models.ForeignKey(Company, on_delete=models.PROTECT, null=True, blank=True, related_name='employees')
    employee_code     = models.CharField(max_length=20, unique=True)
    first_name        = models.CharField(max_length=100)
    last_name         = models.CharField(max_length=100)
    email             = models.EmailField(unique=True)
    phone             = models.CharField(max_length=20, blank=True, null=True)
    designation       = models.CharField(max_length=100, blank=True, null=True)
    joining_date      = models.DateField(blank=True, null=True)
    gender            = models.CharField(max_length=20, choices=GENDER_CHOICES, blank=True, null=True)
    address           = models.TextField(blank=True, null=True)
    department        = models.ForeignKey(Department, on_delete=models.SET_NULL, null=True, blank=True, related_name='employees')
    canteen           = models.ForeignKey('cms.CanteenLocation', on_delete=models.SET_NULL, null=True, blank=True, related_name='employees')
    salary_grade      = models.ForeignKey(SalaryGrade, on_delete=models.SET_NULL, null=True, blank=True, related_name='employees')
    employee_category = models.ForeignKey(EmployeeCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='employees')
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'employees'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.first_name} {self.last_name} ({self.employee_code})"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()


class PasswordResetToken(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        related_name="password_reset_tokens",
    )
    token = models.CharField(max_length=128, unique=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_from = models.CharField(max_length=32, default="forgot_password")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "auth_password_reset_tokens"
        indexes = [
            models.Index(fields=["user", "expires_at"], name="idx_prt_user_expires"),
        ]

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at
