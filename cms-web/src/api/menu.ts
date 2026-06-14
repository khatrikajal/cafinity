/**
 * src/lib/api/menu.ts
 *
 * All Menu & Items API calls.
 * Consumed exclusively by hooks in src/hooks/useMenu.ts.
 * No component imports this directly.
 *
 * URL shape (from backend urls.py):
 *   GET    /cms/canteens/{canteen_id}/menu/categories/
 *   POST   /cms/canteens/{canteen_id}/menu/categories/
 *   PATCH  /cms/canteens/{canteen_id}/menu/categories/{id}/
 *   DELETE /cms/canteens/{canteen_id}/menu/categories/{id}/
 *
 *   GET    /cms/canteens/{canteen_id}/menu/items/
 *   POST   /cms/canteens/{canteen_id}/menu/items/
 *   GET    /cms/canteens/{canteen_id}/menu/items/{id}/
 *   PATCH  /cms/canteens/{canteen_id}/menu/items/{id}/
 *   DELETE /cms/canteens/{canteen_id}/menu/items/{id}/
 *   PATCH  /cms/canteens/{canteen_id}/menu/items/{id}/availability/
 */

import api from "@/api/client";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiCategory {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ApiCanteen {
  id: string;
  name: string;
  company_id: string;
}

export interface ApiMenuItem {
  id: string;
  canteen_id: string;
  category: ApiCategory;
  category_name: string;
  name: string;
  initials: string;
  description: string;
  photo_url: string | null;
  base_price: string; // Decimal comes as string from DRF
  is_veg: boolean;
  is_available: boolean;
  is_active: boolean;
  item_type: "BREAKFAST" | "MEAL";
  display_tag: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface MenuItemListResponse {
  count: number;
  results: ApiMenuItem[];
}

export interface BulkImportResponse {
  created_count: number;
  created_category_count: number;
  skipped_count: number;
  error_count: number;
  created_items: ApiMenuItem[];
  created_categories: ApiCategory[];
  skipped: Array<{ row: number; name: string; reason: string }>;
  errors: Array<{ row: number; name?: string; error: unknown }>;
}

export interface CategoryListResponse {
  results: ApiCategory[];
}

export interface CanteenListResponse {
  results: ApiCanteen[];
}

// ── Write payloads ────────────────────────────────────────────────────────────

export interface CreateMenuItemPayload {
  name: string;
  description?: string;
  base_price: number;
  category_id: string;
  item_type: "BREAKFAST" | "MEAL";
  is_available?: boolean;
  display_tag?: string;
  photo?: File;
  photo_url?: string;
  tags?: string[];
}

export type UpdateMenuItemPayload = Partial<CreateMenuItemPayload> & {
  is_available?: boolean;
  is_active?: boolean;
};

export interface CreateCategoryPayload {
  name: string;
}

// ── Query params for list ─────────────────────────────────────────────────────

export interface MenuItemListParams {
  category_id?: string;
  item_type?: "BREAKFAST" | "MEAL";
  is_available?: boolean;
  search?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category API
// ─────────────────────────────────────────────────────────────────────────────

export const canteenApi = {
  list: () => api.get<CanteenListResponse>("/cms/canteens/").then((r) => r.data),
};

const categoryUrl = (canteenId: string, suffix = "") =>
  `/cms/canteens/${canteenId}/menu/categories/${suffix}`;

export const categoryApi = {
  /** GET — list all active categories for a canteen */
  list: (canteenId: string) =>
    api.get<CategoryListResponse>(categoryUrl(canteenId)).then((r) => r.data),

  /** POST — create a new category */
  create: (canteenId: string, payload: CreateCategoryPayload) =>
    api.post<ApiCategory>(categoryUrl(canteenId), payload).then((r) => r.data),

  /** PATCH — rename / toggle active */
  update: (canteenId: string, categoryId: string, payload: Partial<CreateCategoryPayload>) =>
    api.patch<ApiCategory>(categoryUrl(canteenId, `${categoryId}/`), payload).then((r) => r.data),

  /** DELETE — soft delete a category */
  remove: (canteenId: string, categoryId: string) =>
    api.delete(categoryUrl(canteenId, `${categoryId}/`)).then((r) => r.data),
};

// ─────────────────────────────────────────────────────────────────────────────
// Menu Item API
// ─────────────────────────────────────────────────────────────────────────────

const itemUrl = (canteenId: string, suffix = "") =>
  `/cms/canteens/${canteenId}/menu/items/${suffix}`;

const toMenuItemFormData = (payload: UpdateMenuItemPayload) => {
  const formData = new FormData();

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    if (key === "tags" && Array.isArray(value)) {
      formData.append(key, JSON.stringify(value));
      return;
    }

    if (key === "photo" && value instanceof File) {
      formData.append("photo", value);
      return;
    }

    formData.append(key, String(value));
  });

  return formData;
};

const multipartConfig = {
  headers: { "Content-Type": "multipart/form-data" },
};

export const menuItemApi = {
  /** GET — list items with optional filters */
  list: (canteenId: string, params?: MenuItemListParams) =>
    api
      .get<MenuItemListResponse>(itemUrl(canteenId), {
        params: params as Record<string, unknown> | undefined,
      })
      .then((r) => r.data),

  /** GET — single item detail */
  detail: (canteenId: string, itemId: string) =>
    api.get<ApiMenuItem>(itemUrl(canteenId, `${itemId}/`)).then((r) => r.data),

  /** POST — create item */
  create: (canteenId: string, payload: CreateMenuItemPayload) =>
    api
      .post<ApiMenuItem>(itemUrl(canteenId), toMenuItemFormData(payload), multipartConfig)
      .then((r) => r.data),

  /** PATCH — partial update */
  update: (canteenId: string, itemId: string, payload: UpdateMenuItemPayload) =>
    api
      .patch<ApiMenuItem>(
        itemUrl(canteenId, `${itemId}/`),
        toMenuItemFormData(payload),
        multipartConfig,
      )
      .then((r) => r.data),

  /** DELETE — soft delete */
  remove: (canteenId: string, itemId: string) =>
    api.delete(itemUrl(canteenId, `${itemId}/`)).then((r) => r.data),

  /** POST — bulk import items from CSV */
  bulkImport: (canteenId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api
      .post<BulkImportResponse>(itemUrl(canteenId, "bulk-import/"), formData, multipartConfig)
      .then((r) => r.data);
  },

  /** PATCH availability only — lightweight daily toggle */
  toggleAvailability: (canteenId: string, itemId: string, is_available: boolean) =>
    api
      .patch<{ id: string; is_available: boolean }>(
        itemUrl(canteenId, `${itemId}/availability/`),
        { is_available },
      )
      .then((r) => r.data),
};
