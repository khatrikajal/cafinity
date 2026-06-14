"""
apps/cms/models/order.py

Order models for Cafinity CMS.

Tables:
  - Order            → cms_orders
  - OrderItem        → cms_order_items
  - OrderStatusLog   → cms_order_status_log

Schema audit notes (corrections applied):
  1. Status enum completed:
       PLACED → PREPARING → READY → DELIVERED  (terminal)
                          ↘ CANCELLED           (terminal from PLACED only)
     The schema table row for 'PLACED' was truncated in the spec.
     'accepted_at' / 'accepted_by' columns kept — they record when
     kitchen acknowledges the order (PLACED → PREPARING transition).

  2. cms_order_items unnamed column: the column between unit_price and
     quantity that has no name in the spec is clearly base_price_snapshot
     (original base_price from cms_menu_items at order time, before any
     pricing rule was applied). Named accordingly.

  3. cms_time_slots FK: referenced by slot_id but table not in the spec.
     Stubbed as a raw UUIDField with app-layer FK enforcement (same pattern
     as KitchenCounterUser.canteen_id). Replace with ForeignKey once
     TimeSlot model is defined.

N+1 / Index / Prefetch strategy (documented per model below):
  - Every query that touches Order also needs OrderItem + MenuItem snapshot.
    Use prefetch_related('items') — do NOT use select_related (M2M not OneToOne).
  - OrderStatusLog is append-only — no update path, no prefetch needed.
  - All composite indexes lead with the highest-cardinality filter column
    first (employee_id or canteen_id) then the next filter (status, date).
  - order_code has a UNIQUE index via unique=True — no extra index needed.
  - billing_month on BillingLedger is VARCHAR(7) 'YYYY-MM' — indexed for
    month-end aggregation queries.
"""

import uuid

from django.db import models
from django.utils import timezone


# ──────────────────────────────────────────────────────────────────────────────
# Status constants — single source of truth used by model + serializer + views
# ──────────────────────────────────────────────────────────────────────────────

class OrderStatus:
    # Cafinity — Simplified Order Status: Print = Delivered
    PENDING   = 'PENDING'
    PLACED    = 'PLACED'      # legacy alias for PENDING
    PREPARING = 'PREPARING'   # legacy — no longer used for new transitions
    READY     = 'READY'       # legacy — no longer used for new transitions
    DELIVERED = 'DELIVERED'
    CANCELLED = 'CANCELLED'
    EXPIRED   = 'EXPIRED'

    CHOICES = [
        (PENDING,   'Pending'),
        (PLACED,    'Placed'),
        (PREPARING, 'Preparing'),
        (READY,     'Ready for Collection'),
        (DELIVERED, 'Delivered'),
        (CANCELLED, 'Cancelled'),
        (EXPIRED,   'Expired'),
    ]

    # Terminal states — no further transitions allowed
    TERMINAL = {DELIVERED, CANCELLED, EXPIRED}

    # Valid forward transitions — simplified: PENDING → DELIVERED | CANCELLED
    TRANSITIONS = {
        PENDING:   {DELIVERED, CANCELLED},
        PLACED:    {DELIVERED, CANCELLED, PREPARING},
        PREPARING: {DELIVERED, READY},
        READY:     {DELIVERED, EXPIRED},
        DELIVERED: set(),
        CANCELLED: set(),
        EXPIRED:   set(),
    }

    @classmethod
    def pending_statuses(cls):
        """All statuses treated as pending/not-yet-delivered."""
        return {cls.PENDING, cls.PLACED, cls.PREPARING, cls.READY}

    @classmethod
    def is_pending(cls, status: str) -> bool:
        return status in cls.pending_statuses()

    @classmethod
    def can_transition(cls, from_status: str, to_status: str) -> bool:
        return to_status in cls.TRANSITIONS.get(from_status, set())


class ChangedByRole:
    EMPLOYEE = 'EMPLOYEE'
    ADMIN    = 'ADMIN'
    KITCHEN  = 'KITCHEN'
    COUNTER  = 'COUNTER'
    SYSTEM   = 'SYSTEM'

    CHOICES = [
        (EMPLOYEE, 'Employee'),
        (ADMIN,    'Admin'),
        (KITCHEN,  'Kitchen'),
        (COUNTER,  'Counter'),
        (SYSTEM,   'System'),
    ]


# ──────────────────────────────────────────────────────────────────────────────
# Order
# ──────────────────────────────────────────────────────────────────────────────

class Order(models.Model):
    """
    cms_orders

    Master order record. Created when employee confirms checkout.
    Status drives the entire kitchen → counter workflow.

    Workflow:
      Employee places order   → PLACED
      Kitchen acknowledges    → PREPARING  (accepted_at, accepted_by set)
      Kitchen marks done      → READY      (prepared_at set)
      Counter collects        → DELIVERED  (collected_at, receipt_printed_at set)
      Employee/admin cancels  → CANCELLED  (cancelled_at, reason, cancelled_by set)

    N+1 notes:
      - Never access order.items in a loop without prefetch_related('items').
      - Never access order.items.menu_item in a loop without
        prefetch_related('items__menu_item') — but since item_name_snapshot
        and unit_price are denormalised onto OrderItem, you rarely need
        to join back to MenuItem after order creation.
      - accepted_by, cancelled_by, employee are separate FK columns —
        use select_related('employee', 'accepted_by_employee', 'cancelled_by_employee')
        only when the response needs those full objects.

    Index strategy:
      (employee_id, status)         → employee order history filtered by status
      (canteen_id, order_date, status) → kitchen board: today's orders by status
      (canteen_id, status, placed_at)  → admin dashboard: live queue
      (order_code)                  → unique — covered by unique=True constraint
      (is_billed, billing_month_*)  → payroll export: unbilled delivered orders
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    order_code = models.CharField(
        max_length=20,
        unique=True,              # implicit B-tree index — no extra index needed
        help_text="5-digit numeric order code generated on creation by order service.",
    )

    # ── Core FKs ─────────────────────────────────────────────────────────────
    employee = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.PROTECT,
        related_name='orders',
        db_column='employee_id',
    )
    canteen = models.ForeignKey(
        'cms.CanteenLocation',
        on_delete=models.PROTECT,
        related_name='orders',
        db_column='canteen_id',
    )

    slot = models.ForeignKey(
        'cms.MealSlot',
        on_delete=models.PROTECT,
        related_name='slot_orders',
        db_column='slot_id',
        db_constraint=False,
        help_text="The meal slot this order belongs to.",
    )

    order_date = models.DateField(default=timezone.now)
    status     = models.CharField(
        max_length=20,
        choices=OrderStatus.CHOICES,
        default=OrderStatus.PENDING,
        db_index=True,
    )

    # ── Financials ────────────────────────────────────────────────────────────
    subtotal     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    version      = models.PositiveIntegerField(default=1)

    # ── Lifecycle timestamps + actors ─────────────────────────────────────────
    placed_at = models.DateTimeField(default=timezone.now)

    # PLACED → PREPARING
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='accepted_orders',
        db_column='accepted_by',
        help_text="Admin or Kitchen user who moved order to PREPARING.",
    )

    # PREPARING → READY
    prepared_at = models.DateTimeField(null=True, blank=True)

    # READY → DELIVERED
    collected_at        = models.DateTimeField(null=True, blank=True)
    receipt_printed_at  = models.DateTimeField(null=True, blank=True)

    # → CANCELLED
    cancelled_at         = models.DateTimeField(null=True, blank=True)
    cancellation_reason  = models.TextField(blank=True, null=True)
    cancelled_by = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='cancelled_orders',
        db_column='cancelled_by',
    )

    # ── Billing ───────────────────────────────────────────────────────────────
    is_billed = models.BooleanField(
        default=False,
        db_index=True,
        help_text="True after this order is included in a payroll billing summary.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'cms_orders'
        ordering = ['-placed_at']
        indexes  = [
            # ── Employee-facing queries ───────────────────────────────────────
            # "My orders" list filtered by status
            models.Index(
                fields=['employee_id', 'status'],
                name='idx_ord_employee_status',
            ),
            # "My orders" list for a date (history page)
            models.Index(
                fields=['employee_id', 'order_date'],
                name='idx_ord_employee_date',
            ),

            # ── Kitchen board ─────────────────────────────────────────────────
            # Kitchen polls: today's orders for this canteen, filtered by status
            # Most selective: canteen_id + order_date narrows to ~50-200 rows max
            models.Index(
                fields=['canteen_id', 'order_date', 'status'],
                name='idx_ord_canteen_date_status',
            ),

            # ── Admin live queue ──────────────────────────────────────────────
            # Admin dashboard: all active orders for canteen sorted by placed_at
            models.Index(
                fields=['canteen_id', 'status', 'placed_at'],
                name='idx_ord_canteen_status_placed',
            ),

            # ── Billing export ────────────────────────────────────────────────
            # Payroll job: find all DELIVERED + not billed orders for a canteen
            models.Index(
                fields=['canteen_id', 'is_billed', 'status'],
                name='idx_ord_canteen_billed_status',
            ),
        ]

    def __str__(self):
        return f"{self.order_code} [{self.status}]"

    @property
    def is_terminal(self) -> bool:
        return self.status in OrderStatus.TERMINAL

    @property
    def delivered_at(self):
        """Alias for collected_at — set when order is marked delivered."""
        return self.collected_at

    @property
    def can_cancel(self) -> bool:
        """Employee can cancel only from pending status."""
        return OrderStatus.is_pending(self.status)


# ──────────────────────────────────────────────────────────────────────────────
# OrderItem
# ──────────────────────────────────────────────────────────────────────────────

class OrderItem(models.Model):
    """
    cms_order_items

    Line items for each order. Immutable after order is ACCEPTED (PREPARING).

    Design: snapshot fields (item_name_snapshot, unit_price, base_price_snapshot)
    are denormalised from MenuItem at order creation time. This means:
      - Menu price changes do NOT retroactively affect past orders.
      - You can display order history accurately without joining MenuItem.
      - MenuItem can be soft-deleted without breaking order records.

    N+1 note:
      - When serializing an Order with its items, always use:
            Order.objects.prefetch_related('items')
        This loads all OrderItems for a batch of orders in ONE extra query.
      - If you also need MenuItem data (e.g. current photo), add:
            .prefetch_related('items__menu_item')
        But prefer snapshot fields for display — avoids the join entirely.

    Index strategy:
      (order_id) — covered by the FK index Django creates automatically.
      (menu_item_id) — covered by FK index — useful for "how many times
        was item X ordered this month" analytics queries.
      No composite needed: order_items are always accessed via order_id.
    """

    id    = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name='items',       # order.items.all() — used in prefetch_related
        db_column='order_id',
    )
    menu_item = models.ForeignKey(
        'cms.CanteenMenuItem',
        on_delete=models.PROTECT,   # PROTECT: don't cascade-delete orders on menu item removal
        related_name='order_items',
        db_column='menu_item_id',
    )

    # ── Snapshot fields — immutable after order placement ─────────────────────
    item_name_snapshot  = models.CharField(max_length=200)   # MenuItem.name at order time
    unit_price          = models.DecimalField(max_digits=10, decimal_places=2)  # after pricing rule
    base_price_snapshot = models.DecimalField(max_digits=10, decimal_places=2)  # original base_price
    # (spec had an unnamed column between unit_price and quantity —
    #  context makes clear this is the original base price for audit purposes)

    quantity   = models.PositiveIntegerField()
    line_total = models.DecimalField(max_digits=10, decimal_places=2)  # unit_price * quantity

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cms_order_items'
        # Django auto-creates index on order_id (FK) and menu_item_id (FK).
        # No additional composite index needed — items are always accessed
        # through order_id, and that FK index is sufficient.
        indexes = [
            # Analytics: "total quantity of item X sold in month Y"
            # Without this, analytics queries do a seq scan on order_items
            # filtered by menu_item_id across potentially millions of rows.
            models.Index(
                fields=['menu_item_id', 'created_at'],
                name='idx_oi_menuitem_created',
            ),
        ]

    def __str__(self):
        return f"{self.item_name_snapshot} x{self.quantity} @ ₹{self.unit_price}"

    def save(self, *args, **kwargs):
        # Always recompute line_total before save to prevent drift.
        # Never set line_total directly from outside — set unit_price + quantity.
        self.line_total = self.unit_price * self.quantity
        super().save(*args, **kwargs)


# ──────────────────────────────────────────────────────────────────────────────
# OrderStatusLog
# ──────────────────────────────────────────────────────────────────────────────

class OrderStatusLog(models.Model):
    """
    cms_order_status_log

    Immutable append-only audit trail.
    One row is written on every status transition — never updated or deleted.

    Who writes each row:
      PLACED    → PREPARING : KITCHEN or ADMIN
      PREPARING → READY     : KITCHEN
      READY     → DELIVERED : COUNTER
      PLACED    → CANCELLED : EMPLOYEE or ADMIN
      (any)     → *         : SYSTEM for automated transitions (e.g. timeout)

    N+1 note:
      - Log is read in two contexts:
          1. Order detail page: order.status_logs.all() — always accessed
             via the FK so no extra prefetch needed beyond:
             Order.objects.prefetch_related('status_logs')
          2. Admin audit page: standalone log list — no order join needed.

    Index strategy:
      (order_id) — FK index covers "all logs for order X" queries.
      (changed_at) — for time-range audit queries across all orders.
      No (order_id, changed_at) composite needed because the FK index
      combined with ordering = ['-changed_at'] is sufficient for
      per-order log display (≤ 10 rows per order always).
    """

    id    = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name='status_logs',
        db_column='order_id',
    )

    from_status = models.CharField(
        max_length=20,
        null=True, blank=True,    # NULL on initial PLACED entry
        choices=OrderStatus.CHOICES,
    )
    to_status = models.CharField(
        max_length=20,
        choices=OrderStatus.CHOICES,
    )

    changed_by = models.ForeignKey(
        'accounts.Employee',
        on_delete=models.SET_NULL,
        null=True, blank=True,    # NULL = system action
        related_name='order_status_changes',
        db_column='changed_by',
    )
    changed_by_role = models.CharField(
        max_length=30,
        choices=ChangedByRole.CHOICES,
    )

    note       = models.TextField(null=True, blank=True)
    changed_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = 'cms_order_status_log'
        ordering = ['-changed_at']
        # FK on order_id gives Django an automatic index — sufficient for
        # per-order log lookups. changed_at index covers time-range audits.

    def __str__(self):
        return f"{self.order.order_code}: {self.from_status} → {self.to_status}"
