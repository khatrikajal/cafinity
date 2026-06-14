/**
 * src/api/slotapi.ts
 *
 * Slot API integration layer.
 *
 * Bridges the gap between:
 *   - Frontend  : Slot / MenuItem shapes used in admin-slots.tsx (camelCase, legacy fields)
 *   - Backend   : MealSlot / SlotMenuItem shapes from the Django REST API (snake_case, UUID ids)
 *
 * All mapping between the two shapes lives here so the rest of the app stays untouched.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Mapping summary
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Backend field           │ Frontend field
 * ─────────────────────────┼────────────────────────────────────────────────
 *  id (UUID string)        │ id
 *  name                    │ name
 *  date                    │ date
 *  start_time              │ startTime
 *  end_time                │ endTime
 *  capacity                │ capacity
 *  meal_type               │ type
 *  is_active               │ active
 *  occupancy_count         │ currentOccupancy
 *  occupancy_percentage    │ (computed locally in admin-slots.tsx — not stored)
 *  slot_items[].menu_item_id  │ menuItemIds[]
 *  slot_items[].is_enabled=F  │ disabledItemIds[]
 *  —                       │ displayTime  (formatted "HH:MM — HH:MM", built here)
 *  —                       │ status       (derived from active/date/time in admin-slots.tsx)
 *  —                       │ defaultCategory  (first selected category, frontend-only)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Removed fields (backend no longer has them)
 * ─────────────────────────────────────────────────────────────────────────────
 *  —
 */

import { getTokenFromStorage } from '@/lib/authContext';
import { bootstrapAuthSession } from '@/api/client';
import type { Slot } from '@/lib/store';
import { API_BASE_URL } from './baseUrl';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = `${API_BASE_URL}/slots`;

// ─────────────────────────────────────────────────────────────────────────────
// Backend response shapes (what the API actually returns)
// ─────────────────────────────────────────────────────────────────────────────

export interface BackendSlotItem {
  menu_item_id: string;   // UUID
  is_enabled: boolean;
  min_order_quantity: number;
  max_order_quantity: number;
  max_qty_per_order: number;
  available_quantity: number | null;
}

export interface BackendSlot {
  id: string;             // UUID
  canteen?: string;
  canteen_id?: string;
  name: string;
  date: string;           // "YYYY-MM-DD"
  start_time: string;     // "HH:MM:SS"
  end_time: string;       // "HH:MM:SS"
  buffer_minutes?: number;
  bufferMinutes?: number;
  capacity: number;
  meal_type: string;      // "BREAKFAST" | "MEAL"
  is_active: boolean;
  categories: string[];
  occupancy_count: number;
  occupancy_percentage: number;
  created_at: string;
  updated_at: string;
  // Only present on detail endpoint (GET /slots/{id}/)
  items?: BackendSlotItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Write payload (what we POST / PUT to the backend)
// ─────────────────────────────────────────────────────────────────────────────

export interface SlotMenuItemWritePayload {
  menu_item_id: string;
  available_quantity?: number | null;
  min_order_quantity?: number;
  max_order_quantity?: number;
  max_qty_per_order?: number;
}

export interface SlotWritePayload {
  name: string;
  date: string;           // "YYYY-MM-DD"
  start_time: string;     // "HH:MM"
  end_time: string;       // "HH:MM"
  buffer_minutes?: number;
  capacity: number;
  meal_type: string;      // "BREAKFAST" | "MEAL"
  is_active: boolean;
  categories?: string[];
  menu_item_ids?: string[]; // legacy — omit when menu_items is sent
  menu_items?: SlotMenuItemWritePayload[];
  canteen_id?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers — backend ↔ frontend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise "HH:MM:SS" (Django TimeField) to "HH:MM" for display and inputs.
 */
function trimTime(t: string): string {
  return t?.slice(0, 5) ?? '';
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRecurringSlotDate(dateValue: string, isActive: boolean): string {
  if (!isActive) return dateValue;

  const [year, month, day] = String(dateValue ?? "").split("-").map(Number);
  if (!year || !month || !day) {
    return formatLocalDate(new Date());
  }

  const slotDate = new Date(year, month - 1, day);
  slotDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Active slots behave like daily recurring windows on the frontend:
  // once yesterday passes, reuse the same slot for today instead of leaving it stale/closed forever.
  if (slotDate < today) {
    return formatLocalDate(today);
  }

  return dateValue;
}

/**
 * Convert a backend MealSlot response into the frontend Slot shape.
 * Merges slot_items into menuItemIds and disabledItemIds so admin-slots.tsx
 * can drive its UI without knowing about the backend's SlotMenuItem model.
 */
function toFrontendSlot(b: BackendSlot): Slot {
  const start = trimTime(b.start_time);
  const end   = trimTime(b.end_time);
  const normalizedDate = normalizeRecurringSlotDate(b.date, b.is_active);

  const allItemIds     = (b.items ?? []).map((i) => i.menu_item_id);
  const disabledItemIds = (b.items ?? [])
    .filter((i) => !i.is_enabled)
    .map((i) => i.menu_item_id);

  const slotMenuItems = (b.items ?? []).map((i) => ({
    menuItemId: i.menu_item_id,
    availableQuantity: i.available_quantity ?? null,
    minOrderQuantity: i.min_order_quantity ?? 1,
    maxQtyPerOrder: i.max_qty_per_order ?? 4,
    maxOrderQuantity: i.max_order_quantity ?? i.max_qty_per_order ?? 10,
    isEnabled: i.is_enabled,
  }));

  // Map backend meal_type ("BREAKFAST" | "MEAL") to the frontend ItemType
  // used in admin-slots.tsx ("Breakfast" | "Meal").
  const typeMap: Record<string, string> = {
    BREAKFAST: 'Breakfast',
    MEAL:      'Meal',
  };

  return {
    id:               b.id,
    name:             b.name,
    date:             normalizedDate,
    startTime:        start,
    endTime:          end,
    bufferMinutes:    b.buffer_minutes ?? b.bufferMinutes ?? 0,
    displayTime:      `${start} — ${end}`,
    capacity:         b.capacity,
    type:             (typeMap[b.meal_type] ?? b.meal_type) as Slot['type'],
    active:           b.is_active,
    categories:       b.categories ?? [],
    status:           b.is_active ? 'upcoming' : 'expired',
    currentOccupancy: b.occupancy_count ?? 0,
    menuItemIds:      allItemIds,
    disabledItemIds,
    canteenId:         b.canteen_id ?? b.canteen,
    slotMenuItems,
    // defaultCategory is frontend-only — not returned by the backend.
    // admin-slots.tsx sets it when the user edits a slot.
    defaultCategory:  undefined,
  };
}

/**
 * Convert the frontend Slot partial (from SlotModal's handleSave) into the
 * write payload the backend expects.
 */
function toBackendPayload(data: Partial<Slot>, fallback?: Slot, canteenId?: string): SlotWritePayload {
  const mealTypeMap: Record<string, string> = {
    Breakfast: 'BREAKFAST',
    Meal:      'MEAL',
  };

  const type     = data.type     ?? fallback?.type     ?? 'Meal';
  const isActive = data.active   ?? fallback?.active   ?? true;

  const base = {
    name:          data.name       ?? fallback?.name       ?? '',
    date:          data.date       ?? fallback?.date       ?? new Date().toISOString().slice(0, 10),
    start_time:    data.startTime  ?? fallback?.startTime  ?? '09:00',
    end_time:      data.endTime    ?? fallback?.endTime    ?? '11:00',
    buffer_minutes: data.bufferMinutes ?? fallback?.bufferMinutes ?? 0,
    capacity:      data.capacity   ?? fallback?.capacity   ?? 100,
    meal_type:     mealTypeMap[type] ?? type.toUpperCase(),
    is_active:     isActive,
    categories:    data.categories ?? fallback?.categories ?? [],
    canteen_id:    canteenId ?? data.canteenId ?? fallback?.canteenId,
  };

  const write = data.menuItemsWrite;
  if (write && write.length >= 0) {
    return {
      ...base,
      menu_items: write.map((row) => ({
        menu_item_id: row.menu_item_id,
        available_quantity: row.available_quantity ?? null,
        min_order_quantity: row.min_order_quantity ?? 1,
        max_order_quantity: row.max_order_quantity ?? row.max_qty_per_order ?? 10,
        max_qty_per_order: row.max_qty_per_order ?? 4,
      })),
    };
  }

  return {
    ...base,
    categories: data.categories ?? fallback?.categories ?? [],
    menu_item_ids: data.menuItemIds ?? fallback?.menuItemIds ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getTokenFromStorage();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    let msg = 'Request failed';
    if (typeof data === 'object' && data !== null) {
      const record = data as Record<string, unknown>;
      if (typeof record.detail === 'string') msg = record.detail;
      else if (typeof record.error === 'string') msg = record.error;
      else if (Array.isArray(record.non_field_errors) && record.non_field_errors.length > 0) {
        msg = String(record.non_field_errors[0]);
      }
    } else if (typeof data === 'string' && data.trim()) {
      msg = data.trim();
    } else if (res.statusText && res.statusText !== 'Error') {
      msg = res.statusText;
    } else if (res.status === 401) {
      msg = 'Session expired. Please log in again.';
    } else if (res.status >= 500) {
      msg = 'Server error. Check that the API is running and migrations are applied.';
    }
    const err = new Error(msg) as Error & { status: number; data: unknown };
    err.status = res.status;
    err.data   = data;
    throw err;
  }
  return data as T;
}

async function http<T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string | undefined>,
): Promise<{ data: T }> {
  await bootstrapAuthSession();

  const url = new URL(`${BASE_URL}${path}`, window.location.origin);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: buildHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Unable to reach the API. Ensure the backend server is running.');
  }
  // 204 No Content (DELETE) — return null
  if (res.status === 204) return { data: null as unknown as T };
  const data = await parseResponse<T>(res);
  return { data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — returns mapped frontend types so admin-slots.tsx needs no changes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /slots/
 * Returns all slots as frontend Slot[].
 * Note: list endpoint does NOT include items[] — menuItemIds will be empty
 * until fetchSlotById() or fetchSlotItems() is called for that slot.
 */
export async function fetchSlots(canteenId?: string): Promise<{ data: Slot[] }> {
  const { data } = await http<BackendSlot[]>('GET', '/', undefined, { canteen_id: canteenId });
  return { data: (data ?? []).map(toFrontendSlot) };
}

/**
 * GET /slots/{id}/
 * Returns a single slot with its items[] populated.
 * Use this when opening the Edit modal to get menuItemIds.
 */
export async function fetchSlotById(id: string): Promise<{ data: Slot }> {
  const { data } = await http<BackendSlot>('GET', `/${id}/`);
  return { data: toFrontendSlot(data) };
}

/**
 * POST /slots/
 * Creates a new slot. Accepts the partial Slot shape from SlotModal.
 * Returns the created slot mapped to the frontend Slot shape.
 */
export async function createSlot(data: Partial<Slot>, canteenId?: string): Promise<{ data: Slot }> {
  const payload = toBackendPayload(data, undefined, canteenId);
  const { data: created } = await http<BackendSlot>('POST', '/', payload);
  return { data: toFrontendSlot(created) };
}

/**
 * PUT /slots/{id}/
 * Full update of an existing slot.
 * `fallback` is the existing slot — used to fill fields that the modal
 * didn't touch (avoids sending undefined values).
 */
export async function updateSlot(
  id: string,
  data: Partial<Slot>,
  fallback?: Slot,
  canteenId?: string,
): Promise<{ data: Slot }> {
  const payload = toBackendPayload(data, fallback, canteenId);
  const { data: updated } = await http<BackendSlot>('PUT', `/${id}/`, payload);
  return { data: toFrontendSlot(updated) };
}

/**
 * DELETE /slots/{id}/
 * Returns null on success (204 No Content).
 */
export async function deleteSlot(id: string): Promise<{ data: null }> {
  return http<null>('DELETE', `/${id}/`);
}

/**
 * PATCH /slots/{id}/
 * Toggle the is_active state of a slot (reopen if closed, close if open).
 * Uses a partial update so only the is_active flag is changed.
 */
export async function toggleSlotActive(
  slotId: string,
  isActive: boolean,
): Promise<{ data: Slot }> {
  const { data: updated } = await http<BackendSlot>('PATCH', `/${slotId}/`, { is_active: isActive });
  return { data: toFrontendSlot(updated) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot Item Availability
// ─────────────────────────────────────────────────────────────────────────────

export interface SlotItemRow {
  menu_item_id: string;
  is_enabled: boolean;
  max_qty_per_order: number;
  available_quantity: number | null;
}

/**
 * GET /slots/{slotId}/items/
 * Returns the raw SlotMenuItem list (not mapped to Slot — used to refresh
 * the availability modal independently of the slot list).
 */
export async function fetchSlotItems(slotId: string): Promise<{ data: SlotItemRow[] }> {
  return http<SlotItemRow[]>('GET', `/${slotId}/items/`);
}

/**
 * PATCH /slots/{slotId}/items/{itemId}/
 * Toggles is_enabled for one item in the slot.
 *
 * admin-slots.tsx passes the itemId as a UUID string.
 * The backend URL regex accepts [0-9a-f-]+ (updated from \d+ in the viewset).
 */
export async function toggleSlotItem(
  slotId: string,
  itemId: string,
  is_enabled: boolean,
): Promise<{ data: SlotItemRow }> {
  return http<SlotItemRow>('PATCH', `/${slotId}/items/${itemId}/`, { is_enabled });
}

/**
 * POST /slots/{slotId}/close/
 * Marks a slot as CLOSED and disables all assigned items.
 */
export async function closeSlot(slotId: string): Promise<{ data: Slot }> {
  const { data } = await http<BackendSlot>('POST', `/${slotId}/close/`, {});
  return { data: toFrontendSlot(data) };
}

/**
 * POST /slots/{slotId}/items/{itemId}/force-close/
 * Force-disables one item in the slot.
 */
export async function forceCloseSlotItem(
  slotId: string,
  itemId: string,
): Promise<{ data: SlotItemRow }> {
  return http<SlotItemRow>('POST', `/${slotId}/items/${itemId}/force-close/`, {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience endpoints (wrappers around /slots/today/ and /slots/upcoming/)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /slots/today/
 * Returns today's slots mapped to the frontend Slot shape.
 */
export async function fetchTodaySlots(): Promise<{ data: Slot[] }> {
  const { data } = await http<BackendSlot[]>('GET', '/today/');
  return { data: (data ?? []).map(toFrontendSlot) };
}

/**
 * GET /slots/upcoming/
 * Returns upcoming slots (date >= today) mapped to the frontend Slot shape.
 */
export async function fetchUpcomingSlots(): Promise<{ data: Slot[] }> {
  const { data } = await http<BackendSlot[]>('GET', '/upcoming/');
  return { data: (data ?? []).map(toFrontendSlot) };
}
