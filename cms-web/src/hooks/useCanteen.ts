import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/api/client';
import * as mock from '@/api/mockData';

function readSelectedCanteenId(): string {
  if (typeof window === 'undefined') return '';

  try {
    const selected = localStorage.getItem('canteen_selected_id');
    if (selected) return selected;

    const rawClaims = localStorage.getItem('canteen_auth_claims');
    if (rawClaims) {
      const claims = JSON.parse(rawClaims);
      return claims?.canteen_id ?? '';
    }
  } catch {
    return '';
  }

  return '';
}

// ─── Types ───────────────────────────────────────

export interface CanteenLocation {
  id: string;
  name: string;
  building: string;
  floor: string;
  company_id?: string;
  company_name?: string;
  is_active: boolean;
  operating_hours_start?: string;
  operating_hours_end?: string;
  pre_order_cutoff_minutes?: number;
  max_orders_per_slot?: number;
}

export interface MenuCategory {
  id: string;
  name: string;
  display_order: number;
  icon: string;
  is_active: boolean;
  canteen: string;
}

export interface MenuItem {
  id: string;
  category: string;
  category_name?: string;
  canteen?: string;
  name: string;
  description: string;
  item_type?: 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN' | 'BREAKFAST' | 'MEAL';
  price: number;
  employee_price?: number | null;
  effective_price?: number;
  company_subsidy_per_item?: number;
  is_available?: boolean;
  image?: string | null;
  calories?: number | null;
  preparation_time_minutes?: number;
  is_featured?: boolean;
  daily_quota?: number | null;
  slot?: string;
  slotId?: string;
  tag?: string;
  live?: boolean;
  days?: string[];
}

export interface CanteenBreakSlot {
  id: string;
  canteen: string;
  name: string;
  slot_start: string;
  slot_end: string;
  max_orders: number | null;
  is_active: boolean;
}

export interface CanteenOrderItem {
  id: string;
  menu_item: string;
  item_name: string;
  item_type: string;
  quantity: number;
  unit_price: number;
  unit_subsidy: number;
  special_instructions: string;
  line_total: number;
}

export interface CanteenOrder {
  id: string;
  order_number: string;
  employee: string;
  employee_name: string;
  employee_code: string;
  canteen: string;
  canteen_name: string;
  break_slot: string | null;
  break_slot_name: string | null;
  order_date: string;
  status: 'DRAFT' | 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED' | 'REFUNDED';
  payment_mode: string;
  subtotal: number;
  discount_amount: number;
  company_subsidy: number;
  employee_payable: number;
  placed_at: string | null;
  pickup_token: string;
  special_instructions: string;
  items: CanteenOrderItem[];
  created_at: string;
}

export interface CanteenWallet {
  id: string;
  employee: string;
  balance: number;
  last_recharged_at: string | null;
  is_active: boolean;
}

export interface WalletTransaction {
  id: string;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reference: string;
  notes: string;
  created_at: string;
}

export interface PlaceOrderPayload {
  canteen: string;
  break_slot?: string | null;
  payment_mode?: string;
  special_instructions?: string;
  items: { menu_item: string; quantity: number; special_instructions?: string }[];
}

// ─── New domain types ─────────────────────────────────────────────────────────

export interface OrderingRule {
  id: string;
  canteen: string;
  canteen_name: string;
  min_quantity_per_item: number;
  max_quantity_per_item: number;
  max_orders_per_day: number;
  order_buffer_minutes: number;
  preparation_time_minutes: number;
  cancellation_window_minutes: number;
  require_admin_approval: boolean;
  auto_accept: boolean;
}

export interface GuestMeal {
  id: string;
  canteen: string;
  canteen_name: string;
  guest_name: string;
  guest_organisation: string;
  meal_description: string;
  slot: string | null;
  slot_name: string | null;
  custom_meal_time: string | null;
  meal_date: string;
  guest_count: number;
  estimated_cost: string | null;
  notes: string;
  logged_by: string;
  logged_by_name: string;
  created_at: string;
}

export interface GuestMealPayload {
  canteen: string;
  guest_name: string;
  guest_organisation?: string;
  meal_description: string;
  slot?: string | null;
  custom_meal_time?: string | null;
  meal_date: string;
  guest_count: number;
  estimated_cost?: string | null;
  notes?: string;
}

export interface Employee {
  id: string;
  name: string;
  employee_code: string;
  email: string;
  department: string;
  designation: string;
  is_active: boolean;
  created_at: string;
}

// ─── Hooks ───────────────────────────────────────

export function useCanteenLocations() {
  return useQuery({
    queryKey: ['canteen', 'locations'],
    queryFn: async () => {
      const response = await api.get<{ results: Array<Partial<CanteenLocation> & { address_floor?: string }> }>('/cms/canteens/');
      return (response.data.results ?? []).map((canteen) => ({
        id: String(canteen.id ?? ''),
        name: String(canteen.name ?? ''),
        building: String(canteen.building ?? ''),
        floor: String(canteen.floor ?? canteen.address_floor ?? ''),
        company_id: canteen.company_id,
        company_name: canteen.company_name,
        is_active: Boolean(canteen.is_active),
        operating_hours_start: canteen.operating_hours_start ?? '',
        operating_hours_end: canteen.operating_hours_end ?? '',
        pre_order_cutoff_minutes: canteen.pre_order_cutoff_minutes ?? 0,
        max_orders_per_slot: canteen.max_orders_per_slot ?? 0,
      })) as CanteenLocation[];
    },
  });
}

export function useMenuCategories(canteenId?: string) {
  return useQuery({
    queryKey: ['canteen', 'categories', canteenId],
    queryFn: async () => mock.MOCK_CATEGORIES as MenuCategory[],
    enabled: !!canteenId,
  });
}

export function useMenuItems(canteenId?: string, categoryId?: string) {
  return useQuery({
    queryKey: ['canteen', 'items', canteenId, categoryId],
    queryFn: async () => (categoryId ? mock.MOCK_ITEMS.filter((i) => i.category === categoryId) : mock.MOCK_ITEMS) as MenuItem[],
    enabled: !!canteenId,
  });
}

export interface GuestOrderItem {
  id?: string;
  name: string;
  qty: number;
  price: number;
  is_custom: boolean;
}

export type GuestTypeValue = "GUEST" | "NEW_JOINEE" | "VENDOR";

export interface GuestOrder {
  id: string;
  order_number?: string;
  guest_name: string;
  phone: string | null;
  guest_type?: GuestTypeValue;
  status: 'pending' | 'accepted' | 'preparing' | 'prepared' | 'collected' | 'completed' | 'cancelled';
  created_at: string;
  estimated_time: string | null;
  total: number;
  items: GuestOrderItem[];
  special_instructions?: string;
}

export interface GuestOrderPayload {
  guest_name: string;
  guest_type?: GuestTypeValue;
  phone?: string;
  organisation?: string;
  estimated_time?: string;
  special_instructions?: string;
  items: Array<{
    menu_item_id?: string | null;
    name?: string;
    price?: number;
    qty: number;
  }>;
}

export interface GuestOrderStats {
  total_guests: number;
  active_orders: number;
  todays_revenue: number;
  average_order: number;
}

const guestOrderQueryKey = ['guest-orders'];

export function useGuestOrders(params?: { status?: string; search?: string; page?: number; page_size?: number; guest_type?: GuestTypeValue }) {
  return useQuery<GuestOrder[]>({
    queryKey: [...guestOrderQueryKey, params],
    queryFn: async () => {
      const query = new URLSearchParams();
      if (params?.status) query.append('status', params.status);
      if (params?.search) query.append('search', params.search);
      if (params?.page) query.append('page', String(params.page));
      if (params?.page_size) query.append('page_size', String(params.page_size));
      if (params?.guest_type) query.append('guest_type', params.guest_type);
      const { data } = await api.get<{ results?: GuestOrder[] } | GuestOrder[]>(`/guest-orders/?${query.toString()}`);
      return Array.isArray(data) ? data : (data.results ?? []);
    },
  });
}

export function useGuestOrderStats(guestType?: GuestTypeValue) {
  return useQuery({
    queryKey: ['guest-order-stats', guestType],
    queryFn: async () => {
      const query = guestType ? `?guest_type=${guestType}` : '';
      const { data } = await api.get(`/guest-orders/stats/${query}`);
      return data as GuestOrderStats;
    },
    staleTime: 30000,
  });
}

export function useGuestOrder(id?: string) {
  return useQuery({
    queryKey: ['guest-orders', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get(`/guest-orders/${id}/`);
      return data as GuestOrder;
    },
  });
}

export function useCreateGuestOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: GuestOrderPayload): Promise<GuestOrder> => {
      const { data } = await api.post('/guest-orders/', payload);
      return data as GuestOrder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: guestOrderQueryKey });
      qc.invalidateQueries({ queryKey: ['guest-order-stats'] });
    },
  });
}

export function useUpdateGuestOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }): Promise<GuestOrder> => {
      const { data } = await api.patch(`/guest-orders/${id}/status/`, { status });
      return data as GuestOrder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: guestOrderQueryKey });
      qc.invalidateQueries({ queryKey: ['guest-order-stats'] });
    },
  });
}

export function useDeleteGuestOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/guest-orders/${id}/`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: guestOrderQueryKey });
      qc.invalidateQueries({ queryKey: ['guest-order-stats'] });
    },
  });
}

export function useMenuAvailable(params?: { slot?: string; category?: string; search?: string; day?: string }) {
  return useQuery<MenuItem[]>({
    queryKey: ['menu', 'available', params],
    queryFn: async () => {
      const query = new URLSearchParams();
      if (params?.slot) query.append('slot', params.slot);
      if (params?.category) query.append('category', params.category);
      if (params?.search) query.append('search', params.search);
      if (params?.day) query.append('day', params.day);
      const canteenId = readSelectedCanteenId();
      if (canteenId) query.append('canteen_id', canteenId);
      const { data } = await api.get<{ results?: MenuItem[] } | MenuItem[]>(`/menu/available/?${query.toString()}`);
      return Array.isArray(data) ? data : (data.results ?? []);
    },
  });
}

export function useMenuSlots() {
  return useQuery<string[]>({
    queryKey: ['menu', 'slots'],
    queryFn: async () => {
      const canteenId = readSelectedCanteenId();
      const query = new URLSearchParams();
      if (canteenId) query.append('canteen_id', canteenId);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const { data } = await api.get<{ slots?: string[] }>(`/menu/slots/${suffix}`);
      return (data.slots ?? []) as string[];
    },
    staleTime: 60000,
  });
}

export function useBreakSlots(canteenId?: string) {
  return useQuery({
    queryKey: ['canteen', 'break-slots', canteenId],
    queryFn: async () => mock.MOCK_BREAK_SLOTS as CanteenBreakSlot[],
    enabled: !!canteenId,
  });
}

export function useMyOrders() {
  return useQuery({
    queryKey: ['canteen', 'my-orders'],
    queryFn: async () => mock.MOCK_MY_ORDERS as CanteenOrder[],
  });
}

export function useAllOrders() {
  return useQuery({
    queryKey: ['canteen', 'all-orders'],
    queryFn: async () => mock.MOCK_MY_ORDERS as CanteenOrder[],
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_payload: PlaceOrderPayload): Promise<CanteenOrder> => ({} as CanteenOrder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'my-orders'] });
      qc.invalidateQueries({ queryKey: ['canteen', 'wallet'] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: { orderId: string; reason?: string }): Promise<CanteenOrder> => ({} as CanteenOrder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen'] });
    },
  });
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: { orderId: string; status: string }): Promise<CanteenOrder> => ({} as CanteenOrder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen'] });
    },
  });
}

export function useMyWallet() {
  return useQuery({
    queryKey: ['canteen', 'wallet', 'me'],
    queryFn: async () => mock.MOCK_WALLET as CanteenWallet,
  });
}

export function useWalletTransactions() {
  return useQuery({
    queryKey: ['canteen', 'wallet', 'transactions'],
    queryFn: async () => mock.MOCK_TRANSACTIONS as WalletTransaction[],
  });
}

export function useRechargeWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: {
      amount: number;
      method: 'UPI' | 'SALARY';
      upi_ref?: string;
    }): Promise<CanteenWallet> => ({ id: '', employee: '', balance: 0, last_recharged_at: null, is_active: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'wallet'] });
    },
  });
}

export function useKitchenDashboard(canteenId?: string) {
  void canteenId;
  return useQuery({
    queryKey: ['canteen', 'kitchen', canteenId],
    queryFn: async () => mock.MOCK_KITCHEN_DASHBOARD as Record<string, { label: string; count: number; orders: CanteenOrder[] }>,
    refetchInterval: 15000,
  });
}

// ─── Admin: Menu Management ────────────────────

export interface MenuItemPayload {
  canteen: string;
  category: string;
  name: string;
  description?: string;
  item_type: 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';
  price: number;
  employee_price?: number | null;
  company_subsidy_per_item?: number;
  is_available?: boolean;
  calories?: number | null;
  preparation_time_minutes?: number;
  is_featured?: boolean;
  daily_quota?: number | null;
}

export interface MenuCategoryPayload {
  canteen: string;
  name: string;
  display_order?: number;
  icon?: string;
  is_active?: boolean;
}

export function useAllMenuItems(canteenId?: string) {
  void canteenId;
  return useQuery({
    queryKey: ['canteen', 'admin-items', canteenId],
    queryFn: async () => mock.MOCK_ITEMS as MenuItem[],
  });
}

export function useCreateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_payload: MenuItemPayload): Promise<MenuItem> => ({} as MenuItem),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'items'] });
      qc.invalidateQueries({ queryKey: ['canteen', 'admin-items'] });
    },
  });
}

export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: Partial<MenuItemPayload> & { id: string }): Promise<MenuItem> => ({} as MenuItem),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'items'] });
      qc.invalidateQueries({ queryKey: ['canteen', 'admin-items'] });
    },
  });
}

export function useDeleteMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_id: string): Promise<void> => {},
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'items'] });
      qc.invalidateQueries({ queryKey: ['canteen', 'admin-items'] });
    },
  });
}

export function useCreateMenuCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_payload: MenuCategoryPayload): Promise<MenuCategory> => ({} as MenuCategory),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'categories'] });
    },
  });
}

export function useDeleteMenuCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_id: string): Promise<void> => {},
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'categories'] });
    },
  });
}

// ════════════════════════════════════════════════════════════════
//  CMS PRODUCTION TYPES
// ════════════════════════════════════════════════════════════════

export type CmsOrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'PREPARED'
  | 'COLLECTED'
  | 'CANCELLED';

export interface SlotType {
  id: string;
  name: string;
  category: 'MEAL' | 'TEA_BREAK' | 'SNACK';
  default_order_deadline_mins: number;
  default_cancel_window_mins: number;
  is_active: boolean;
}

export interface TimeSlot {
  id: string;
  canteen: string;
  canteen_name: string;
  slot_type: string;
  slot_type_name: string;
  slot_type_category: string;
  name: string;
  start_time: string;
  end_time: string;
  ordering_opens_at: string | null;
  ordering_deadline_time: string;
  cancellation_deadline_time: string;
  max_orders: number | null;
  applicable_days: number[];
  display_color: string;
  is_active: boolean;
  is_ordering_open: boolean;
  current_order_count?: number;
}

export interface CmsOrderItem {
  id: string;
  menu_item: string;
  item_name_snapshot: string;
  unit_price: string;
  base_price_snapshot: string;
  pricing_rule: string | null;
  quantity: number;
  line_total: string;
}

export interface CmsOrder {
  id: string;
  order_code: string;
  employee: string;
  employee_name: string;
  employee_code: string;
  canteen: string;
  canteen_name: string;
  slot: string;
  slot_name: string;
  slot_start: string;
  slot_end: string;
  order_date: string;
  status: CmsOrderStatus;
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  deduction_amount: string;
  placed_at: string | null;
  accepted_at: string | null;
  prepared_at: string | null;
  collected_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string;
  billing_period: string;
  is_billed: boolean;
  can_cancel: boolean;
  order_items: CmsOrderItem[];
  created_at: string;
}

export interface SlotMenuItem extends MenuItem {
  applied_rule: string | null;
}

export interface BillingSummary {
  id: string;
  employee: string;
  employee_name: string;
  employee_code: string;
  department: string;
  billing_month: string;
  total_orders: number;
  total_amount: string;
  total_reversals: string;
  net_deduction: string;
  status: 'DRAFT' | 'FINALISED' | 'PROCESSED';
  finalised_at: string | null;
  processed_at: string | null;
}

export interface CmsPlaceOrderPayload {
  slot_id: string;
  items: { menu_item_id: string; quantity: number }[];
}

// ════════════════════════════════════════════════════════════════
//  CMS PRODUCTION HOOKS
// ════════════════════════════════════════════════════════════════

// ── ESS ──────────────────────────────────────────────────────────

export function useEssDashboard() {
  return useQuery({
    queryKey: ['canteen', 'ess', 'dashboard'],
    queryFn: async () => mock.MOCK_ESS_DASHBOARD,
  });
}

export function useAvailableSlots(canteenId?: string) {
  void canteenId;
  return useQuery({
    queryKey: ['canteen', 'ess', 'slots', canteenId],
    queryFn: async () => mock.MOCK_TIME_SLOTS as TimeSlot[],
  });
}

export function useSlotMenu(slotId: string | null) {
  return useQuery({
    queryKey: ['canteen', 'ess', 'slot-menu', slotId],
    queryFn: async () => {
      if (!slotId) return [] as SlotMenuItem[];
      const assignedIds = new Set(
        mock.MOCK_ITEM_SLOT_AVAILABILITY
          .filter((a) => a.slot_id === slotId)
          .map((a) => a.item_id),
      );
      return mock.MOCK_ITEMS
        .filter((item) => assignedIds.has(item.id))
        .map((item) => ({ ...item, applied_rule: null as string | null })) as SlotMenuItem[];
    },
    enabled: !!slotId,
  });
}

export function useCmsPlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CmsPlaceOrderPayload): Promise<CmsOrder> => {
      const slot = mock.MOCK_TIME_SLOTS.find((s) => s.id === payload.slot_id);
      const newOrder: CmsOrder = {
        ...mock.MOCK_CMS_ORDERS[0],
        id: `ord-new-${Date.now()}`,
        order_code: `CX-${Date.now().toString(36).toUpperCase()}`,
        slot: payload.slot_id,
        slot_name: slot?.name ?? 'Unknown',
        slot_start: slot?.start_time ?? '',
        slot_end: slot?.end_time ?? '',
        order_date: new Date().toISOString().split('T')[0],
        status: 'PENDING' as const,
        can_cancel: true,
        placed_at: new Date().toISOString(),
        accepted_at: null,
        prepared_at: null,
        collected_at: null,
        cancelled_at: null,
        order_items: payload.items.map((i, idx) => {
          const item = mock.MOCK_ITEMS.find((m) => m.id === i.menu_item_id);
          return {
            id: `oi-new-${Date.now()}-${idx}`,
            menu_item: i.menu_item_id,
            item_name_snapshot: item?.name ?? 'Item',
            unit_price: String(item?.effective_price ?? 0),
            base_price_snapshot: String(item?.price ?? 0),
            pricing_rule: null,
            quantity: i.quantity,
            line_total: String((item?.effective_price ?? 0) * i.quantity),
          };
        }),
        total_amount: String(payload.items.reduce((s, i) => {
          const item = mock.MOCK_ITEMS.find((m) => m.id === i.menu_item_id);
          return s + (item?.effective_price ?? 0) * i.quantity;
        }, 0)),
      };
      mock.MOCK_ORDERS_STATE.unshift(newOrder);
      return newOrder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'ess'] });
      qc.invalidateQueries({ queryKey: ['canteen', 'ess', 'history'] });
      qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'orders'] });
    },
  });
}

export function useCmsCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: { orderId: string; reason?: string }): Promise<CmsOrder> => ({} as CmsOrder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['canteen', 'ess'] });
      qc.invalidateQueries({ queryKey: ['canteen', 'ess', 'history'] });
    },
  });
}

export function useCmsOrderHistory(params?: {
  date_from?: string;
  date_to?: string;
  status?: string;
}) {
  return useQuery({
    queryKey: ['canteen', 'ess', 'history', params],
    queryFn: async () => {
      if (params?.status) {
        return mock.MOCK_ORDERS_STATE.filter((order) => order.status === params.status) as CmsOrder[];
      }
      return mock.MOCK_ORDERS_STATE as CmsOrder[];
    },
  });
}

// ── Admin ─────────────────────────────────────────────────────────

export function useAdminOrders(params?: {
  canteen?: string;
  slot?: string;
  status?: string;
  date?: string;
  department?: string;
}) {
  void params;
  return useQuery({
    queryKey: ['canteen', 'admin', 'orders', params],
    queryFn: async () => mock.MOCK_ORDERS_STATE as CmsOrder[],
    refetchInterval: 5000,
  });
}

export function useAcceptOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<CmsOrder> => {
      const idx = mock.MOCK_ORDERS_STATE.findIndex((o) => o.id === orderId);
      if (idx !== -1) mock.MOCK_ORDERS_STATE[idx] = { ...mock.MOCK_ORDERS_STATE[idx], status: 'ACCEPTED', accepted_at: new Date().toISOString(), can_cancel: false };
      return mock.MOCK_ORDERS_STATE[idx] as CmsOrder;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen'] }); },
  });
}

export function useRejectOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId }: { orderId: string; reason: string }): Promise<CmsOrder> => {
      const idx = mock.MOCK_ORDERS_STATE.findIndex((o) => o.id === orderId);
      if (idx !== -1) mock.MOCK_ORDERS_STATE[idx] = { ...mock.MOCK_ORDERS_STATE[idx], status: 'CANCELLED', cancelled_at: new Date().toISOString() };
      return mock.MOCK_ORDERS_STATE[idx] as CmsOrder;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen'] }); },
  });
}

export function useBillingReport(billingMonth: string) {
  void billingMonth;
  return useQuery({
    queryKey: ['canteen', 'admin', 'billing', billingMonth],
    queryFn: async () => mock.MOCK_BILLING as BillingSummary[],
    enabled: !!billingMonth,
  });
}

export function useGenerateBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_billingMonth: string) => {},
    onSuccess: (_, billingMonth) => {
      qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'billing', billingMonth] });
    },
  });
}

export function useLockBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_billingMonth: string) => {},
    onSuccess: (_, billingMonth) => {
      qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'billing', billingMonth] });
    },
  });
}

// ── Kitchen ────────────────────────────────────────────────────────

export interface KitchenBoard {
  accepted: CmsOrder[];
  preparing: CmsOrder[];
  prepared: CmsOrder[];
  timestamp: string;
}

export function useKitchenBoard(canteenId?: string) {
  void canteenId;
  return useQuery({
    queryKey: ['canteen', 'kitchen', 'board', canteenId],
    queryFn: async () => ({
      accepted: mock.MOCK_ORDERS_STATE.filter((o) => o.status === 'ACCEPTED'),
      preparing: mock.MOCK_ORDERS_STATE.filter((o) => o.status === 'PREPARING'),
      prepared: mock.MOCK_ORDERS_STATE.filter((o) => o.status === 'PREPARED'),
      timestamp: new Date().toISOString(),
    } as KitchenBoard),
    refetchInterval: 4000,
  });
}

export function useMarkPreparing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<CmsOrder> => {
      const idx = mock.MOCK_ORDERS_STATE.findIndex((o) => o.id === orderId);
      if (idx !== -1) mock.MOCK_ORDERS_STATE[idx] = { ...mock.MOCK_ORDERS_STATE[idx], status: 'PREPARING' };
      return mock.MOCK_ORDERS_STATE[idx] as CmsOrder;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'kitchen'] }); },
  });
}

export function useMarkPrepared() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<CmsOrder> => {
      const idx = mock.MOCK_ORDERS_STATE.findIndex((o) => o.id === orderId);
      if (idx !== -1) mock.MOCK_ORDERS_STATE[idx] = { ...mock.MOCK_ORDERS_STATE[idx], status: 'PREPARED', prepared_at: new Date().toISOString() };
      return mock.MOCK_ORDERS_STATE[idx] as CmsOrder;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'kitchen'] }); },
  });
}

// ── Counter ────────────────────────────────────────────────────────

export function useVerifyOrderCode() {
  return useMutation({
    mutationFn: async (orderCode: string): Promise<{ valid: boolean; order: CmsOrder }> => {
      const order = mock.MOCK_ORDERS_STATE.find((o) => o.order_code === orderCode);
      if (!order) return { valid: false, order: {} as CmsOrder };
      return { valid: true, order: order as CmsOrder };
    },
  });
}

export function useCollectOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId }: { orderId: string; orderCode?: string }): Promise<CmsOrder> => {
      const idx = mock.MOCK_ORDERS_STATE.findIndex((o) => o.id === orderId);
      if (idx !== -1) mock.MOCK_ORDERS_STATE[idx] = { ...mock.MOCK_ORDERS_STATE[idx], status: 'COLLECTED', collected_at: new Date().toISOString() };
      return mock.MOCK_ORDERS_STATE[idx] as CmsOrder;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen'] }); },
  });
}

export function useAcceptOrderByCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string): Promise<CmsOrder> => {
      const idx = mock.MOCK_ORDERS_STATE.findIndex((o) => o.id === orderId);
      if (idx === -1) throw new Error('Order not found');
      mock.MOCK_ORDERS_STATE[idx] = { ...mock.MOCK_ORDERS_STATE[idx], status: 'ACCEPTED', accepted_at: new Date().toISOString(), can_cancel: false };
      return mock.MOCK_ORDERS_STATE[idx] as CmsOrder;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen'] }); },
  });
}

// ════════════════════════════════════════════════════════════════
//  ADMIN MASTERS HOOKS
// ════════════════════════════════════════════════════════════════

// ── Canteen Locations (CMS) ──────────────────────────────────────

export interface CmsLocation {
  id: string;
  name: string;
  address: string;
  capacity: number | null;
  operating_hours_start: string;
  operating_hours_end: string;
  is_active: boolean;
  contact_person: string;
  contact_mobile: string;
}

export function useCmsLocations() {
  return useQuery({
    queryKey: ['canteen', 'admin', 'locations'],
    queryFn: async () => mock.MOCK_CMS_LOCATIONS as CmsLocation[],
  });
}

export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_data: Partial<CmsLocation>): Promise<CmsLocation> => ({} as CmsLocation),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'locations'] }); },
  });
}

export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: Partial<CmsLocation> & { id: string }): Promise<CmsLocation> => ({} as CmsLocation),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'locations'] }); },
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_id: string): Promise<void> => {},
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'locations'] }); },
  });
}

// ── Slot Types ──────────────────────────────────────────────────

export function useSlotTypes() {
  return useQuery({
    queryKey: ['canteen', 'admin', 'slot-types'],
    queryFn: async () => mock.MOCK_SLOT_TYPES as SlotType[],
  });
}

export function useCreateSlotType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_data: Partial<SlotType>): Promise<SlotType> => ({} as SlotType),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'slot-types'] }); },
  });
}

export function useUpdateSlotType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: Partial<SlotType> & { id: string }): Promise<SlotType> => ({} as SlotType),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'slot-types'] }); },
  });
}

export function useDeleteSlotType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_id: string): Promise<void> => {},
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'slot-types'] }); },
  });
}

// ── Time Slots ──────────────────────────────────────────────────

export function useAdminTimeSlots(canteenId?: string) {
  void canteenId;
  return useQuery({
    queryKey: ['canteen', 'admin', 'time-slots', canteenId],
    queryFn: async () => mock.MOCK_TIME_SLOTS as TimeSlot[],
  });
}

export function useCreateTimeSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_data: Partial<TimeSlot> & { canteen: string; slot_type: string }): Promise<TimeSlot> => ({} as TimeSlot),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'time-slots'] }); },
  });
}

export function useUpdateTimeSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_params: Partial<TimeSlot> & { id: string }): Promise<TimeSlot> => ({} as TimeSlot),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'time-slots'] }); },
  });
}

export function useDeleteTimeSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (_id: string): Promise<void> => {},
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'time-slots'] }); },
  });
}

// ════════════════════════════════════════════════════════════════
//  ORDERING RULES
// ════════════════════════════════════════════════════════════════

export function useOrderingRules(canteenId?: string) {
  void canteenId;
  return useQuery({
    queryKey: ['canteen', 'admin', 'ordering-rules', canteenId],
    queryFn: async () => {
      if (canteenId) return mock.MOCK_ORDERING_RULES.filter((r) => r.canteen === canteenId) as OrderingRule[];
      return mock.MOCK_ORDERING_RULES as OrderingRule[];
    },
  });
}

export function useUpdateOrderingRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<OrderingRule> & { id: string }): Promise<OrderingRule> => {
      const idx = mock.MOCK_ORDERING_RULES.findIndex((r) => r.id === payload.id);
      if (idx !== -1) Object.assign(mock.MOCK_ORDERING_RULES[idx], payload);
      return mock.MOCK_ORDERING_RULES[idx] as OrderingRule;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'ordering-rules'] }); },
  });
}

// ════════════════════════════════════════════════════════════════
//  GUEST MEALS
// ════════════════════════════════════════════════════════════════

export function useGuestMeals(params?: { date?: string; canteen?: string }) {
  void params;
  return useQuery({
    queryKey: ['canteen', 'guest-meals', params],
    queryFn: async () => mock.MOCK_GUEST_MEALS_STATE as GuestMeal[],
  });
}

export function useCreateGuestMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: GuestMealPayload): Promise<GuestMeal> => {
      const newMeal: GuestMeal = {
        id: `gm-${Date.now()}`,
        canteen_name: mock.MOCK_CMS_LOCATIONS.find((l) => l.id === payload.canteen)?.name ?? 'Canteen',
        guest_organisation: payload.guest_organisation ?? '',
        slot_name: mock.MOCK_TIME_SLOTS.find((s) => s.id === payload.slot)?.name ?? null,
        notes: payload.notes ?? '',
        logged_by: 'current-user',
        logged_by_name: 'Current User',
        created_at: new Date().toISOString(),
        ...payload,
      } as GuestMeal;
      mock.MOCK_GUEST_MEALS_STATE.unshift(newMeal);
      return newMeal;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'guest-meals'] }); },
  });
}

export function useUpdateGuestMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<GuestMeal> & { id: string }): Promise<GuestMeal> => {
      const idx = mock.MOCK_GUEST_MEALS_STATE.findIndex((m) => m.id === payload.id);
      if (idx !== -1) Object.assign(mock.MOCK_GUEST_MEALS_STATE[idx], payload);
      return mock.MOCK_GUEST_MEALS_STATE[idx];
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'guest-meals'] }); },
  });
}

export function useDeleteGuestMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const nextMeals = mock.MOCK_GUEST_MEALS_STATE.filter((m) => m.id !== id);
      mock.MOCK_GUEST_MEALS_STATE.splice(0, mock.MOCK_GUEST_MEALS_STATE.length, ...nextMeals);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'guest-meals'] }); },
  });
}

// ════════════════════════════════════════════════════════════════
//  ITEM-SLOT AVAILABILITY
// ════════════════════════════════════════════════════════════════

export function useItemSlotIds(itemId?: string) {
  return useQuery({
    queryKey: ['canteen', 'item-slots', itemId],
    queryFn: async () => {
      if (!itemId) return [] as string[];
      return mock.MOCK_ITEM_SLOT_AVAILABILITY.filter((a) => a.item_id === itemId).map((a) => a.slot_id);
    },
    enabled: !!itemId,
  });
}

export function useAssignItemToSlots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, slotIds }: { itemId: string; slotIds: string[] }): Promise<void> => {
      const remaining = mock.MOCK_ITEM_SLOT_AVAILABILITY.filter((a) => a.item_id !== itemId);
      mock.MOCK_ITEM_SLOT_AVAILABILITY.splice(0, mock.MOCK_ITEM_SLOT_AVAILABILITY.length, ...remaining);
      slotIds.forEach((slotId) => mock.MOCK_ITEM_SLOT_AVAILABILITY.push({ item_id: itemId, slot_id: slotId }));
    },
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: ['canteen', 'item-slots', itemId] });
      qc.invalidateQueries({ queryKey: ['canteen', 'ess', 'slot-menu'] });
    },
  });
}

// ════════════════════════════════════════════════════════════════
//  EMPLOYEES (Super Admin)
// ════════════════════════════════════════════════════════════════

export function useEmployees() {
  return useQuery({
    queryKey: ['canteen', 'admin', 'employees'],
    queryFn: async () => mock.MOCK_EMPLOYEES_STATE as Employee[],
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Omit<Employee, 'id' | 'created_at'>): Promise<Employee> => {
      const emp: Employee = { id: `emp-${Date.now()}`, created_at: new Date().toISOString(), ...payload };
      mock.MOCK_EMPLOYEES_STATE.push(emp);
      return emp;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'employees'] }); },
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Employee> & { id: string }): Promise<Employee> => {
      const idx = mock.MOCK_EMPLOYEES_STATE.findIndex((e) => e.id === payload.id);
      if (idx !== -1) Object.assign(mock.MOCK_EMPLOYEES_STATE[idx], payload);
      return mock.MOCK_EMPLOYEES_STATE[idx];
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['canteen', 'admin', 'employees'] }); },
  });
}
