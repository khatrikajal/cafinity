"""
apps/cms/models/billing.py

Billing models for Cafinity CMS.

Tables:
  - BillingLedger   → cms_billing_ledger
  - BillingSummary  → cms_billing_summaries

Schema audit notes:
  1. Schema is correct and self-consistent:
       - Every collected order (DELIVERED) writes a DEBIT row to BillingLedger.
       - Every cancellation that had already been billed writes a CREDIT row.
       - BillingSummary is the month-end aggregate — generated from ledger rows.
       - UNIQUE(employee_id, billing_month) on BillingSummary is correct —
         one summary row per employee per month.

  2. transaction_type CHECK constraint: schema specifies
     CHECK IN ('DEBIT','CREDIT','ADJUSTMENT').
     Django does not emit SQL CHECK constraints by default — enforced via
     CharField choices + model clean() below. In production, add a Postgres
     CHECK constraint via a migration RunSQL for DB-level safety.

  3. billing_month VARCHAR(7) 'YYYY-MM': kept as CharField per spec.
     Do NOT use DateField — that would require a full date and break the
     "one row per month" semantics. Validated in clean().

  4. is_locked on BillingLedger: once TRUE, no service layer code should
     modify that row. Enforced at service layer (no DB trigger in Phase 1).

Dependency chain:
  Order (DELIVERED) → BillingLedger (DEBIT row) → BillingSummary (aggregate)
  Order (CANCELLED, was billed) → BillingLedger (CREDIT row) → BillingSummary updated

N+1 / Index / Prefetch strategy:
  BillingLedger:
    - Never iterate ledger rows and access .order or .employee in a loop
      without select_related.
    - Primary access pattern: aggregate by employee+month for summary generation.
      Index on (employee_id, billing_month) covers this exactly.
    - Secondary: admin ledger view per canteen per month.
      Index on (canteen_id, billing_month) covers this.

  BillingSummary:
    - Lookup is always (employee_id, billing_month) — covered by unique_together.
    - Company-wide payroll export: (company_id, billing_month, status).
      Index added for this pattern.
    - No prefetch needed — summary rows are scalar aggregates, no FK loops.
"""

import uuid
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

class TransactionType:
    DEBIT      = 'DEBIT'
    CREDIT     = 'CREDIT'
    ADJUSTMENT = 'ADJUSTMENT'

    CHOICES = [
        (DEBIT,      'Debit — charge for collected order'),
        (CREDIT,     'Credit — reversal for cancellation'),
        (ADJUSTMENT, 'Adjustment — manual correction'),
    ]


class SummaryStatus:
    DRAFT      = 'DRAFT'
    FINALISED  = 'FINALISED'
    PROCESSED  = 'PROCESSED'

    CHOICES = [
        (DRAFT,     'Draft — editable, not sent to payroll'),
        (FINALISED, 'Finalised — locked, awaiting payroll'),
        (PROCESSED, 'Processed — payroll confirmed deduction'),
    ]

    # Valid forward transitions
    TRANSITIONS = {
        DRAFT:     {FINALISED},
        FINALISED: {PROCESSED},
        PROCESSED: set(),
    }


# ──────────────────────────────────────────────────────────────────────────────
# BillingLedger
# ──────────────────────────────────────────────────────────────────────────────

class BillingLedger(models.Model):
    """
    cms_billing_ledger

    Running ledger — single source of truth for all billing transactions.

    Write rules (enforced at service layer):
      DELIVERED order   → one DEBIT row (amount = order.total_amount)
      CANCELLED order   → one CREDIT row IF the order had already been billed
                          (is_billed=True on the order)
      Manual correction → ADJUSTMENT row (requires admin + reason)

    Read rules:
      Net spend = SUM(DEBIT) - SUM(CREDIT) for (employee, billing_month)
      This query hits idx_bl_employee_month directly.

    Immutability:
      is_locked=True rows must NEVER be modified. Service layer checks this
      before any update. A Postgres trigger should enforce this in production.

    N+1 prevention:
      When displaying a ledger list with order details, use:
        BillingLedger.objects
          .select_related('employee', 'order')
          .filter(canteen_id=X, billing_month='YYYY-MM')
      The 'order' join gives order_code and status without an extra query.
      Do NOT access ledger.order.items in a loop — use a separate
      prefetch_related if line items are needed.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    employee = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.PROTECT,
        related_name='billing_ledger_entries',
        db_column='employee_id',
    )
    canteen = models.ForeignKey(
        'cms.CanteenLocation',
        on_delete=models.PROTECT,
        related_name='billing_ledger_entries',
        db_column='canteen_id',
    )
    order = models.ForeignKey(
        'cms.Order',
        on_delete=models.PROTECT,       # never delete orders that have billing rows
        related_name='billing_entries',
        db_column='order_id',
    )

    transaction_type = models.CharField(
        max_length=20,
        choices=TransactionType.CHOICES,
    )

    # Always positive — type determines direction (DEBIT=charge, CREDIT=reversal)
    amount = models.DecimalField(
        max_digits=10, decimal_places=2,
        help_text='Always positive. Transaction type determines charge vs reversal.',
    )

    # YYYY-MM format — VARCHAR(7) per spec
    billing_month = models.CharField(
        max_length=7,
        help_text='Format: YYYY-MM  e.g. 2025-01',
    )

    description    = models.TextField(null=True, blank=True)
    is_locked      = models.BooleanField(
        default=False,
        db_index=True,
        help_text='True after billing period is locked. Row must not be modified.',
    )
    transacted_at  = models.DateTimeField(default=timezone.now)

    created_by = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='created_billing_entries',
        db_column='created_by',
        help_text='NULL = system-generated (e.g. auto-billing on DELIVERED).',
    )

    class Meta:
        db_table = 'cms_billing_ledger'
        ordering = ['-transacted_at']
        indexes  = [
            # ── Primary aggregation query ──────────────────────────────────────
            # "Net spend for employee X in month YYYY-MM"
            # SELECT SUM(amount) WHERE employee_id=X AND billing_month='YYYY-MM'
            # AND transaction_type IN ('DEBIT','CREDIT')
            models.Index(
                fields=['employee_id', 'billing_month'],
                name='idx_bl_employee_month',
            ),

            # ── Admin ledger view ──────────────────────────────────────────────
            # "All transactions for canteen X in month YYYY-MM"
            models.Index(
                fields=['canteen_id', 'billing_month'],
                name='idx_bl_canteen_month',
            ),

            # ── Unlock / lock queries ──────────────────────────────────────────
            # "All unlocked entries for this month" (month-end lock operation)
            models.Index(
                fields=['billing_month', 'is_locked'],
                name='idx_bl_month_locked',
            ),

            # ── Order → ledger lookup ──────────────────────────────────────────
            # FK index on order_id is created automatically by Django.
            # Used by: "does this order already have a billing entry?"
            # No extra index needed — FK covers it.
        ]

    def clean(self):
        # Validate billing_month format YYYY-MM
        if self.billing_month:
            import re
            if not re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', self.billing_month):
                raise ValidationError(
                    {'billing_month': 'Must be in YYYY-MM format, e.g. 2025-01.'}
                )
        # Validate amount is positive
        if self.amount is not None and self.amount <= 0:
            raise ValidationError({'amount': 'Amount must be positive.'})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return (
            f"{self.transaction_type} ₹{self.amount} "
            f"[{self.employee_id} / {self.billing_month}]"
        )


# ──────────────────────────────────────────────────────────────────────────────
# BillingSummary
# ──────────────────────────────────────────────────────────────────────────────

class BillingSummary(models.Model):
    """
    cms_billing_summaries

    Month-end aggregated summary per employee.
    Generated (or regenerated) by the billing service from BillingLedger rows.
    Used for payroll deduction export.

    Lifecycle:
      DRAFT     → editable, recalculated on demand
      FINALISED → is_locked=True on all ledger entries for this month;
                  summary is frozen; payroll file generated
      PROCESSED → payroll system confirmed the deduction

    UNIQUE constraint: (employee_id, billing_month)
      Enforced at both DB level (unique_together) and service layer.
      Use update_or_create() — never create() — to avoid race conditions.

    Computed fields (always derived from ledger, never set manually):
      total_orders   = COUNT(ledger DEBIT rows for employee+month)
      total_amount   = SUM(ledger DEBIT amounts)
      total_reversals= SUM(ledger CREDIT amounts)
      net_deduction  = total_amount - total_reversals

    N+1 prevention:
      When generating payroll export for a company+month, fetch all summaries
      with employee joined:
        BillingSummary.objects
          .select_related('employee', 'finalised_by_employee')
          .filter(company_id=X, billing_month='YYYY-MM', status=FINALISED)
      This is the only FK chain that matters for export — no further joins.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    company = models.ForeignKey(
        'accounts.Company',
        on_delete=models.PROTECT,
        related_name='billing_summaries',
        db_column='company_id',
    )
    employee = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.PROTECT,
        related_name='billing_summaries',
        db_column='employee_id',
    )

    billing_month = models.CharField(
        max_length=7,
        help_text='Format: YYYY-MM',
    )

    # ── Aggregated amounts — always recomputed from ledger ────────────────────
    total_orders    = models.IntegerField(default=0)
    total_amount    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_reversals = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_deduction   = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text='total_amount - total_reversals. Always recomputed — never set manually.',
    )

    status = models.CharField(
        max_length=20,
        choices=SummaryStatus.CHOICES,
        default=SummaryStatus.DRAFT,
        db_index=True,
    )

    # ── Lifecycle timestamps + actors ─────────────────────────────────────────
    finalised_at = models.DateTimeField(null=True, blank=True)
    finalised_by = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='finalised_billing_summaries',
        db_column='finalised_by',
    )

    processed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cms_billing_summaries'
        ordering = ['-billing_month', 'employee_id']

        # UNIQUE constraint — one summary per employee per month
        # Also serves as the primary index for employee+month lookups.
        unique_together = [('employee', 'billing_month')]

        indexes = [
            # ── Company payroll export ────────────────────────────────────────
            # "All FINALISED summaries for company X in month YYYY-MM"
            # This is the hot path for payroll file generation.
            models.Index(
                fields=['company_id', 'billing_month', 'status'],
                name='idx_bs_company_month_status',
            ),

            # ── Admin dashboard ───────────────────────────────────────────────
            # "All summaries for this month across all employees"
            # unique_together already creates (employee_id, billing_month) index.
            # This adds (billing_month, status) for admin month-view filtering.
            models.Index(
                fields=['billing_month', 'status'],
                name='idx_bs_month_status',
            ),
        ]

    def clean(self):
        import re
        if self.billing_month:
            if not re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', self.billing_month):
                raise ValidationError(
                    {'billing_month': 'Must be in YYYY-MM format, e.g. 2025-01.'}
                )
        if self.net_deduction is not None and self.total_amount is not None and self.total_reversals is not None:
            expected = self.total_amount - self.total_reversals
            if abs(self.net_deduction - expected) > Decimal('0.001'):
                raise ValidationError(
                    {'net_deduction': 'Must equal total_amount - total_reversals.'}
                )

    def recompute(self):
        """
        Recomputes all aggregate fields from the BillingLedger.
        Call this after adding/removing ledger rows.
        Never set total_amount, total_reversals, net_deduction directly.

        Usage:
            summary = BillingSummary.objects.get(employee=emp, billing_month='2025-01')
            summary.recompute()
            summary.save(update_fields=['total_orders','total_amount',
                                        'total_reversals','net_deduction','updated_at'])
        """
        from django.db.models import Count, Sum, Q

        agg = BillingLedger.objects.filter(
            employee_id=self.employee_id,
            billing_month=self.billing_month,
        ).aggregate(
            debit_count=Count(
                'id', filter=Q(transaction_type=TransactionType.DEBIT)
            ),
            debit_sum=Sum(
                'amount', filter=Q(transaction_type=TransactionType.DEBIT)
            ),
            credit_sum=Sum(
                'amount', filter=Q(transaction_type=TransactionType.CREDIT)
            ),
        )

        self.total_orders    = agg['debit_count']   or 0
        self.total_amount    = agg['debit_sum']      or 0
        self.total_reversals = agg['credit_sum']     or 0
        self.net_deduction   = self.total_amount - self.total_reversals

    def __str__(self):
        return (
            f"{self.employee_id} / {self.billing_month} "
            f"[{self.status}] net=₹{self.net_deduction}"
        )
