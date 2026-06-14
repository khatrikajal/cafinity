/**
 * src/hooks/useMenu.ts
 *
 * All data-fetching and mutation hooks for Menu & Items.
 * Components import ONLY from here — never from api/menu.ts directly.
 *
 * Pattern:
 *   - useCategories()   : list + create + update + delete
 *   - useMenuItems()    : list with filters + create + update + delete + toggle
 *
 * State management: local React state + manual refetch.
 * If you add TanStack Query later, replace the internals here — component
 * imports stay identical.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  canteenApi,
  categoryApi,
  menuItemApi,
  type ApiCategory,
  type ApiMenuItem,
  type BulkImportResponse,
  type CreateCategoryPayload,
  type CreateMenuItemPayload,
  type MenuItemListParams,
  type UpdateMenuItemPayload,
} from "@/api/menu";

// ─────────────────────────────────────────────────────────────────────────────
// Shared canteen ID helper
// Pull canteen_id from wherever your auth state stores it.
// Adjust the import to match your auth store.
// ─────────────────────────────────────────────────────────────────────────────

function readStoredCanteenId(): string {
  if (typeof window === "undefined") return "";

  try {
    const selected = localStorage.getItem("canteen_selected_id");
    if (selected) return selected;

    const raw = localStorage.getItem("canteen_auth_claims");
    if (raw) {
      const claims = JSON.parse(raw);
      return claims?.canteen_id ?? "";
    }
  } catch {
    // ignore parse errors
  }
  return "";
}

function useCanteenId(): string {
  const [canteenId, setCanteenId] = useState(readStoredCanteenId);

  useEffect(() => {
    let ignore = false;
    canteenApi
      .list()
      .then((data) => {
        if (ignore) return;
        const canteens = data.results;
        const selectedExists = canteens.some((canteen) => canteen.id === canteenId);
        const next = selectedExists ? canteenId : canteens[0]?.id ?? "";

        if (!next) {
          localStorage.removeItem("canteen_selected_id");
          setCanteenId("");
          return;
        }

        localStorage.setItem("canteen_selected_id", next);
        setCanteenId(next);
      })
      .catch(() => {
        if (!ignore) toast.error("Failed to load canteens.");
      });

    return () => {
      ignore = true;
    };
  }, [canteenId]);

  return canteenId;
}

// ─────────────────────────────────────────────────────────────────────────────
// useCategories
// ─────────────────────────────────────────────────────────────────────────────

interface UseCategoriesReturn {
  canteenId: string;
  categories: ApiCategory[];
  categoryNames: string[]; // plain string list for the CategorySelect dropdown
  isLoading: boolean;
  error: string | null;
  createCategory: (name: string) => Promise<ApiCategory | null>;
  updateCategory: (id: string, name: string) => Promise<void>;
  removeCategory: (id: string) => Promise<void>;
  refetch: () => void;
}

export function useCategories(): UseCategoriesReturn {
  const canteenId = useCanteenId();
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(() => {
    if (!canteenId) {
      setCategories([]);
      setError("No canteen is available. Create/select a canteen before managing categories.");
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    categoryApi
      .list(canteenId)
      .then((data) => setCategories(data.results))
      .catch((err) => {
        if (err?.code !== "ERR_CANCELED") {
          const msg = extractApiError(err) ?? "Failed to load categories.";
          setError(msg);
          toast.error(msg);
        }
      })
      .finally(() => setIsLoading(false));
  }, [canteenId]);

  useEffect(() => {
    fetch();
    return () => abortRef.current?.abort();
  }, [fetch]);

  const reloadCategories = useCallback(async (): Promise<ApiCategory[]> => {
    if (!canteenId) {
      setError("No canteen is available. Create/select a canteen before managing categories.");
      return [];
    }
    const data = await categoryApi.list(canteenId);
    setCategories(data.results);
    setError(null);
    return data.results;
  }, [canteenId]);

  const createCategory = useCallback(
    async (name: string): Promise<ApiCategory | null> => {
      if (!canteenId) {
        const msg = "No canteen is available. Create/select a canteen before adding categories.";
        setError(msg);
        toast.error(msg);
        return null;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        toast.error("Category name cannot be empty.");
        return null;
      }
      try {
        const created = await categoryApi.create(canteenId, { name: trimmed });
        await reloadCategories();
        setError(null);
        toast.success(`Category "${created.name}" added.`);
        return created;
      } catch (err: unknown) {
        const msg = extractApiError(err) ?? "Failed to create category.";
        toast.error(msg);
        return null;
      }
    },
    [canteenId, reloadCategories],
  );

  const updateCategory = useCallback(
    async (id: string, name: string): Promise<void> => {
      if (!canteenId) {
        const msg = "No canteen is available. Create/select a canteen before updating categories.";
        setError(msg);
        toast.error(msg);
        return;
      }
      const trimmed = name.trim();
      if (!trimmed) return;

      const prev = categories.find((c) => c.id === id);
      // Optimistic update
      setCategories((cur) => cur.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));

      try {
        await categoryApi.update(canteenId, id, { name: trimmed });
        setError(null);
        toast.success("Category updated.");
      } catch (err: unknown) {
        // Roll back
        if (prev) setCategories((cur) => cur.map((c) => (c.id === id ? prev : c)));
        const msg = extractApiError(err) ?? "Failed to update category.";
        setError(msg);
        toast.error(msg);
      }
    },
    [canteenId, categories],
  );

  const removeCategory = useCallback(
    async (id: string): Promise<void> => {
      if (!canteenId) {
        const msg = "No canteen is available. Create/select a canteen before deleting categories.";
        setError(msg);
        toast.error(msg);
        return;
      }
      try {
        await categoryApi.remove(canteenId, id);
        await reloadCategories();
        setError(null);
        toast.success("Category removed.");
      } catch (err: unknown) {
        const msg = extractApiError(err) ?? "Failed to remove category.";
        setError(msg);
        toast.error(msg);
      }
    },
    [canteenId, reloadCategories],
  );

  return {
    canteenId,
    categories,
    categoryNames: categories.map((c) => c.name),
    isLoading,
    error,
    createCategory,
    updateCategory,
    removeCategory,
    refetch: fetch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useMenuItems
// ─────────────────────────────────────────────────────────────────────────────

interface UseMenuItemsReturn {
  items: ApiMenuItem[];
  count: number;
  isLoading: boolean;
  error: string | null;
  createItem: (payload: CreateMenuItemPayload) => Promise<ApiMenuItem | null>;
  updateItem: (id: string, payload: UpdateMenuItemPayload) => Promise<ApiMenuItem | null>;
  removeItem: (id: string) => Promise<void>;
  bulkImport: (file: File) => Promise<BulkImportResponse | null>;
  toggleAvailability: (id: string, is_available: boolean) => Promise<void>;
  refetch: () => void;
}

export function useMenuItems(params?: MenuItemListParams): UseMenuItemsReturn {
  const canteenId = useCanteenId();
  const [items, setItems] = useState<ApiMenuItem[]>([]);
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable serialised key so the effect re-runs only when params actually change
  const paramsKey = JSON.stringify(params ?? {});

  const fetch = useCallback(() => {
    if (!canteenId) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    menuItemApi
      .list(canteenId, params)
      .then((data) => {
        setItems(data.results);
        setCount(data.count);
      })
      .catch((err) => {
        if (err?.code !== "ERR_CANCELED") {
          setError("Failed to load menu items.");
        }
      })
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canteenId, paramsKey]);

  useEffect(() => {
    fetch();
    return () => abortRef.current?.abort();
  }, [fetch]);

  // ── Create ──────────────────────────────────────────────────────────────────
  const createItem = useCallback(
    async (payload: CreateMenuItemPayload): Promise<ApiMenuItem | null> => {
      if (!canteenId) return null;
      try {
        const created = await menuItemApi.create(canteenId, payload);
        const data = await menuItemApi.list(canteenId, params);
        setItems(data.results);
        setCount(data.count);
        toast.success(`"${created.name}" added to menu.`);
        return created;
      } catch (err: unknown) {
        const msg = extractApiError(err) ?? "Failed to create menu item.";
        toast.error(msg);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canteenId, paramsKey],
  );

  // ── Update ──────────────────────────────────────────────────────────────────
  const updateItem = useCallback(
    async (id: string, payload: UpdateMenuItemPayload): Promise<ApiMenuItem | null> => {
      if (!canteenId) return null;

      const previous = items.find((i) => i.id === id);
      // Optimistic patch — merge locally for instant UI response
      if (previous) {
        const optimistic = mergeItem(previous, payload);
        setItems((cur) => cur.map((i) => (i.id === id ? optimistic : i)));
      }

      try {
        const updated = await menuItemApi.update(canteenId, id, payload);
        const data = await menuItemApi.list(canteenId, params);
        setItems(data.results);
        setCount(data.count);
        toast.success("Item updated.");
        return updated;
      } catch (err: unknown) {
        // Roll back
        if (previous) setItems((cur) => cur.map((i) => (i.id === id ? previous : i)));
        const msg = extractApiError(err) ?? "Failed to update item.";
        toast.error(msg);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canteenId, items],
  );

  // ── Remove ──────────────────────────────────────────────────────────────────
  const removeItem = useCallback(
    async (id: string): Promise<void> => {
      if (!canteenId) return;
      const snapshot = items;
      setItems((cur) => cur.filter((i) => i.id !== id));
      setCount((n) => Math.max(0, n - 1));

      try {
        await menuItemApi.remove(canteenId, id);
        const data = await menuItemApi.list(canteenId, params);
        setItems(data.results);
        setCount(data.count);
        toast.success("Item deleted.");
      } catch {
        setItems(snapshot);
        setCount(snapshot.length);
        toast.error("Failed to delete item.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canteenId, items],
  );

  const bulkImport = useCallback(
    async (file: File): Promise<BulkImportResponse | null> => {
      if (!canteenId) return null;
      try {
        const result = await menuItemApi.bulkImport(canteenId, file);
        await menuItemApi.list(canteenId, params).then((data) => {
          setItems(data.results);
          setCount(data.count);
        });
        toast.success(
          `Imported ${result.created_count} item${result.created_count === 1 ? "" : "s"}.`,
        );
        if (result.skipped_count || result.error_count) {
          toast.warning(
            `${result.skipped_count} skipped, ${result.error_count} error${result.error_count === 1 ? "" : "s"}.`,
          );
        }
        return result;
      } catch (err: unknown) {
        const msg = extractApiError(err) ?? "Failed to import menu items.";
        toast.error(msg);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canteenId, paramsKey],
  );

  // ── Toggle availability ─────────────────────────────────────────────────────
  const toggleAvailability = useCallback(
    async (id: string, is_available: boolean): Promise<void> => {
      if (!canteenId) return;

      const previous = items.find((i) => i.id === id);
      // Optimistic toggle
      setItems((cur) =>
        cur.map((i) => (i.id === id ? { ...i, is_available } : i)),
      );

      try {
        await menuItemApi.toggleAvailability(canteenId, id, is_available);
      } catch {
        // Roll back
        if (previous) setItems((cur) => cur.map((i) => (i.id === id ? previous : i)));
        toast.error("Failed to update availability.");
      }
    },
    [canteenId, items],
  );

  return {
    items,
    count,
    isLoading,
    error,
    createItem,
    updateItem,
    removeItem,
    bulkImport,
    toggleAvailability,
    refetch: fetch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shallow-merges an UpdateMenuItemPayload into an ApiMenuItem for optimistic UI.
 * Only touches top-level scalar fields — nested category object is preserved.
 */
function mergeItem(item: ApiMenuItem, patch: UpdateMenuItemPayload): ApiMenuItem {
  return {
    ...item,
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.base_price !== undefined && { base_price: String(patch.base_price) }),
    ...(patch.item_type !== undefined && { item_type: patch.item_type }),
    ...(patch.display_tag !== undefined && { display_tag: patch.display_tag }),
    ...(patch.photo_url !== undefined && { photo_url: patch.photo_url }),
    ...(patch.is_available !== undefined && { is_available: patch.is_available }),
    ...(patch.tags !== undefined && { tags: patch.tags }),
  };
}

/**
 * Extracts a human-readable error message from an Axios error.
 * Handles DRF's field-level errors ({ field: [msg, ...] }) and detail strings.
 */
function extractApiError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const response = (err as { response?: { status?: number; data?: unknown } }).response;
  const data = response?.data;
  const fallbackMessage = err instanceof Error ? err.message : null;

  if (typeof data === "string") return data;

  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;

    // First field-level error
    for (const val of Object.values(d)) {
      if (Array.isArray(val) && typeof val[0] === "string") return val[0];
    }
  }

  if (response?.status === 401) return "Please log in again before managing categories.";
  if (response?.status === 403) return "Your account does not have permission to manage categories.";
  if (response?.status === 404) return "The selected canteen or category was not found.";
  if (response?.status && response.status >= 500) return "Server error while managing categories.";

  return fallbackMessage;
}
