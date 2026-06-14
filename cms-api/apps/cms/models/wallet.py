import uuid

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class WalletTransactionType:
    CREDIT = 'CREDIT'
    DEBIT = 'DEBIT'

    CHOICES = [
        (CREDIT, 'Credit'),
        (DEBIT, 'Debit'),
    ]


class CanteenWallet(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.OneToOneField(
        'accounts.Employee',
        on_delete=models.PROTECT,
        related_name='canteen_wallet',
        db_column='employee_id',
    )
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=1000)
    monthly_spending_limit = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Maximum amount employee can spend in a calendar month. Empty means unlimited.',
    )
    is_active = models.BooleanField(default=True)
    last_recharged_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cms_canteen_wallets'

    def __str__(self):
        return f"{self.employee_id}: {self.balance}"


class WalletTransaction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wallet = models.ForeignKey(
        CanteenWallet,
        on_delete=models.PROTECT,
        related_name='transactions',
        db_column='wallet_id',
    )
    employee = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.PROTECT,
        related_name='wallet_transactions',
        db_column='employee_id',
    )
    order = models.ForeignKey(
        'cms.Order',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='wallet_transactions',
        db_column='order_id',
    )
    transaction_type = models.CharField(max_length=10, choices=WalletTransactionType.CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.CharField(max_length=255)
    reference = models.CharField(max_length=80, blank=True, default='')
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = 'cms_wallet_transactions'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['employee_id', 'created_at'], name='idx_wtxn_employee_created'),
            models.Index(fields=['order_id'], name='idx_wtxn_order'),
        ]

    def clean(self):
        if self.amount is not None and self.amount <= 0:
            raise ValidationError({'amount': 'Amount must be positive.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.transaction_type} {self.amount} [{self.employee_id}]"
