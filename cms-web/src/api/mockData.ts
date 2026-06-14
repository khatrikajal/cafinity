// Backend migration placeholders.
// Keep these empty so unfinished legacy hooks do not show seeded demo data.

export const TODAY = new Date().toISOString().split('T')[0];
export const TS_BFST = '';
export const TS_LUNCH = '';
export const TS_EVE = '';

export const MOCK_LOCATIONS: any[] = [];
export const MOCK_CMS_LOCATIONS: any[] = [];
export const MOCK_CATEGORIES: any[] = [];
export const MOCK_ITEMS: any[] = [];
export const MOCK_BREAK_SLOTS: any[] = [];
export const MOCK_SLOT_TYPES: any[] = [];
export const MOCK_TIME_SLOTS: any[] = [];
export const MOCK_CMS_ORDERS = [];
export const MOCK_KITCHEN_BOARD = {
  accepted: [] as any[],
  preparing: [] as any[],
  prepared: [] as any[],
  timestamp: new Date().toISOString(),
};
export const MOCK_KITCHEN_DASHBOARD = {};
export const MOCK_WALLET = {
  id: '',
  employee: '',
  balance: 0,
  last_recharged_at: null,
  is_active: false,
};
export const MOCK_TRANSACTIONS: any[] = [];
export const MOCK_MY_ORDERS: any[] = [];
export const MOCK_ORDER_HISTORY: any[] = [];
export const MOCK_ESS_DASHBOARD = {
  active_order: null,
  today_slots: [] as any[],
  monthly_spend: '0.00',
  recent_orders: [] as any[],
};
export const MOCK_SLOT_MENUS: Record<string, any[]> = {};
export const MOCK_ORDERING_RULES: any[] = [];
export let MOCK_GUEST_MEALS_STATE: any[] = [];
export const MOCK_EMPLOYEES: any[] = [];
export let MOCK_EMPLOYEES_STATE: any[] = [];
export let MOCK_ITEM_SLOT_AVAILABILITY: any[] = [];
export let MOCK_ORDERS_STATE: any[] = [];
export const MOCK_BILLING: any[] = [];
