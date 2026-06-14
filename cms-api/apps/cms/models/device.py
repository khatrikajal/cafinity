"""
apps/cms/models/device.py

KitchenCounterUser — device account model for Kitchen and Counter tablets.

Design rules (from architecture doc):
  - NOT linked to the employees table. Ever.
  - NOT an AbstractUser subclass. Django auth machinery does not touch this.
  - PIN stored as bcrypt hash. Never plaintext.
  - Scoped to ONE canteen. A separate account is created per canteen.
  - Role is either KITCHEN or COUNTER — no other values accepted.
  - JWT TTL: 8 hours (one shift). No refresh token issued.

Phase 2: this model stays exactly as-is. HRMS knows nothing about it.
"""

import uuid

import bcrypt
from django.db import models


class KitchenCounterUser(models.Model):
    """
    Device account for a Kitchen board tablet or Counter station tablet.
    Created and managed entirely by CMS Admin.
    """

    ROLE_KITCHEN = 'KITCHEN'
    ROLE_COUNTER = 'COUNTER'

    ROLE_CHOICES = [
        (ROLE_KITCHEN, 'Kitchen'),
        (ROLE_COUNTER, 'Counter'),
    ]

    id           = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Tenant + canteen scope — mandatory
    company_id   = models.UUIDField(db_index=True)                 # FK enforced at app layer
    canteen_id   = models.UUIDField(db_index=True)                 # FK enforced at app layer

    username     = models.CharField(max_length=100, unique=True)   # e.g. 'kitchen-main', 'counter-01'
    display_name = models.CharField(max_length=100)                # shown on the device UI
    role         = models.CharField(max_length=10, choices=ROLE_CHOICES, db_index=True)

    # bcrypt hash of the 4-8 digit PIN.  Never store raw PIN.
    pin_hash     = models.CharField(max_length=200)

    is_active    = models.BooleanField(default=True, db_index=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'cms_kitchen_counter_users'
        verbose_name = 'Kitchen / Counter User'
        verbose_name_plural = 'Kitchen / Counter Users'
        indexes = [
            # Fast lookup for login: username is already UNIQUE but this
            # composite speeds up the is_active filter added at query time.
            models.Index(fields=['username', 'is_active'], name='idx_kcu_username_active'),
            # Admin list view — all devices for a canteen
            models.Index(fields=['canteen_id', 'role'], name='idx_kcu_canteen_role'),
        ]

    def __str__(self):
        return f"{self.display_name} [{self.role}] @ canteen:{self.canteen_id}"

    # ── PIN helpers ───────────────────────────────────────────────────────────

    def set_pin(self, raw_pin: str) -> None:
        """
        Hash and store a new PIN.
        Call this instead of setting pin_hash directly.

        Usage:
            device_user.set_pin('4821')
            device_user.save()
        """
        self.pin_hash = bcrypt.hashpw(
            raw_pin.encode('utf-8'),
            bcrypt.gensalt(rounds=12),
        ).decode('utf-8')

    def check_pin(self, raw_pin: str) -> bool:
        """
        Verify a raw PIN against the stored bcrypt hash.
        Always runs to prevent timing attacks even when pin_hash is empty.
        """
        try:
            return bcrypt.checkpw(
                raw_pin.encode('utf-8'),
                self.pin_hash.encode('utf-8'),
            )
        except Exception:
            return False