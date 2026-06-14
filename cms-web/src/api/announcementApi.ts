/**
 * src/api/announcementApi.ts
 *
 * Announcement API integration layer.
 *
 * Bridges the gap between:
 *   - Frontend  : Announcement shape used in admin-announcements.tsx (camelCase)
 *   - Backend   : Announcement shape from the Django REST API  (snake_case)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Field mapping
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Backend field       │ Frontend field
 * ─────────────────────┼──────────────────────────────────────────────────────
 *  id (integer)        │ id  (kept as number; cast to string where UI needs it)
 *  title               │ title
 *  message             │ message
 *  date                │ date          "YYYY-MM-DD"
 *  time_from           │ fromTime      "HH:MM"  (Django sends "HH:MM:SS" — trimmed)
 *  time_to             │ toTime        "HH:MM"
 *  time_range          │ —             (derived from fromTime/toTime in UI; not stored)
 *  special_dish        │ specialDish
 *  status "active"|"inactive" │ active  boolean
 *  created_at          │ createdAt
 *  updated_at          │ updatedAt
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Pagination
 * ─────────────────────────────────────────────────────────────────────────────
 *  The backend paginates with PageNumberPagination (page_size=20).
 *  admin-announcements.tsx does its own client-side pagination (PAGE_SIZE=6)
 *  after filtering. To keep that working we fetch all pages up front via
 *  fetchAllAnnouncements() — or you can switch to server-side pagination by
 *  using fetchAnnouncements({ page, search, status }) directly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage in admin-announcements.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 *  Replace the store imports:
 *    import { createAnnouncement, deleteAnnouncement, updateAnnouncement, useStore }
 *      from "@/lib/store";
 *  With:
 *    import {
 *      fetchAllAnnouncements,
 *      createAnnouncement,
 *      updateAnnouncement,
 *      deleteAnnouncement,
 *      toggleAnnouncementStatus,
 *      fetchAnnouncementStats,
 *      type Announcement,
 *      type AnnouncementStats,
 *    } from "@/api/announcementApi";
 *
 *  Then load data in a useEffect:
 *    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
 *    useEffect(() => { fetchAllAnnouncements().then(setAnnouncements); }, []);
 *
 *  handleSave:
 *    if (editing) {
 *      const updated = await updateAnnouncement(editing.id, form);
 *      setAnnouncements(prev => prev.map(a => a.id === updated.id ? updated : a));
 *    } else {
 *      const created = await createAnnouncement(form);
 *      setAnnouncements(prev => [created, ...prev]);
 *    }
 *
 *  handleToggleActive:
 *    const updated = await toggleAnnouncementStatus(announcement.id);
 *    setAnnouncements(prev => prev.map(a => a.id === updated.id ? updated : a));
 *
 *  handleDelete:
 *    await deleteAnnouncement(id);
 *    setAnnouncements(prev => prev.filter(a => a.id !== id));
 */

import api from "@/api/client";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const BASE_PATH = "/cms/announcements";
const SPECIAL_DISH_PATH = "/cms/special-dishes";

// ─────────────────────────────────────────────────────────────────────────────
// Frontend-facing types
// ─────────────────────────────────────────────────────────────────────────────

/** The shape used throughout admin-announcements.tsx. */
export interface Announcement {
  id: number;
  title: string;
  message: string;
  date: string;        // "YYYY-MM-DD"
  fromTime: string;    // "HH:MM"
  toTime: string;      // "HH:MM"
  specialDish: string;
  active: boolean;     // true = "active", false = "inactive"
  createdAt: string;
  updatedAt: string;
}

/** Summary stats for the three stat cards at the top of the page. */
export interface AnnouncementStats {
  total: number;
  active: number;
  inactive: number;
  withSpecialDish: number;
}

export interface SpecialDish {
  id: number;
  name: string;
  createdAt: string;
}

/** Input accepted by createAnnouncement / updateAnnouncement. */
export interface AnnouncementInput {
  title: string;
  message: string;
  date: string;
  fromTime: string;   // "HH:MM"
  toTime: string;     // "HH:MM"
  specialDish?: string;
  active?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend response shapes
// ─────────────────────────────────────────────────────────────────────────────

interface BackendAnnouncement {
  id: number;
  title: string;
  message: string;
  date: string;
  time_from: string;     // "HH:MM:SS"
  time_to: string;       // "HH:MM:SS"
  time_range: string;    // "HH:MM — HH:MM"  (read-only, built by backend)
  special_dish: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

interface BackendStats {
  total: number;
  active: number;
  inactive: number;
  with_special_dish: number;
}

interface BackendSpecialDish {
  id: number;
  name: string;
  created_at: string;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers — backend ↔ frontend
// ─────────────────────────────────────────────────────────────────────────────

/** Trim "HH:MM:SS" (Django TimeField) to "HH:MM" for inputs and display. */
function trimTime(t: string): string {
  return t?.slice(0, 5) ?? '';
}

function toFrontend(b: BackendAnnouncement): Announcement {
  return {
    id:          b.id,
    title:       b.title,
    message:     b.message,
    date:        b.date,
    fromTime:    trimTime(b.time_from),
    toTime:      trimTime(b.time_to),
    specialDish: b.special_dish ?? '',
    active:      b.status === 'active',
    createdAt:   b.created_at,
    updatedAt:   b.updated_at,
  };
}

function toBackendPayload(input: AnnouncementInput): Record<string, unknown> {
  return {
    title:        input.title.trim(),
    message:      input.message.trim(),
    date:         input.date,
    time_from:    input.fromTime,
    time_to:      input.toTime,
    special_dish: input.specialDish?.trim() ?? '',
    status:       (input.active ?? true) ? 'active' : 'inactive',
  };
}

function toFrontendStats(b: BackendStats): AnnouncementStats {
  return {
    total:           b.total,
    active:          b.active,
    inactive:        b.inactive,
    withSpecialDish: b.with_special_dish,
  };
}

function toFrontendSpecialDish(b: BackendSpecialDish): SpecialDish {
  return {
    id: b.id,
    name: b.name,
    createdAt: b.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers (shared authenticated client)
// ─────────────────────────────────────────────────────────────────────────────

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE_PATH}${path}`;
  switch (method) {
    case "GET":
      return (await api.get<T>(url)).data;
    case "POST":
      return (await api.post<T>(url, body ?? {})).data;
    case "PATCH":
      return (await api.patch<T>(url, body ?? {})).data;
    case "DELETE":
      await api.delete(url);
      return null as T;
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

async function specialDishHttp<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${SPECIAL_DISH_PATH}${path}`;
  switch (method) {
    case "GET":
      return (await api.get<T>(url)).data;
    case "POST":
      return (await api.post<T>(url, body ?? {})).data;
    case "DELETE":
      await api.delete(url);
      return null as T;
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /cms/announcements/?page=N&status=X&search=Y
 *
 * Returns one page of results. Use fetchAllAnnouncements() if you want
 * the full list for client-side filtering (current admin-announcements.tsx behaviour).
 */
export async function fetchAnnouncements(params?: {
  page?: number;
  status?: 'active' | 'inactive';
  search?: string;
}): Promise<{ results: Announcement[]; count: number; hasNext: boolean }> {
  const qs = new URLSearchParams();
  if (params?.page)   qs.set('page',   String(params.page));
  if (params?.status) qs.set('status', params.status);
  if (params?.search) qs.set('search', params.search);

  const query = qs.toString() ? `?${qs}` : '';
  const data = await http<PaginatedResponse<BackendAnnouncement>>('GET', `/${query}`);
  return {
    results: data.results.map(toFrontend),
    count:   data.count,
    hasNext: data.next !== null,
  };
}

/**
 * Fetches all pages and merges results.
 * Used by admin-announcements.tsx which filters and paginates client-side.
 *
 * If the dataset grows large (100+ announcements), switch to server-side
 * filtering by calling fetchAnnouncements({ search, status }) directly and
 * passing the query params from the component's search/filter state.
 */
export async function fetchAllAnnouncements(): Promise<Announcement[]> {
  const all: Announcement[] = [];
  let page = 1;

  while (true) {
    const { results, hasNext } = await fetchAnnouncements({ page });
    all.push(...results);
    if (!hasNext) break;
    page++;
  }

  return all;
}

/**
 * GET /cms/announcements/{id}/
 */
export async function fetchAnnouncementById(id: number): Promise<Announcement> {
  const data = await http<BackendAnnouncement>('GET', `/${id}/`);
  return toFrontend(data);
}

/**
 * POST /cms/announcements/
 * Creates a new announcement. Returns the created record.
 */
export async function createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
  const data = await http<BackendAnnouncement>('POST', '/', toBackendPayload(input));
  return toFrontend(data);
}

/**
 * PUT /cms/announcements/{id}/
 * Full update. Returns the updated record.
 */
export async function updateAnnouncement(
  id: number,
  input: AnnouncementInput,
): Promise<Announcement> {
  const data = await http<BackendAnnouncement>('PATCH', `/${id}/`, toBackendPayload(input));
  return toFrontend(data);
}

/**
 * PATCH /cms/announcements/{id}/
 * Partial update — use for single-field changes that don't go through the full form.
 */
export async function patchAnnouncement(
  id: number,
  input: Partial<AnnouncementInput>,
): Promise<Announcement> {
  const full = toBackendPayload(input as AnnouncementInput);
  // Only send the keys that were actually passed in
  const partial: Record<string, unknown> = {};
  if (input.title       !== undefined) partial.title        = full.title;
  if (input.message     !== undefined) partial.message      = full.message;
  if (input.date        !== undefined) partial.date         = full.date;
  if (input.fromTime    !== undefined) partial.time_from    = full.time_from;
  if (input.toTime      !== undefined) partial.time_to      = full.time_to;
  if (input.specialDish !== undefined) partial.special_dish = full.special_dish;
  if (input.active      !== undefined) partial.status       = full.status;

  const data = await http<BackendAnnouncement>('PATCH', `/${id}/`, partial);
  return toFrontend(data);
}

/**
 * DELETE /cms/announcements/{id}/
 * Returns null on success (204 No Content).
 */
export async function deleteAnnouncement(id: number): Promise<void> {
  await http<null>('DELETE', `/${id}/`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PATCH /cms/announcements/{id}/toggle_status/
 *
 * Two modes:
 *   toggleAnnouncementStatus(id)              — flip active ↔ inactive on backend
 *   toggleAnnouncementStatus(id, 'inactive')  — set explicitly
 *
 * Maps the frontend active boolean to the backend status string automatically.
 *
 * Replaces handleToggleActive in admin-announcements.tsx:
 *   const updated = await toggleAnnouncementStatus(announcement.id);
 *   setAnnouncements(prev => prev.map(a => a.id === updated.id ? updated : a));
 */
export async function toggleAnnouncementStatus(
  id: number,
  targetStatus?: 'active' | 'inactive',
): Promise<Announcement> {
  // If targetStatus is given, send it explicitly so the backend sets it directly.
  // If not, send an empty body — the backend flips the current status (BUG 5 fix).
  const body = targetStatus ? { status: targetStatus } : {};
  const data = await http<BackendAnnouncement>('PATCH', `/${id}/toggle_status/`, body);
  return toFrontend(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /cms/announcements/stats/
 *
 * Returns aggregated counts for the three stat cards.
 * The backend computes these in a single DB query (BUG 2 fix).
 *
 * Usage — replace the client-side counts in AdminAnnouncements:
 *   const [stats, setStats] = useState<AnnouncementStats | null>(null);
 *   useEffect(() => { fetchAnnouncementStats().then(setStats); }, [announcements]);
 *
 * Then in the JSX:
 *   value={String(stats?.total ?? announcements.length)}
 *   value={String(stats?.active ?? announcements.filter(a => a.active).length)}
 *   value={String(stats?.withSpecialDish ?? announcements.filter(a => a.specialDish).length)}
 */
export async function fetchAnnouncementStats(): Promise<AnnouncementStats> {
  const data = await http<BackendStats>('GET', '/stats/');
  return toFrontendStats(data);
}

export async function fetchSpecialDishes(): Promise<SpecialDish[]> {
  const data = await specialDishHttp<BackendSpecialDish[] | PaginatedResponse<BackendSpecialDish>>('GET', '/');
  const results = Array.isArray(data) ? data : data.results;
  return results.map(toFrontendSpecialDish);
}

export async function createSpecialDish(name: string): Promise<SpecialDish> {
  const data = await specialDishHttp<BackendSpecialDish>('POST', '/', { name });
  return toFrontendSpecialDish(data);
}

export async function deleteSpecialDish(id: number): Promise<void> {
  await specialDishHttp<null>('DELETE', `/${id}/`);
}
