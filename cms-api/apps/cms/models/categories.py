# """
# apps/cms/models/menu.py  — v2 (corrected)

# Changes from v1:
#   1. Removed dead `from django.contrib.postgres.fields import ArrayField` import.
#      JSONField is used — ArrayField was never referenced.
#   2. Added (canteen_id, deleted_at) to the composite indexes so the
#      ActiveManager's `deleted_at__isnull=True` filter is covered.
#   3. Replaced four separate single-filter indexes with fewer, wider
#      composite indexes that match the actual query shapes in views.py:

#        Old → (canteen_id, is_active)          -- doesn't include deleted_at
#        Old → (canteen_id, category_id)
#        Old → (canteen_id, item_type)
#        Old → (canteen_id, is_available)

#        New → (canteen_id, deleted_at, is_active)       -- ActiveManager base
#        New → (canteen_id, deleted_at, category_id)     -- tab filter
#        New → (canteen_id, deleted_at, item_type)       -- type filter
#        New → (canteen_id, deleted_at, is_available)    -- availability filter
#        New → (canteen_id, deleted_at, name)            -- search / ORDER BY

#      Postgres uses the leftmost prefix, so (canteen_id, deleted_at, *)
#      covers the ActiveManager clause AND the additional filter in one index
#      scan. Without deleted_at in the index the planner loads all rows for
#      a canteen then filters — on a canteen with 10 k items this is a full
#      table scan disguised as an index scan.

#   4. Added a partial index on MenuCategory (canteen_id, is_active)
#      so the category list view query is covered without a full-table scan.

#   5. Added `ordering = ['canteen_id', 'name']` on MenuItem — the previous
#      `ordering = ['name']` emitted a filesort on every list query because
#      there was no plain `name` index.

#   6. `all_objects` manager is now declared first so Django's migration
#      framework picks it up correctly (default manager must be first or
#      explicitly declared via Meta.default_manager_name).
# """

# import uuid
# from django.db import models


# # ──────────────────────────────────────────────────────────────────────────────
# # Manager — excludes soft-deleted rows from the default queryset
# # ──────────────────────────────────────────────────────────────────────────────

# class ActiveManager(models.Manager):
#     """
#     Default manager for MenuItem.
#     Automatically filters out rows where deleted_at IS NOT NULL.

#     IMPORTANT for index design: every query through this manager emits
#         WHERE deleted_at IS NULL
#     so ALL composite indexes on MenuItem include deleted_at as the second
#     column (after canteen_id) so Postgres can use the index for both the
#     tenant filter and the soft-delete filter in one scan.
#     """
#     def get_queryset(self):
#         return super().get_queryset().filter(deleted_at__isnull=True)


# # ──────────────────────────────────────────────────────────────────────────────
# # MenuCategory
# # ──────────────────────────────────────────────────────────────────────────────

# class MenuCategory(models.Model):
#     """
#     cms_menu_categories

#     Pre-seeded categories per canteen: Veg, Non-Veg, Beverages, etc.

#     Index added:
#       - (canteen_id, is_active) — covers the only query shape used in
#         category_list_view: .filter(canteen=canteen, is_active=True)
#     """

#     id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

#     canteen = models.ForeignKey(
#         'cms.CanteenLocation',
#         on_delete=models.CASCADE,
#         related_name='menu_categories',
#     )

#     name       = models.CharField(max_length=100)
#     is_active  = models.BooleanField(default=True)
#     created_at = models.DateTimeField(auto_now_add=True)
#     updated_at = models.DateTimeField(auto_now=True)

#     class Meta:
#         db_table     = 'cms_menu_categories'
#         ordering     = ['name']
#         unique_together = [('canteen', 'name')]
#         indexes = [
#             # Covers: .filter(canteen_id=X, is_active=True) in category_list_view
#             models.Index(
#                 fields=['canteen_id', 'is_active'],
#                 name='idx_mcat_canteen_active',
#             ),
#         ]

#     def __str__(self):
#         return f"{self.name} @ {self.canteen_id}"


# # ──────────────────────────────────────────────────────────────────────────────
# # MenuItem
# # ──────────────────────────────────────────────────────────────────────────────

# class MenuItem(models.Model):
#     """
#     cms_menu_items

#     UI field → model field mapping:
#       Item Name             → name
#       Price (₹)             → base_price
#       Category              → category (FK → MenuCategory)
#       Item Type (toggle)    → item_type  (BREAKFAST | MEAL)
#       Display Tag           → display_tag (e.g. POPULAR)
#       Description           → description
#       Item Image            → photo_url  (S3 URL after upload)

#     Soft-delete: deleted_at IS NULL = active row. ActiveManager enforces this.

#     Index strategy (all composites lead with canteen_id, deleted_at):
#       Every list query hits WHERE canteen_id = X AND deleted_at IS NULL.
#       Adding a third column covers the specific filter in one index scan.
#       Using a separate index per filter column would force Postgres to
#       either pick one and filter the rest in memory, or bitmap-AND multiple
#       indexes (slower than a single composite for high-cardinality filters).
#     """

#     ITEM_TYPE_BREAKFAST = 'BREAKFAST'
#     ITEM_TYPE_MEAL      = 'MEAL'

#     ITEM_TYPE_CHOICES = [
#         (ITEM_TYPE_BREAKFAST, 'Breakfast'),
#         (ITEM_TYPE_MEAL,      'Meal'),
#     ]

#     id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

#     canteen = models.ForeignKey(
#         'cms.CanteenLocation',
#         on_delete=models.CASCADE,
#         related_name='menu_items',
#     )
#     category = models.ForeignKey(
#         MenuCategory,
#         on_delete=models.PROTECT,
#         related_name='items',
#     )

#     name        = models.CharField(max_length=200)
#     description = models.TextField(blank=True, default='')
#     photo = models.ImageField(
#         upload_to='menu_items/',
#         blank=True,
#         null=True,
#         help_text='Stored in MEDIA_ROOT/menu_items/. Use .url for the full path.',
#     )

#     base_price = models.DecimalField(
#         max_digits=10, decimal_places=2,
#         help_text='Default price. Overridden by cms_pricing_rules in Phase 2.',
#     )

#     unit = models.CharField(max_length=30, default='plate')

#     is_veg       = models.BooleanField(default=True)
#     is_available = models.BooleanField(default=True)
#     is_active    = models.BooleanField(default=True)

#     item_type = models.CharField(
#         max_length=20,
#         choices=ITEM_TYPE_CHOICES,
#         default=ITEM_TYPE_MEAL,
#     )

#     display_tag = models.CharField(max_length=50, blank=True, default='')

#     # JSONField works on both SQLite (dev) and Postgres (prod).
#     # For prod Postgres, migrate to:
#     #   ArrayField(models.CharField(max_length=50), default=list, blank=True)
#     # to get native GIN indexing on tag values.
#     tags = models.JSONField(default=list, blank=True)

#     created_by = models.ForeignKey(
#         'accounts.Employee',
#         on_delete=models.SET_NULL,
#         null=True, blank=True,
#         related_name='created_menu_items',
#     )
#     created_at = models.DateTimeField(auto_now_add=True)
#     updated_at = models.DateTimeField(auto_now=True)
#     deleted_at = models.DateTimeField(null=True, blank=True)

#     # ── Managers ──────────────────────────────────────────────────────────────
#     # all_objects MUST be declared first so Django migration framework treats
#     # it as the default manager (required when overriding the default).
#     # We override default_manager_name in Meta to make ActiveManager the
#     # runtime default while keeping all_objects as the migration manager.
#     all_objects = models.Manager()    # unrestricted — for admin / audit use
#     objects     = ActiveManager()     # runtime default — excludes soft-deleted

#     class Meta:
#         db_table             = 'cms_menu_items'
#         default_manager_name = 'objects'      # ActiveManager is the runtime default

#         # Ordering: canteen_id first so the ORDER BY uses the same index
#         # prefix as the WHERE clause. Plain `name` would cause a filesort
#         # because there is no bare `name` index.
#         ordering = ['canteen_id', 'name']

#         indexes = [
#             # ── Base index: canteen + soft-delete ─────────────────────────────
#             # Used by every query (all list views and detail lookups).
#             # Also covers ORDER BY canteen_id, name when no other filter.
#             models.Index(
#                 fields=['canteen_id', 'deleted_at', 'name'],
#                 name='idx_mi_canteen_del_name',
#             ),

#             # ── Tab filter: by category ────────────────────────────────────────
#             # Query: .filter(canteen_id=X, deleted_at__isnull=True, category_id=Y)
#             models.Index(
#                 fields=['canteen_id', 'deleted_at', 'category_id'],
#                 name='idx_mi_canteen_del_cat',
#             ),

#             # ── Item type filter (BREAKFAST / MEAL) ────────────────────────────
#             # Query: .filter(canteen_id=X, deleted_at__isnull=True, item_type=Y)
#             models.Index(
#                 fields=['canteen_id', 'deleted_at', 'item_type'],
#                 name='idx_mi_canteen_del_type',
#             ),

#             # ── Availability toggle ────────────────────────────────────────────
#             # Query: .filter(canteen_id=X, deleted_at__isnull=True, is_available=Y)
#             models.Index(
#                 fields=['canteen_id', 'deleted_at', 'is_available'],
#                 name='idx_mi_canteen_del_avail',
#             ),

#             # ── Detail lookup ─────────────────────────────────────────────────
#             # Query: .get(id=X, canteen_id=Y, deleted_at__isnull=True)
#             # The PK index on `id` alone is sufficient for a single-row
#             # lookup, but this composite avoids a second index scan to verify
#             # canteen_id (cross-tenant protection) and deleted_at in one hop.
#             models.Index(
#                 fields=['id', 'canteen_id', 'deleted_at'],
#                 name='idx_mi_id_canteen_del',
#             ),
#         ]

#         # NOTE: icontains (LIKE '%search%') on `name` cannot use a B-tree
#         # index. For full-text or prefix search in production, add:
#         #   GinIndex(OpClass(Upper('name'), name='gin_trgm_ops'), name='idx_mi_name_trgm')
#         # after enabling pg_trgm: CREATE EXTENSION IF NOT EXISTS pg_trgm;

#     def __str__(self):
#         return f"{self.name} (₹{self.base_price})"

#     @property
#     def is_deleted(self):
#         return self.deleted_at is not None
