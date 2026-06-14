/**
 * Canteen Zustand store.
 *
 * Manages:
 *  - Cart (items + slot context)
 *  - Active view navigation (all sub-views are state-based, no React Router)
 *  - Active order tracking
 *  - Admin sub-view
 */
import { create } from 'zustand';
import type { TimeSlot, CmsOrder } from '@hooks/useCanteen';

// ─── Types ───────────────────────────────────────────────────────

export type CanteenView =
  | 'dashboard'
  | 'slot-selector'
  | 'menu-browser'
  | 'checkout'
  | 'order-confirmation'
  | 'order-history'
  | 'active-order'
  // Admin sub-views
  | 'admin-dashboard'
  | 'admin-orders'
  | 'admin-menu'
  | 'admin-slots'
  | 'admin-rules'
  | 'admin-billing'
  // Device views
  | 'kitchen-board'
  | 'counter-station';

export interface CartItem {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  itemType: string;
}

interface CanteenState {
  // Navigation
  activeView: CanteenView;
  setActiveView: (view: CanteenView) => void;

  // Slot selection
  selectedSlot: TimeSlot | null;
  setSelectedSlot: (slot: TimeSlot | null) => void;

  // Cart
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void;
  removeFromCart: (menuItemId: string) => void;
  updateQuantity: (menuItemId: string, quantity: number) => void;
  clearCart: () => void;

  // Computed
  cartTotal: () => number;
  cartItemCount: () => number;

  // Active order
  activeOrder: CmsOrder | null;
  setActiveOrder: (order: CmsOrder | null) => void;

  // Counter state
  verifiedOrder: CmsOrder | null;
  setVerifiedOrder: (order: CmsOrder | null) => void;
}

// ─── Store ───────────────────────────────────────────────────────

export const useCanteenStore = create<CanteenState>((set, get) => ({
  // Navigation
  activeView: 'dashboard',
  setActiveView: (view) => set({ activeView: view }),

  // Slot selection
  selectedSlot: null,
  setSelectedSlot: (slot) => set({ selectedSlot: slot }),

  // Cart
  cart: [],

  addToCart: (item) => {
    set((state) => {
      const qty = item.quantity ?? 1;
      const existing = state.cart.find((c) => c.menuItemId === item.menuItemId);
      if (existing) {
        return {
          cart: state.cart.map((c) =>
            c.menuItemId === item.menuItemId
              ? { ...c, quantity: c.quantity + qty }
              : c,
          ),
        };
      }
      return {
        cart: [...state.cart, { ...item, quantity: qty }],
      };
    });
  },

  removeFromCart: (menuItemId) => {
    set((state) => ({ cart: state.cart.filter((c) => c.menuItemId !== menuItemId) }));
  },

  updateQuantity: (menuItemId, quantity) => {
    if (quantity <= 0) {
      get().removeFromCart(menuItemId);
      return;
    }
    set((state) => ({
      cart: state.cart.map((c) =>
        c.menuItemId === menuItemId ? { ...c, quantity } : c,
      ),
    }));
  },

  clearCart: () => set({ cart: [] }),

  // Computed helpers
  cartTotal: () => {
    return get().cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  },

  cartItemCount: () => {
    return get().cart.reduce((sum, item) => sum + item.quantity, 0);
  },

  // Active order tracking
  activeOrder: null,
  setActiveOrder: (order) => set({ activeOrder: order }),

  // Counter
  verifiedOrder: null,
  setVerifiedOrder: (order) => set({ verifiedOrder: order }),
}));
