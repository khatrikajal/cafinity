// Cafinity rebrand — logo + favicon update
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, useSpring } from 'framer-motion';
import {
  Wallet, X,
  Plus, Minus,
  Star, Coffee, CreditCard, BadgeIndianRupee, ArrowUpCircle,
  Edit2, Trash2, ChefHat, Tag,
  // CMS icons
  ClipboardList, UtensilsCrossed, CheckCircle2,
  QrCode, RefreshCw, AlertCircle,
  // New icons
  Shield, Users, UserCheck, Printer, BookOpen,
  Info, Clock3, Ban, AlertTriangle, Settings2,
  // Dock icons
  LayoutDashboard, ShoppingBag, Clock, MapPin, Receipt,
  Flame, ScanLine, ShoppingCart, Menu,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@utils/utils';
import { useUIStore } from '@store/uiStore';
import {
  useCanteenLocations, useMenuCategories, useMenuItems,
  useBreakSlots,
  usePlaceOrder,
  useMyWallet, useWalletTransactions, useRechargeWallet, useKitchenDashboard,
  useUpdateOrderStatus,
  useAllMenuItems, useCreateMenuItem, useUpdateMenuItem, useDeleteMenuItem,
  useCreateMenuCategory, useDeleteMenuCategory,
  // CMS hooks
  useAvailableSlots, useSlotMenu, useCmsPlaceOrder,
  useCmsCancelOrder, useCmsOrderHistory,
  useAdminOrders, useAcceptOrder, useRejectOrder,
  useBillingReport, useGenerateBilling, useLockBilling,
  useKitchenBoard, useMarkPreparing, useMarkPrepared,
  useVerifyOrderCode, useCollectOrder, useAcceptOrderByCounter,
  // Admin Masters hooks
  useCmsLocations, useCreateLocation, useUpdateLocation, useDeleteLocation,
  useSlotTypes, useCreateSlotType, useDeleteSlotType,
  useAdminTimeSlots, useCreateTimeSlot, useUpdateTimeSlot, useDeleteTimeSlot,
  // New feature hooks
  useOrderingRules, useUpdateOrderingRules,
  useGuestMeals, useCreateGuestMeal, useUpdateGuestMeal, useDeleteGuestMeal,
  useItemSlotIds, useAssignItemToSlots,
  useEmployees, useCreateEmployee, useUpdateEmployee,
  type CanteenLocation, type MenuItem, type CanteenBreakSlot,
  type CanteenWallet, type WalletTransaction,
  type CmsOrder, type TimeSlot, type CmsLocation,
  type OrderingRule, type GuestMeal, type GuestMealPayload, type Employee,
} from '@hooks/useCanteen';
import { useCanteenStore } from '@store/canteenStore';
import OrderStatusBadge from '@components/ui/OrderStatusBadge';
import DeadlineCountdown from '@components/ui/DeadlineCountdown';
import OrderCodeDisplay from '@components/ui/OrderCodeDisplay';
import GlassCard from '@components/ui/GlassCard';
import { downloadCSV } from '../../../lib/store';

// ─── Helpers ─────────────────────────────────────

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PLACED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-indigo-100 text-indigo-700',
  PREPARING: 'bg-amber-100 text-amber-700',
  READY: 'bg-green-100 text-green-700',
  COLLECTED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-600',
  REFUNDED: 'bg-gray-100 text-gray-600',
};

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

// ─── Order Menu (Employee order flow — Groniva-style) ────────────

function formatSlot(slot: CanteenBreakSlot): string {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const start = slot.slot_start.slice(0, 5);
  const end = slot.slot_end.slice(0, 5);
  return `${dd}-${mm}-${yyyy} ${start}-${end}`;
}

function OrderMenu({ locations }: { locations: CanteenLocation[] }) {
  const [selectedLocation, setSelectedLocation] = useState<string>(locations[0]?.id ?? '');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [paymentMode, setPaymentMode] = useState<string>('WALLET');

  const { data: walletRaw } = useMyWallet();
  const wallet = walletRaw as CanteenWallet | undefined;
  const walletBalance = Number(wallet?.balance ?? 0);

  const { data: breakSlots = [] } = useBreakSlots(selectedLocation || undefined);
  const { data: categories = [] } = useMenuCategories(selectedLocation);
  const { data: items = [] } = useMenuItems(selectedLocation);
  const placeOrder = usePlaceOrder();

  // Auto-select first location when data loads
  useEffect(() => {
    if (locations.length > 0 && !selectedLocation) {
      setSelectedLocation(locations[0].id);
    }
  }, [locations, selectedLocation]);

  // Auto-select first available break slot
  useEffect(() => {
    if (breakSlots.length > 0 && !selectedSlot) {
      setSelectedSlot(breakSlots[0].id);
    }
  }, [breakSlots, selectedSlot]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, c) => sum + (c.menuItem.effective_price ?? 0) * c.quantity, 0),
    [cart],
  );

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const filteredItems = useMemo(
    () => !search ? items : items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())),
    [items, search],
  );

  function toggleItem(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItem.id === item.id);
      if (existing) return prev.filter((c) => c.menuItem.id !== item.id);
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  }

  function setQty(item: MenuItem, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.menuItem.id !== item.id));
    } else {
      setCart((prev) => {
        const existing = prev.find((c) => c.menuItem.id === item.id);
        if (existing) return prev.map((c) => c.menuItem.id === item.id ? { ...c, quantity: qty } : c);
        return [...prev, { menuItem: item, quantity: qty }];
      });
    }
  }

  function handlePlaceOrder() {
    if (!cart.length || !selectedLocation) return;
    placeOrder.mutate(
      {
        canteen: selectedLocation,
        items: cart.map((c) => ({ menu_item: c.menuItem.id, quantity: c.quantity })),
        break_slot: selectedSlot || null,
        payment_mode: paymentMode,
      },
      { onSuccess: () => setCart([]) },
    );
  }

  if (!locations.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Coffee className="h-10 w-10 text-surface-300 dark:text-white/20" />
        <p className="mt-3 text-sm text-surface-500 dark:text-white/40">No canteen locations configured yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* ── Controls bar ─────────────────────────── */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-surface-100 bg-white px-5 py-4 dark:border-white/5 dark:bg-surface-900">
        {/* Location switcher */}
        {locations.length > 1 && (
          <div className="flex gap-2">
            {locations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => { setSelectedLocation(loc.id); setSelectedSlot(''); }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  selectedLocation === loc.id
                    ? 'bg-surface-900 text-white dark:bg-white dark:text-surface-900'
                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-white/5 dark:text-white/60',
                )}
              >
                {loc.name}
              </button>
            ))}
          </div>
        )}

        {/* Break slot dropdown */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-surface-700 dark:text-white/70">Break Slot</p>
          <select
            value={selectedSlot}
            onChange={(e) => setSelectedSlot(e.target.value)}
            className="min-w-[220px] rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-xs text-surface-800 shadow-sm focus:border-blue-400 focus:outline-none dark:border-white/10 dark:bg-surface-800 dark:text-white"
          >
            {breakSlots.length === 0 && <option value="">No slots available</option>}
            {breakSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {formatSlot(slot)}{slot.name ? ` — ${slot.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="ml-auto">
          <input
            type="text"
            placeholder="Search menu..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-xs text-surface-800 placeholder-surface-400 shadow-sm focus:border-blue-400 focus:outline-none dark:border-white/10 dark:bg-surface-800 dark:text-white"
          />
        </div>
      </div>

      {/* ── Menu grid ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {filteredItems.map((item, idx) => {
          const inCart = cart.find((c) => c.menuItem.id === item.id);
          const checked = !!inCart;
          const qty = inCart?.quantity ?? 1;

          return (
            <motion.div
              key={item.id}
              layout
              className={cn(
                'flex items-center gap-3 border-b border-surface-100 p-3 dark:border-white/5',
                idx % 2 === 0 ? 'sm:border-r' : '',
              )}
            >
              {/* Row number */}
              <span className="w-5 shrink-0 text-center text-xs font-medium text-surface-400 dark:text-white/30">
                {idx + 1}
              </span>

              {/* Checkbox */}
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleItem(item)}
                className="h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
              />

              {/* Food image */}
              {item.image ? (
                <img
                  src={item.image}
                  alt={item.name}
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-surface-100 dark:bg-white/5">
                  <Coffee className="h-6 w-6 text-surface-300 dark:text-white/20" />
                </div>
              )}

              {/* Info + stepper */}
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <p className="text-xs text-surface-500 dark:text-white/50">
                  <span className="font-semibold text-surface-700 dark:text-white/70">Menu Label : </span>
                  {item.name}
                  {item.is_featured && (
                    <Star className="ml-1 inline h-3 w-3 fill-amber-400 text-amber-400" />
                  )}
                </p>
                <p className="text-xs text-surface-500 dark:text-white/50">
                  <span className="font-semibold text-surface-700 dark:text-white/70">Meal Session : </span>
                  {item.category_name || categoryMap[item.category] || '—'}
                </p>
                <div className="mt-1.5 flex items-center gap-1">
                  <button
                    onClick={() => { if (checked) setQty(item, qty - 1); }}
                    disabled={!checked}
                    className="flex h-6 w-6 items-center justify-center rounded border border-red-300 bg-red-50 text-red-600 transition hover:bg-red-100 disabled:opacity-30 dark:border-red-800 dark:bg-red-950/20"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-6 text-center text-xs font-bold text-surface-800 dark:text-white">
                    {checked ? qty : 1}
                  </span>
                  <button
                    onClick={() => checked ? setQty(item, qty + 1) : toggleItem(item)}
                    className="flex h-6 w-6 items-center justify-center rounded border border-green-300 bg-green-50 text-green-700 transition hover:bg-green-100 dark:border-green-800 dark:bg-green-950/20"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Price */}
              <div className="shrink-0 text-right">
                <p className="text-[10px] text-surface-400 dark:text-white/30">Price :</p>
                <p className="text-sm font-bold text-surface-900 dark:text-white">{item.effective_price}</p>
              </div>
            </motion.div>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="col-span-full py-12 text-center text-sm text-surface-400 dark:text-white/30">
            No items available.
          </div>
        )}
      </div>

      {/* ── Grand Total + Place Order ─────────────── */}
      {/* ── Payment Method + Place Order ─────────── */}
      <div className="border-t border-surface-100 bg-white dark:border-white/5 dark:bg-surface-900">
        {/* Payment method row */}
        <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
          <span className="text-xs font-semibold text-surface-500 dark:text-white/40">Pay via:</span>
          {([
            { value: 'WALLET', label: '💳 Wallet', sub: walletBalance > 0 ? `₹${walletBalance.toFixed(2)}` : 'Add money first' },
            { value: 'PAYROLL_DEDUCTION', label: '💼 Salary', sub: 'Deducted from payslip' },
            { value: 'UPI', label: '📱 UPI', sub: 'Google Pay / PhonePe' },
            { value: 'CASH', label: '💵 Cash', sub: 'At counter' },
          ] as const).map((pm) => (
            <button
              key={pm.value}
              type="button"
              onClick={() => setPaymentMode(pm.value)}
              className={cn(
                'flex flex-col rounded-xl border px-3 py-1.5 text-left transition-all',
                paymentMode === pm.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-surface-200 bg-surface-50 dark:border-white/10 dark:bg-white/5',
              )}
            >
              <span className={cn('text-xs font-semibold', paymentMode === pm.value ? 'text-blue-700 dark:text-blue-400' : 'text-surface-700 dark:text-white/60')}>
                {pm.label}
              </span>
              <span className="text-[10px] text-surface-400 dark:text-white/30">{pm.sub}</span>
            </button>
          ))}
        </div>
        {/* Total + button row */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-surface-700 dark:text-white/70">Grand Total:</span>
            <span className="rounded-full bg-blue-100 px-3 py-0.5 text-sm font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
              ₹{cartTotal.toFixed(2)}
            </span>
            {paymentMode === 'WALLET' && cartTotal > 0 && walletBalance < cartTotal && (
              <span className="text-xs font-medium text-red-500">Insufficient balance</span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={placeOrder.isPending || (paymentMode === 'WALLET' && cartTotal > walletBalance)}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-green-700 disabled:opacity-50"
            >
              {placeOrder.isPending ? 'Placing…' : `Place Order (${cart.length} item${cart.length > 1 ? 's' : ''})`}
            </button>
          )}
        </div>
        {placeOrder.isError && (
          <p className="px-5 pb-2 text-xs text-red-600 dark:text-red-400">
            {(placeOrder.error as Error)?.message ?? 'Failed to place order. Please try again.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Wallet ──────────────────────────────────────

const TXN_LABEL: Record<string, string> = {
  CREDIT_RECHARGE: 'Wallet Recharge',
  CREDIT_REFUND: 'Order Refund',
  CREDIT_SUBSIDY: 'Company Subsidy',
  DEBIT_ORDER: 'Order Payment',
  DEBIT_EXPIRED: 'Balance Expired',
};

type UpiApp = 'gpay' | 'phonepe' | 'paytm' | 'other';

const UPI_APPS: { id: UpiApp; label: string }[] = [
  { id: 'gpay', label: 'Google Pay' },
  { id: 'phonepe', label: 'PhonePe' },
  { id: 'paytm', label: 'Paytm' },
  { id: 'other', label: 'Other UPI' },
];

function WalletView() {
  const { data: walletRaw, isLoading: walletLoading } = useMyWallet();
  const wallet = walletRaw as CanteenWallet | undefined;
  const { data: txnsRaw = [] } = useWalletTransactions();
  const transactions = txnsRaw as unknown as WalletTransaction[];
  const recharge = useRechargeWallet();

  const [showAdd, setShowAdd] = useState(false);
  const [method, setMethod] = useState<'UPI' | 'SALARY'>('UPI');
  const [upiApp, setUpiApp] = useState<UpiApp>('gpay');
  const [amount, setAmount] = useState('');
  const [upiRef, setUpiRef] = useState('');

  const balance = Number(wallet?.balance ?? 0);

  function handleRecharge() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    recharge.mutate(
      { amount: amt, method, upi_ref: upiRef || undefined },
      {
        onSuccess: () => {
          setShowAdd(false);
          setAmount('');
          setUpiRef('');
        },
      },
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* ── Balance card ─────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-green-600 to-emerald-700 p-5 text-white shadow-lg">
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 opacity-80" />
            <span className="text-sm font-medium opacity-80">Canteen Wallet</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur-sm transition-colors hover:bg-white/30"
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showAdd ? 'Cancel' : 'Add Money'}
          </button>
        </div>
        {walletLoading ? (
          <div className="mt-3 h-9 w-32 animate-pulse rounded-lg bg-white/20" />
        ) : (
          <p className="mt-3 text-4xl font-bold">₹{balance.toFixed(2)}</p>
        )}
        <p className="mt-0.5 text-xs opacity-60">Available Balance</p>
      </div>

      {/* ── Add Money Panel ──────────────────────── */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-surface-200/70 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-surface-800"
          >
            <h3 className="mb-4 text-sm font-semibold text-surface-900 dark:text-white">Add Money to Wallet</h3>

            {/* Method toggle */}
            <div className="mb-4 flex gap-2">
              {(['UPI', 'SALARY'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors',
                    method === m
                      ? 'bg-green-600 text-white'
                      : 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-white/50',
                  )}
                >
                  {m === 'UPI' ? <><CreditCard className="h-4 w-4" /> UPI / QR</> : <><BadgeIndianRupee className="h-4 w-4" /> From Salary</>}
                </button>
              ))}
            </div>

            {/* Amount input */}
            <div className="mb-3">
              <label className="mb-1.5 block text-xs font-medium text-surface-700 dark:text-white/70">Amount (₹)</label>
              <input
                type="number"
                min="1"
                placeholder="Enter amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-surface-300/70 bg-surface-0 px-3 py-2.5 text-sm text-surface-900 placeholder-surface-400 focus:border-green-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
              <div className="mt-2 flex gap-2">
                {[100, 200, 500, 1000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(String(preset))}
                    className="flex-1 rounded-lg bg-surface-100 py-1.5 text-xs font-semibold text-surface-600 hover:bg-surface-200 dark:bg-white/5 dark:text-white/50"
                  >
                    +₹{preset}
                  </button>
                ))}
              </div>
            </div>

            {/* UPI method */}
            {method === 'UPI' && (
              <>
                <div className="mb-3">
                  <label className="mb-1.5 block text-xs font-medium text-surface-700 dark:text-white/70">Pay via</label>
                  <div className="grid grid-cols-4 gap-2">
                    {UPI_APPS.map((app) => (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => setUpiApp(app.id)}
                        className={cn(
                          'rounded-xl border-2 px-2 py-2.5 text-center text-xs font-medium transition-all',
                          upiApp === app.id
                            ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                            : 'border-surface-200 bg-surface-50 text-surface-600 dark:border-white/10 dark:bg-white/5 dark:text-white/50',
                        )}
                      >
                        {app.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-medium text-surface-700 dark:text-white/70">
                    UPI Transaction ID <span className="font-normal text-surface-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. T2025xxxxxxxxxxxx"
                    value={upiRef}
                    onChange={(e) => setUpiRef(e.target.value)}
                    className="w-full rounded-xl border border-surface-300/70 bg-surface-0 px-3 py-2.5 text-sm text-surface-900 placeholder-surface-400 focus:border-green-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                </div>
              </>
            )}

            {/* Salary note */}
            {method === 'SALARY' && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/30 dark:bg-amber-900/10">
                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-400">
                  💡 The entered amount will be deducted from your next salary payment and instantly credited to your canteen wallet.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={handleRecharge}
              disabled={!amount || parseFloat(amount) <= 0 || recharge.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              <ArrowUpCircle className="h-4 w-4" />
              {recharge.isPending
                ? 'Processing…'
                : method === 'UPI'
                ? `Pay ₹${amount || '0'} via ${UPI_APPS.find((a) => a.id === upiApp)?.label ?? 'UPI'}`
                : `Add ₹${amount || '0'} from Salary`}
            </button>

            {recharge.isError && (
              <p className="mt-2 text-center text-xs text-red-600 dark:text-red-400">Payment failed. Please try again.</p>
            )}
            {recharge.isSuccess && (
              <p className="mt-2 text-center text-xs font-medium text-green-600 dark:text-green-400">✓ ₹{amount} added to wallet!</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Transaction History ───────────────────── */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-white/30">
          Transaction History
        </h3>
        <div className="mt-2 space-y-2">
          {transactions.map((txn) => {
            const isCredit = txn.transaction_type.startsWith('CREDIT');
            const amt = Number(txn.amount);
            const balAfter = Number(txn.balance_after);
            return (
              <div
                key={txn.id}
                className="flex items-center justify-between rounded-xl border border-surface-100 p-3 dark:border-white/5"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      isCredit
                        ? 'bg-green-100 text-green-600 dark:bg-green-900/20'
                        : 'bg-red-100 text-red-600 dark:bg-red-900/20',
                    )}
                  >
                    {isCredit ? '↑' : '↓'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">
                      {TXN_LABEL[txn.transaction_type] ?? txn.transaction_type.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-surface-500 dark:text-white/40">
                      {new Date(txn.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={cn('text-sm font-bold', isCredit ? 'text-green-600' : 'text-red-600')}>
                    {isCredit ? '+' : '−'}₹{amt.toFixed(2)}
                  </span>
                  <p className="text-[10px] text-surface-400 dark:text-white/30">Bal ₹{balAfter.toFixed(2)}</p>
                </div>
              </div>
            );
          })}
          {transactions.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <Wallet className="h-8 w-8 text-surface-300 dark:text-white/20" />
              <p className="mt-3 text-sm text-surface-500 dark:text-white/40">No transactions yet</p>
              <p className="mt-1 text-xs text-surface-400 dark:text-white/30">Add money to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Kitchen View (Admin) ────────────────────────

function KitchenView({ locations }: { locations: CanteenLocation[] }) {
  const [selectedLocation, setSelectedLocation] = useState<string>(locations[0]?.id ?? '');
  const { data: dashboard } = useKitchenDashboard(selectedLocation || undefined);
  const updateStatus = useUpdateOrderStatus();

  const activeStatuses = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY'];

  return (
    <div className="p-4">
      {/* Location selector */}
      {locations.length > 1 && (
        <div className="mb-4 flex gap-2">
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => setSelectedLocation(loc.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                selectedLocation === loc.id
                  ? 'bg-surface-900 text-white dark:bg-white dark:text-surface-900'
                  : 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-white/60',
              )}
            >
              {loc.name}
            </button>
          ))}
        </div>
      )}

      {/* Status columns */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {activeStatuses.map((statusKey) => {
          const data = dashboard?.[statusKey];
          return (
            <div key={statusKey} className="rounded-xl border border-surface-100 dark:border-white/5">
              <div className="flex items-center justify-between border-b border-surface-100 p-3 dark:border-white/5">
                <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', statusColors[statusKey])}>
                  {data?.label ?? statusKey}
                </span>
                <span className="text-sm font-bold text-surface-600 dark:text-white/60">{data?.count ?? 0}</span>
              </div>
              <div className="max-h-[400px] space-y-2 overflow-y-auto p-2">
                {(data?.orders ?? []).map((order) => (
                  <div key={order.id} className="rounded-lg bg-surface-50 p-2 dark:bg-white/[0.02]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-surface-900 dark:text-white">{order.order_number}</span>
                      <span className="text-xs text-surface-500 dark:text-white/40">{order.pickup_token}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-surface-600 dark:text-white/50">{order.employee_name}</p>
                    <div className="mt-1 space-y-0.5">
                      {order.items.map((it) => (
                        <p key={it.id} className="text-xs text-surface-500 dark:text-white/40">
                          {it.item_name} ×{it.quantity}
                        </p>
                      ))}
                    </div>
                    {/* Action button */}
                    {statusKey === 'PLACED' && (
                      <button
                        onClick={() => updateStatus.mutate({ orderId: order.id, status: 'CONFIRMED' })}
                        className="mt-2 w-full rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                      >
                        Confirm
                      </button>
                    )}
                    {statusKey === 'CONFIRMED' && (
                      <button
                        onClick={() => updateStatus.mutate({ orderId: order.id, status: 'PREPARING' })}
                        className="mt-2 w-full rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700"
                      >
                        Start Preparing
                      </button>
                    )}
                    {statusKey === 'PREPARING' && (
                      <button
                        onClick={() => updateStatus.mutate({ orderId: order.id, status: 'READY' })}
                        className="mt-2 w-full rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
                      >
                        Mark Ready
                      </button>
                    )}
                    {statusKey === 'READY' && (
                      <button
                        onClick={() => updateStatus.mutate({ orderId: order.id, status: 'COLLECTED' })}
                        className="mt-2 w-full rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Collected
                      </button>
                    )}
                  </div>
                ))}
                {(data?.orders ?? []).length === 0 && (
                  <p className="py-4 text-center text-xs text-surface-300 dark:text-white/20">No orders</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Admin: Menu Management ──────────────────────

const ITEM_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  VEG: { label: 'Veg', color: 'bg-green-100 text-green-700' },
  NON_VEG: { label: 'Non-Veg', color: 'bg-red-100 text-red-700' },
  EGG: { label: 'Egg', color: 'bg-yellow-100 text-yellow-700' },
  VEGAN: { label: 'Vegan', color: 'bg-emerald-100 text-emerald-700' },
};

function ItemSlotBadges({ itemId, allSlots }: { itemId: string; allSlots: TimeSlot[] }) {
  const { data: slotIds = [] } = useItemSlotIds(itemId);
  const assigned = allSlots.filter((s) => slotIds.includes(s.id));
  if (assigned.length === 0) return <span className="mt-1 inline-block text-xs text-surface-400 dark:text-white/30">No slots assigned</span>;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {assigned.map((s) => (
        <span key={s.id} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-900/20 dark:text-brand-300">
          {s.name}
        </span>
      ))}
    </div>
  );
}

function AdminMenuManagement({ locations }: { locations: CanteenLocation[] }) {
  const [selectedLocation, setSelectedLocation] = useState<string>(locations[0]?.id ?? '');
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmCatDelete, setConfirmCatDelete] = useState<string | null>(null);

  const { data: categories = [] } = useMenuCategories(selectedLocation);
  const { data: items = [] } = useAllMenuItems(selectedLocation);
  const { data: allSlots = [] } = useAdminTimeSlots(selectedLocation || undefined);
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();
  const deleteItem = useDeleteMenuItem();
  const createCategory = useCreateMenuCategory();
  const deleteCategory = useDeleteMenuCategory();
  const assignToSlots = useAssignItemToSlots();

  // ── Add/Edit item form state ──────────────────
  type ItemFormState = {
    name: string; description: string; item_type: 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';
    price: string; employee_price: string; is_available: boolean; is_featured: boolean;
    calories: string; preparation_time_minutes: string; category: string; daily_quota: string;
    slot_ids: string[];
  };
  const blankForm: ItemFormState = {
    name: '', description: '', item_type: 'VEG',
    price: '', employee_price: '', is_available: true,
    is_featured: false, calories: '', preparation_time_minutes: '5',
    category: categories[0]?.id ?? '', daily_quota: '', slot_ids: [],
  };
  const [form, setForm] = useState<ItemFormState>(blankForm);

  function openAdd() {
    setForm({ ...blankForm, category: categories[0]?.id ?? '' });
    setEditItem(null);
    setShowAddItem(true);
  }

  function openEdit(item: MenuItem) {
    setForm({
      name: item.name,
      description: item.description ?? '',
      item_type: (['VEG', 'NON_VEG', 'EGG', 'VEGAN'] as const).includes(item.item_type as 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN')
        ? (item.item_type as 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN')
        : 'VEG',
      price: String(item.price),
      employee_price: item.employee_price != null ? String(item.employee_price) : '',
      is_available: item.is_available ?? true,
      is_featured: item.is_featured ?? false,
      calories: item.calories != null ? String(item.calories) : '',
      preparation_time_minutes: String(item.preparation_time_minutes),
      category: item.category,
      daily_quota: item.daily_quota != null ? String(item.daily_quota) : '',
      slot_ids: [],  // will be loaded by useItemSlotIds
    });
    setEditItem(item);
    setShowAddItem(true);
  }

  // Load current slot assignments when editing
  const { data: existingSlotIds = [] } = useItemSlotIds(editItem?.id);
  useEffect(() => {
    if (editItem && existingSlotIds.length > 0) {
      setForm((f) => ({ ...f, slot_ids: existingSlotIds }));
    }
  }, [editItem, existingSlotIds.join(',')]);

  function toggleSlot(slotId: string) {
    setForm((f) => ({
      ...f,
      slot_ids: f.slot_ids.includes(slotId)
        ? f.slot_ids.filter((s) => s !== slotId)
        : [...f.slot_ids, slotId],
    }));
  }

  function handleSave() {
    const payload = {
      canteen: selectedLocation,
      category: form.category,
      name: form.name,
      description: form.description,
      item_type: form.item_type,
      price: parseFloat(form.price) || 0,
      employee_price: form.employee_price ? parseFloat(form.employee_price) : null,
      is_available: form.is_available,
      is_featured: form.is_featured,
      calories: form.calories ? parseInt(form.calories) : null,
      preparation_time_minutes: parseInt(form.preparation_time_minutes) || 5,
      daily_quota: form.daily_quota ? parseInt(form.daily_quota) : null,
    };
    if (editItem) {
      updateItem.mutate({ id: editItem.id, ...payload }, {
        onSuccess: () => {
          if (form.slot_ids.length > 0) {
            assignToSlots.mutate({ itemId: editItem.id, slotIds: form.slot_ids });
          }
          setShowAddItem(false);
        },
      });
    } else {
      createItem.mutate(payload, {
        onSuccess: (newItem) => {
          if (form.slot_ids.length > 0 && newItem?.id) {
            assignToSlots.mutate({ itemId: newItem.id, slotIds: form.slot_ids });
          }
          setShowAddItem(false);
        },
      });
    }
  }

  // ── Add category form ─────────────────────────
  const [catName, setCatName] = useState('');

  function handleAddCategory() {
    if (!catName.trim()) return;
    createCategory.mutate(
      { canteen: selectedLocation, name: catName.trim() },
      { onSuccess: () => { setCatName(''); setShowAddCategory(false); } },
    );
  }

  const inputCls = 'w-full rounded-xl border border-surface-300/70 bg-surface-0 px-3 py-2 text-sm text-surface-900 placeholder-surface-400 focus:border-brand-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder-white/30';

  if (!locations.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ChefHat className="h-10 w-10 text-surface-300 dark:text-white/20" />
        <p className="mt-3 text-sm text-surface-500 dark:text-white/40">No canteen locations configured yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Location switcher */}
      {locations.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {locations.map((loc) => (
            <button key={loc.id} onClick={() => setSelectedLocation(loc.id)}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                selectedLocation === loc.id
                  ? 'bg-surface-900 text-white dark:bg-white dark:text-surface-900'
                  : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-white/5 dark:text-white/60')}>
              {loc.name}
            </button>
          ))}
        </div>
      )}

      {/* Categories section */}
      <div className="rounded-2xl border border-surface-200/70 bg-surface-0 p-4 shadow-xs dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
            <Tag className="h-4 w-4 text-brand-500" /> Categories
          </h3>
          <button onClick={() => setShowAddCategory(!showAddCategory)}
            className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400">
            <Plus className="h-3.5 w-3.5" /> Add Category
          </button>
        </div>

        {showAddCategory && (
          <div className="mb-3 flex gap-2">
            <input type="text" placeholder="Category name" value={catName} onChange={(e) => setCatName(e.target.value)}
              className={cn(inputCls, 'flex-1')} />
            <button onClick={handleAddCategory} disabled={createCategory.isPending}
              className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {createCategory.isPending ? '…' : 'Save'}
            </button>
            <button onClick={() => setShowAddCategory(false)}
              className="rounded-xl border border-surface-200 px-3 py-2 text-xs text-surface-600 dark:border-white/10 dark:text-white/50">
              Cancel
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center gap-1.5 rounded-lg border border-surface-200 bg-surface-50 px-2.5 py-1 dark:border-white/10 dark:bg-white/5">
              <span className="text-xs font-medium text-surface-700 dark:text-white/70">{cat.name}</span>
              {confirmCatDelete === cat.id ? (
                <>
                  <button onClick={() => { deleteCategory.mutate(cat.id); setConfirmCatDelete(null); }}
                    className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
                  <button onClick={() => setConfirmCatDelete(null)}
                    className="rounded px-1.5 py-0.5 text-xs text-surface-400">Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirmCatDelete(cat.id)}
                  className="text-surface-300 hover:text-red-500 dark:text-white/20 dark:hover:text-red-400">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {categories.length === 0 && <p className="text-xs text-surface-400 dark:text-white/30">No categories yet</p>}
        </div>
      </div>

      {/* Menu items section */}
      <div className="rounded-2xl border border-surface-200/70 bg-surface-0 p-4 shadow-xs dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
            <ChefHat className="h-4 w-4 text-brand-500" /> Menu Items
            <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs text-surface-500 dark:bg-white/10 dark:text-white/40">{items.length}</span>
          </h3>
          <button onClick={openAdd}
            className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-900/20 dark:text-brand-400">
            <Plus className="h-3.5 w-3.5" /> Add Item
          </button>
        </div>

        {/* Add/Edit form */}
        <AnimatePresence>
          {showAddItem && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 overflow-hidden rounded-2xl border border-brand-200 bg-brand-50/30 p-4 dark:border-brand-800/40 dark:bg-brand-900/10"
            >
              <h4 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">
                {editItem ? 'Edit Item' : 'Add New Item'}
              </h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input type="text" placeholder="Item name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
                <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={inputCls}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={form.item_type} onChange={(e) => setForm((f) => ({ ...f, item_type: e.target.value as 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN' }))} className={inputCls}>
                  <option value="VEG">Veg</option>
                  <option value="NON_VEG">Non-Veg</option>
                  <option value="EGG">Egg</option>
                  <option value="VEGAN">Vegan</option>
                </select>
                <input type="number" placeholder="Price (₹) *" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className={inputCls} min="0" step="0.5" />
                <input type="number" placeholder="Employee price (₹, optional)" value={form.employee_price} onChange={(e) => setForm((f) => ({ ...f, employee_price: e.target.value }))} className={inputCls} min="0" step="0.5" />
                <input type="number" placeholder="Calories (optional)" value={form.calories} onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value }))} className={inputCls} min="0" />
                <input type="number" placeholder="Prep time (min)" value={form.preparation_time_minutes} onChange={(e) => setForm((f) => ({ ...f, preparation_time_minutes: e.target.value }))} className={inputCls} min="1" />
                <input type="number" placeholder="Daily quota (optional)" value={form.daily_quota} onChange={(e) => setForm((f) => ({ ...f, daily_quota: e.target.value }))} className={inputCls} min="0" />
                <input type="text" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={cn(inputCls, 'sm:col-span-2')} />
                <div className="flex items-center gap-4 sm:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-surface-700 dark:text-white/60">
                    <input type="checkbox" checked={form.is_available} onChange={(e) => setForm((f) => ({ ...f, is_available: e.target.checked }))} className="h-4 w-4 rounded" />
                    Available
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-surface-700 dark:text-white/60">
                    <input type="checkbox" checked={form.is_featured} onChange={(e) => setForm((f) => ({ ...f, is_featured: e.target.checked }))} className="h-4 w-4 rounded" />
                    Featured
                  </label>
                </div>
                {/* Time-slot assignment */}
                {allSlots.length > 0 && (
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-xs font-semibold text-surface-700 dark:text-white/70">
                      <Clock3 className="mb-0.5 mr-1 inline h-3.5 w-3.5" />
                      Assign to Time Slots
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {allSlots.map((slot) => {
                        const active = form.slot_ids.includes(slot.id);
                        return (
                          <button key={slot.id} type="button" onClick={() => toggleSlot(slot.id)}
                            className={cn(
                              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                              active
                                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-300'
                                : 'border-surface-200 bg-surface-50 text-surface-600 hover:border-brand-300 dark:border-white/10 dark:bg-white/5 dark:text-white/50',
                            )}>
                            {slot.name}
                            <span className="ml-1 opacity-60">{slot.start_time}–{slot.end_time}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setShowAddItem(false)}
                  className="rounded-xl border border-surface-200 px-4 py-2 text-sm text-surface-600 dark:border-white/10 dark:text-white/50">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={!form.name || !form.price || createItem.isPending || updateItem.isPending}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {(createItem.isPending || updateItem.isPending) ? 'Saving…' : (editItem ? 'Update' : 'Add Item')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Items list */}
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-surface-400 dark:text-white/30">No menu items yet. Add one above.</p>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-white/5">
            {items.map((item) => {
              const typeInfo = ITEM_TYPE_LABELS[item.item_type ?? ''] ?? { label: item.item_type ?? '', color: 'bg-gray-100 text-gray-600' };
              return (
                <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-surface-900 dark:text-white">{item.name}</p>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', typeInfo.color)}>{typeInfo.label}</span>
                      {!item.is_available && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-white/10 dark:text-white/40">Unavailable</span>}
                      {item.is_featured && <Star className="h-3.5 w-3.5 text-amber-400" />}
                    </div>
                    <p className="mt-0.5 text-xs text-surface-500 dark:text-white/40">
                      ₹{Number(item.price).toFixed(2)}
                      {item.employee_price != null && ` · Employee ₹${Number(item.employee_price).toFixed(2)}`}
                      {item.calories != null && ` · ${item.calories} kcal`}
                      {` · ~${item.preparation_time_minutes}min`}
                    </p>
                    {/* Slot assignment badges */}
                    <ItemSlotBadges itemId={item.id} allSlots={allSlots} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => openEdit(item)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-white/10 dark:hover:text-white/80">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    {confirmDelete === item.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => { deleteItem.mutate(item.id); setConfirmDelete(null); }}
                          className="rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700">Delete</button>
                        <button onClick={() => setConfirmDelete(null)}
                          className="rounded-lg border border-surface-200 px-2 py-1 text-xs text-surface-600 dark:border-white/10 dark:text-white/50">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(item.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CMS: ESS Quick Order (new flow) ─────────────

function CmsEssOrderView() {
  const username = useUIStore((s) => s.username);
  const { selectedSlot, setSelectedSlot, cart, addToCart,
    updateQuantity, clearCart, cartTotal, setActiveView, setActiveOrder } = useCanteenStore();
  const placeOrder = useCmsPlaceOrder();
  const { data: wallet } = useMyWallet();

  const { data: slotsRaw, isLoading: slotsLoading } = useAvailableSlots();
  const slots: TimeSlot[] = slotsRaw ?? [];
  const { data: menuItems = [], isLoading: menuLoading } = useSlotMenu(selectedSlot?.id ?? null);
  const { data: orderingRules = [] } = useOrderingRules(selectedSlot?.canteen);
  const activeRule = orderingRules[0] ?? null;

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showMobileCart, setShowMobileCart] = useState(false);

  function handlePlaceOrder() {
    if (!selectedSlot || cart.length === 0) return;
    placeOrder.mutate(
      { slot_id: selectedSlot.id, items: cart.map((c) => ({ menu_item_id: c.menuItemId, quantity: c.quantity })) },
      { onSuccess: (order) => { clearCart(); setActiveOrder(order); setActiveView('order-confirmation'); } },
    );
  }

  const categories = useMemo(() => {
    const catMap = new Map<string, string>();
    menuItems.forEach(item => { if (item.category) catMap.set(item.category, item.category_name || item.category); });
    return Array.from(catMap.entries()).map(([id, name]) => ({ id, name }));
  }, [menuItems]);

  const filteredMenu = useMemo(() => {
    if (selectedCategory === 'all') return menuItems;
    return menuItems.filter(item => item.category === selectedCategory);
  }, [menuItems, selectedCategory]);

  useEffect(() => { setSelectedCategory('all'); }, [selectedSlot?.id]);

  const slotConfig = (slot: TimeSlot) => {
    const n = slot.name.toLowerCase();
    if (n.includes('breakfast')) return { emoji: '🍳', from: 'from-amber-400', to: 'to-orange-500', bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', darkBg: 'dark:bg-amber-900/20' };
    if (n.includes('lunch')) return { emoji: '🍱', from: 'from-blue-400', to: 'to-indigo-500', bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-800', darkBg: 'dark:bg-blue-900/20' };
    if (n.includes('tea') || n.includes('evening')) return { emoji: '☕', from: 'from-purple-400', to: 'to-violet-500', bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-800', darkBg: 'dark:bg-purple-900/20' };
    return { emoji: '🥗', from: 'from-green-400', to: 'to-emerald-500', bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800', darkBg: 'dark:bg-green-900/20' };
  };

  const typeColors: Record<string, { dot: string; label: string; badgeBg: string; badgeText: string }> = {
    VEG: { dot: 'bg-green-500', label: 'Veg', badgeBg: 'bg-green-50', badgeText: 'text-green-700' },
    NON_VEG: { dot: 'bg-red-500', label: 'Non-Veg', badgeBg: 'bg-red-50', badgeText: 'text-red-700' },
    EGG: { dot: 'bg-yellow-500', label: 'Egg', badgeBg: 'bg-yellow-50', badgeText: 'text-yellow-700' },
    VEGAN: { dot: 'bg-emerald-500', label: 'Vegan', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-700' },
  };

  const greeting = () => { const h = new Date().getHours(); if (h < 12) return 'Good morning'; if (h < 17) return 'Good afternoon'; return 'Good evening'; };
  const cartItemCount = cart.reduce((s, c) => s + c.quantity, 0);

  if (slotsLoading) {
    return <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-100 dark:bg-white/5" />)}</div>;
  }

  return (
    <div className="flex flex-col min-h-0">
      {/* Welcome banner */}
      <div className="px-5 py-4 bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-700 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-white/60">{greeting()},</p>
            <h2 className="text-base font-bold capitalize">{username}</h2>
            <p className="text-xs text-white/50 mt-0.5">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          {wallet && (
            <div className="rounded-2xl bg-white/20 px-4 py-2.5 text-center backdrop-blur-sm border border-white/10">
              <p className="text-xs font-medium text-white/60">Wallet</p>
              <p className="text-xl font-black">₹{Number(wallet.balance).toFixed(0)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Slot selector */}
      <div className="px-4 pt-4 pb-2">
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-surface-400 dark:text-white/30">Today's Meal Slots</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {slots.map((slot) => {
            const cfg = slotConfig(slot);
            const isSelected = selectedSlot?.id === slot.id;
            const fillPct = slot.max_orders ? Math.min(100, Math.round(((slot.current_order_count ?? 0) / slot.max_orders) * 100)) : 0;
            return (
              <motion.button
                key={slot.id}
                whileHover={{ scale: slot.is_ordering_open ? 1.02 : 1 }}
                whileTap={{ scale: slot.is_ordering_open ? 0.97 : 1 }}
                onClick={() => { setSelectedSlot(slot); clearCart(); setSelectedCategory('all'); }}
                className={cn(
                  'relative overflow-hidden rounded-2xl border-2 p-4 text-left transition-all duration-200',
                  isSelected ? `${cfg.border} ${cfg.bg} ${cfg.darkBg} shadow-md` : 'border-surface-200/60 bg-white hover:border-surface-300 dark:border-white/10 dark:bg-white/5',
                  !slot.is_ordering_open && !isSelected && 'opacity-55',
                )}
              >
                <div className={cn('absolute top-0 left-0 right-0 h-1 bg-gradient-to-r', cfg.from, cfg.to)} />
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">{cfg.emoji}</span>
                    <div>
                      <p className={cn('font-bold text-sm', isSelected ? cfg.text : 'text-surface-900 dark:text-white')}>{slot.name}</p>
                      <p className="text-xs text-surface-500 dark:text-white/40">{slot.start_time.slice(0,5)} – {slot.end_time.slice(0,5)}</p>
                    </div>
                  </div>
                  {slot.is_ordering_open ? (
                    <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/20 dark:text-green-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />Open
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-white/5 dark:text-white/30">Closed</span>
                  )}
                </div>
                {slot.is_ordering_open && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-surface-500 dark:text-white/40">{slot.current_order_count ?? 0}/{slot.max_orders ?? '∞'} orders</span>
                      <DeadlineCountdown deadline={slot.ordering_deadline_time} showIcon className="text-xs" />
                    </div>
                    {slot.max_orders && (
                      <div className="h-1.5 rounded-full bg-surface-100 dark:bg-white/10 overflow-hidden">
                        <motion.div
                          className={cn('h-full rounded-full bg-gradient-to-r', cfg.from, cfg.to)}
                          initial={{ width: 0 }}
                          animate={{ width: `${fillPct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </motion.button>
            );
          })}
          {slots.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-200 py-12 dark:border-white/10">
              <span className="text-4xl">🍽️</span>
              <p className="mt-2 text-sm text-surface-500 dark:text-white/40">No meal slots available today.</p>
            </div>
          )}
        </div>
      </div>

      {/* Menu + Cart split layout */}
      {selectedSlot && (
        <div className="flex flex-1 gap-4 px-4 pb-24 pt-3 lg:pb-6">
          {/* Left: Menu */}
          <div className="flex-1 min-w-0">
            {/* Policy banner */}
            {activeRule && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50/80 px-3 py-2.5 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20">
                <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300"><Clock3 className="h-3 w-3" /> {activeRule.order_buffer_minutes}min buffer</span>
                <span className="text-blue-200">·</span>
                <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300"><Info className="h-3 w-3" /> Max {activeRule.max_quantity_per_item} items</span>
                <span className="text-blue-200">·</span>
                <span className="flex items-center gap-1 text-xs font-semibold text-blue-700 dark:text-blue-300"><Ban className="h-3 w-3" /> Cancel {activeRule.cancellation_window_minutes}min</span>
                {activeRule.require_admin_approval && (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"><AlertCircle className="h-3 w-3" /> Needs approval</span>
                )}
              </div>
            )}

            {/* Category filter */}
            {categories.length > 1 && (
              <div className="mb-3 flex overflow-x-auto border-b border-surface-200 dark:border-white/10">
                {categories.map((cat, idx) => {
                  const isActive = selectedCategory === cat.id || (selectedCategory === 'all' && idx === 0);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={cn(
                        'shrink-0 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
                        isActive
                          ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                          : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-white/40 dark:hover:text-white/60',
                      )}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Menu items */}
            {menuLoading ? (
              <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface-100 dark:bg-white/5" />)}</div>
            ) : filteredMenu.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-200 py-10 dark:border-white/10">
                <span className="text-3xl">🥗</span>
                <p className="mt-2 text-sm text-surface-400 dark:text-white/30">No items in this category.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredMenu.map((item) => {
                  const inCart = cart.find((c) => c.menuItemId === item.id);
                  const qty = inCart?.quantity ?? 0;
                  const maxQty = activeRule?.max_quantity_per_item ?? 99;
                  const atMax = qty >= maxQty;
                  const tc = typeColors[item.item_type ?? 'VEG'] ?? typeColors.VEG;
                  return (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl border p-3.5 transition-all duration-150',
                        qty > 0 ? 'border-brand-200 bg-brand-50/50 dark:border-brand-700/30 dark:bg-brand-900/10' : 'border-surface-100 bg-white hover:border-surface-200 hover:shadow-sm dark:border-white/5 dark:bg-white/5',
                      )}
                    >
                      {/* Diet indicator dot */}
                      <div className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 self-start rounded-sm border-2 border-white shadow-sm', tc.dot)} title={tc.label} />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-sm text-surface-900 dark:text-white leading-tight">{item.name}</p>
                          {item.is_featured && <Star className="h-3 w-3 text-amber-400 shrink-0" fill="currentColor" />}
                          <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-medium', tc.badgeBg, tc.badgeText)}>{tc.label}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {item.calories != null && (
                            <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs text-surface-500 dark:bg-white/10 dark:text-white/40">🔥 {item.calories} kcal</span>
                          )}
                          {item.preparation_time_minutes != null && (
                            <span className="rounded-full bg-surface-100 px-2 py-0.5 text-xs text-surface-500 dark:bg-white/10 dark:text-white/40">⏱ {item.preparation_time_minutes}m</span>
                          )}
                          {(item.company_subsidy_per_item ?? 0) > 0 && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">₹{item.company_subsidy_per_item} subsidy</span>
                          )}
                        </div>
                      </div>

                      {/* Price + stepper */}
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <div className="text-right">
                          <p className="font-bold text-sm text-surface-900 dark:text-white">₹{Number(item.effective_price).toFixed(0)}</p>
                          {item.price !== item.effective_price && (
                            <p className="text-xs line-through text-surface-400 dark:text-white/30">₹{Number(item.price).toFixed(0)}</p>
                          )}
                        </div>
                        {qty > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => updateQuantity(item.id, qty - 1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-surface-200 bg-white text-surface-700 shadow-sm hover:bg-surface-50 dark:border-white/10 dark:bg-white/10 dark:text-white">
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-5 text-center text-sm font-bold text-surface-900 dark:text-white">{qty}</span>
                            <button onClick={() => updateQuantity(item.id, qty + 1)} disabled={atMax} className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:opacity-40">
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => addToCart({ menuItemId: item.id, name: item.name, unitPrice: Number(item.effective_price ?? 0), itemType: item.item_type ?? 'VEG' })}
                            className="flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 active:scale-95 transition-transform"
                          >
                            <Plus className="h-3 w-3" /> Add
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Cart panel (desktop) */}
          <div className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-4 rounded-2xl border border-surface-200/70 bg-white p-4 shadow-lg dark:border-white/10 dark:bg-surface-900">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-surface-900 dark:text-white">
                  <ShoppingCart className="h-4 w-4 text-brand-500" />
                  Your Order
                </h3>
                {cart.length > 0 && <button onClick={clearCart} className="text-xs text-surface-400 hover:text-danger-500">Clear all</button>}
              </div>
              {/* Slot pill */}
              <div className={cn('mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', slotConfig(selectedSlot).bg, slotConfig(selectedSlot).text)}>
                <span>{slotConfig(selectedSlot).emoji}</span> {selectedSlot.name}
              </div>
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <ShoppingCart className="h-10 w-10 text-surface-300 dark:text-white/20" />
                  <p className="mt-2 text-sm text-surface-500 dark:text-white/40">Add items to get started</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {cart.map((item) => (
                      <div key={item.menuItemId} className="flex items-center justify-between text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-surface-900 dark:text-white">{item.name}</p>
                          <p className="text-xs text-surface-500 dark:text-white/40">×{item.quantity} · ₹{(item.unitPrice * item.quantity).toFixed(2)}</p>
                        </div>
                        <button onClick={() => updateQuantity(item.menuItemId, 0)} className="ml-2 shrink-0 text-surface-300 hover:text-danger-500 dark:text-white/20">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 border-t border-surface-100 pt-3 dark:border-white/10">
                    <div className="flex justify-between">
                      <span className="text-sm text-surface-600 dark:text-white/60">{cartItemCount} items</span>
                      <span className="text-base font-bold text-surface-900 dark:text-white">₹{cartTotal().toFixed(2)}</span>
                    </div>
                    {wallet && <p className="mt-1 text-xs text-surface-400 dark:text-white/30">Balance after: ₹{(Number(wallet.balance) - cartTotal()).toFixed(2)}</p>}
                  </div>
                  <button
                    onClick={handlePlaceOrder}
                    disabled={placeOrder.isPending}
                    className="mt-3 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 active:scale-[0.98] transition-all"
                  >
                    {placeOrder.isPending ? 'Placing…' : `Place Order · ₹${cartTotal().toFixed(2)}`}
                  </button>
                  {placeOrder.isError && (
                    <p className="mt-1 text-center text-xs text-danger-500">{(placeOrder.error as Error)?.message}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile cart FAB */}
      <AnimatePresence>
        {cart.length > 0 && !showMobileCart && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-20 left-4 right-4 z-40 lg:hidden"
          >
            <button
              onClick={() => setShowMobileCart(true)}
              className="flex w-full items-center justify-between rounded-2xl bg-brand-600 px-4 py-3 text-white shadow-2xl"
            >
              <span className="flex items-center gap-2 font-semibold">
                <ShoppingCart className="h-4 w-4" />
                {cartItemCount} item{cartItemCount !== 1 ? 's' : ''} in cart
              </span>
              <span className="font-bold">₹{cartTotal().toFixed(2)} →</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile cart drawer */}
      <AnimatePresence>
        {showMobileCart && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }}
              onClick={() => setShowMobileCart(false)}
              className="fixed inset-0 z-40 bg-black lg:hidden"
            />
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-surface-900 lg:hidden"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-surface-900 dark:text-white">Your Order — {selectedSlot?.name}</h3>
                <button onClick={() => setShowMobileCart(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-100 dark:bg-white/10">
                  <X className="h-4 w-4 text-surface-600 dark:text-white/60" />
                </button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {cart.map((item) => (
                  <div key={item.menuItemId} className="flex items-center justify-between">
                    <p className="text-sm text-surface-900 dark:text-white">{item.name} ×{item.quantity}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">₹{(item.unitPrice * item.quantity).toFixed(2)}</span>
                      <button onClick={() => updateQuantity(item.menuItemId, 0)} className="text-surface-400 hover:text-danger-500"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 border-t border-surface-100 pt-3 dark:border-white/10">
                <div className="flex justify-between">
                  <span className="text-sm text-surface-600 dark:text-white/60">Total</span>
                  <span className="text-lg font-bold text-surface-900 dark:text-white">₹{cartTotal().toFixed(2)}</span>
                </div>
              </div>
              <button
                onClick={() => { handlePlaceOrder(); setShowMobileCart(false); }}
                disabled={placeOrder.isPending}
                className="mt-4 w-full rounded-2xl bg-brand-600 py-3 text-base font-bold text-white disabled:opacity-50"
              >
                {placeOrder.isPending ? 'Placing…' : 'Place Order →'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

const CMS_ORDER_STATUS_STEPS = [
  { key: 'PENDING', label: 'Placed', emoji: '📋' },
  { key: 'ACCEPTED', label: 'Confirmed', emoji: '✅' },
  { key: 'PREPARING', label: 'Preparing', emoji: '👨‍🍳' },
  { key: 'PREPARED', label: 'Ready', emoji: '🔔' },
  { key: 'COLLECTED', label: 'Collected', emoji: '🎉' },
];

function getCmsStepIndex(status: string) {
  return CMS_ORDER_STATUS_STEPS.findIndex((step) => step.key === status);
}

// ─── CMS: Order Confirmation ─────────────────────

function CmsOrderConfirmation() {
  const { activeOrder, setActiveView, setActiveOrder } = useCanteenStore();
  const cancelOrder = useCmsCancelOrder();

  if (!activeOrder) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-surface-500">No active order.</p>
        <button onClick={() => setActiveView('dashboard')} className="mt-2 text-xs text-brand-600 hover:underline">Back to dashboard</button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center py-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h2 className="text-lg font-bold text-surface-900 dark:text-white">Order Placed!</h2>
        <p className="text-sm text-surface-500 dark:text-white/40 mt-1">Your order has been received.</p>
      </motion.div>

      {/* Order code */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-white/30">Your Order Code</p>
        <OrderCodeDisplay code={activeOrder.order_code} showQr size="lg" />
      </div>

      {/* Status + details */}
      <GlassCard className="!p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-surface-700 dark:text-white/70">Status</span>
          <OrderStatusBadge status={activeOrder.status} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-surface-700 dark:text-white/70">Slot</span>
          <span className="text-sm font-medium text-surface-900 dark:text-white">{activeOrder.slot_name}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-surface-700 dark:text-white/70">Total</span>
          <span className="text-sm font-bold text-surface-900 dark:text-white">₹{Number(activeOrder.total_amount).toFixed(2)}</span>
        </div>
      </GlassCard>

      <div className="rounded-2xl border border-surface-200 bg-surface-50 p-4 dark:border-white/10 dark:bg-white/5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-surface-700 dark:text-white/70">Order tracking</span>
          <span className="text-xs uppercase tracking-[0.24em] text-surface-500 dark:text-white/40">
            {CMS_ORDER_STATUS_STEPS[getCmsStepIndex(activeOrder.status)]?.label ?? 'Pending'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {CMS_ORDER_STATUS_STEPS.map((step, index) => {
            const currentStep = getCmsStepIndex(activeOrder.status);
            const isCurrent = index === currentStep;
            const isPast = index < currentStep;
            return (
              <div key={step.key} className="flex flex-1 items-center gap-1">
                <div className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm transition-all',
                  isPast
                    ? 'bg-brand-600 text-white'
                    : isCurrent
                      ? 'bg-brand-100 ring-2 ring-brand-500 text-brand-700 dark:bg-brand-900/30'
                      : 'bg-surface-100 text-surface-400 dark:bg-white/10 dark:text-white/30',
                )}>
                  {isPast ? '✓' : step.emoji}
                </div>
                {index < CMS_ORDER_STATUS_STEPS.length - 1 && (
                  <div className={cn('h-0.5 flex-1', isPast ? 'bg-brand-600' : 'bg-surface-100 dark:bg-white/10')} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Items */}
      <div className="space-y-1.5">
        {activeOrder.order_items.map((item) => (
          <div key={item.id} className="flex justify-between text-sm">
            <span className="text-surface-700 dark:text-white/70">{item.item_name_snapshot} ×{item.quantity}</span>
            <span className="font-medium text-surface-900 dark:text-white">₹{Number(item.line_total).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {activeOrder.can_cancel && (
          <button
            onClick={() => cancelOrder.mutate({ orderId: activeOrder.id }, { onSuccess: (o) => setActiveOrder(o) })}
            disabled={cancelOrder.isPending}
            className="flex-1 rounded-xl border border-danger-200 py-2 text-sm text-danger-600 hover:bg-danger-50 dark:border-danger-800/50 dark:text-danger-400 disabled:opacity-50"
          >
            Cancel Order
          </button>
        )}
        <button
          onClick={() => { setActiveOrder(null); setActiveView('dashboard'); }}
          className="flex-1 rounded-xl bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── CMS: Order History (new) ─────────────────────

function CmsOrderHistory() {
  const { data: orders = [], isLoading } = useCmsOrderHistory();
  const cancelOrder = useCmsCancelOrder();

  const totalSpent = orders.filter(o => o.status !== 'CANCELLED').reduce((s, o) => s + parseFloat(o.total_amount || '0'), 0);
  const activeOrders = orders.filter(o => ['PENDING', 'ACCEPTED', 'PREPARING', 'PREPARED'].includes(o.status));
  const cancelledCount = orders.filter(o => o.status === 'CANCELLED').length;

  const STATUS_STEPS = [
    { key: 'PENDING', label: 'Placed', emoji: '📋' },
    { key: 'ACCEPTED', label: 'Confirmed', emoji: '✅' },
    { key: 'PREPARING', label: 'Preparing', emoji: '👨‍🍳' },
    { key: 'PREPARED', label: 'Ready', emoji: '🔔' },
    { key: 'COLLECTED', label: 'Collected', emoji: '🎉' },
  ];

  const stepIdx = (status: string) => STATUS_STEPS.findIndex(s => s.key === status);

  if (isLoading) {
    return <div className="p-4 space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface-100 dark:bg-white/5" />)}</div>;
  }

  return (
    <div className="flex flex-col">
      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 border-b border-surface-100 p-4 dark:border-white/5">
        <div className="rounded-xl bg-blue-50 p-3 text-center dark:bg-blue-900/10">
          <p className="text-xl font-black text-blue-700 dark:text-blue-300">{orders.length}</p>
          <p className="text-xs text-blue-600/70 dark:text-blue-400/60">Total Orders</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-center dark:bg-emerald-900/10">
          <p className="text-xl font-black text-emerald-700 dark:text-emerald-300">₹{totalSpent.toFixed(0)}</p>
          <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60">Total Spent</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-3 text-center dark:bg-amber-900/10">
          <p className="text-xl font-black text-amber-700 dark:text-amber-300">{cancelledCount}</p>
          <p className="text-xs text-amber-600/70 dark:text-amber-400/60">Cancelled</p>
        </div>
      </div>

      {/* Active order progress tracker */}
      {activeOrders.map(activeOrder => (
        <div key={activeOrder.id} className="mx-4 mt-4 rounded-2xl border-2 border-brand-200 bg-brand-50/50 p-4 dark:border-brand-700/30 dark:bg-brand-900/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
              </span>
              <span className="text-xs font-bold text-brand-700 dark:text-brand-300">Active Order</span>
            </div>
            <span className="font-mono text-xs font-bold text-surface-700 dark:text-white/60">{activeOrder.order_code}</span>
          </div>
          <div className="flex items-center justify-between gap-1">
            {STATUS_STEPS.map((step, i) => {
              const current = stepIdx(activeOrder.status);
              const isCurrent = i === current;
              const isPast = i < current;
              return (
                <div key={step.key} className="flex flex-1 items-center gap-1">
                  <div className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm transition-all',
                    isPast ? 'bg-brand-600 text-white' : isCurrent ? 'bg-brand-100 ring-2 ring-brand-500 text-brand-700 dark:bg-brand-900/30' : 'bg-surface-100 text-surface-400 dark:bg-white/10 dark:text-white/30',
                  )}>
                    {isPast ? '✓' : step.emoji}
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className={cn('h-0.5 flex-1', isPast ? 'bg-brand-600' : 'bg-surface-100 dark:bg-white/10')} />
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 text-center text-xs text-surface-500 dark:text-white/40">
            {activeOrder.slot_name} · ₹{Number(activeOrder.total_amount).toFixed(2)}
          </p>
        </div>
      ))}

      {/* Order list */}
      <div className="space-y-3 p-4">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-5xl">🍽️</span>
            <p className="mt-3 text-sm font-medium text-surface-700 dark:text-white/60">No orders yet</p>
            <p className="text-xs text-surface-400 dark:text-white/30">Place your first order!</p>
          </div>
        ) : (
          orders.map((order) => (
            <GlassCard key={order.id} noPadding hoverable className="!p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-surface-900 dark:text-white">{order.order_code}</span>
                    <OrderStatusBadge status={order.status} size="xs" />
                  </div>
                  <p className="mt-1 text-xs text-surface-500 dark:text-white/40">
                    {order.slot_name} · {new Date(order.order_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {order.order_items.map((item) => (
                      <span key={item.id} className="rounded-lg bg-surface-50 px-2 py-0.5 text-xs text-surface-600 dark:bg-white/5 dark:text-white/50 border border-surface-100 dark:border-white/10">
                        {item.item_name_snapshot} ×{item.quantity}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-bold text-surface-900 dark:text-white">₹{Number(order.total_amount).toFixed(2)}</p>
                  {order.can_cancel && (
                    <button
                      onClick={() => cancelOrder.mutate({ orderId: order.id })}
                      disabled={cancelOrder.isPending}
                      className="mt-1 text-xs text-danger-600 hover:underline dark:text-danger-400 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </GlassCard>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Admin: Dashboard ──────────────────────────────────────────────────────

function AdminDashboard() {
  const today = new Date().toISOString().split('T')[0];
  const { data: orders = [], isLoading } = useAdminOrders({ date: today });
  const { data: locations = [] } = useCmsLocations();
  const { data: timeSlots = [] } = useAdminTimeSlots();

  const byStatus = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  const totalRevenue = orders
    .filter((o) => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + parseFloat(o.total_amount || '0'), 0);

  const activeCount = (byStatus['ACCEPTED'] ?? 0) + (byStatus['PREPARING'] ?? 0) + (byStatus['PREPARED'] ?? 0);

  const pipeline = [
    { status: 'PENDING', label: 'Pending', count: byStatus['PENDING'] ?? 0, barColor: 'bg-gray-400', textColor: 'text-gray-700 dark:text-gray-300' },
    { status: 'ACCEPTED', label: 'Accepted', count: byStatus['ACCEPTED'] ?? 0, barColor: 'bg-blue-500', textColor: 'text-blue-700 dark:text-blue-300' },
    { status: 'PREPARING', label: 'Preparing', count: byStatus['PREPARING'] ?? 0, barColor: 'bg-amber-500', textColor: 'text-amber-700 dark:text-amber-300' },
    { status: 'PREPARED', label: 'Ready', count: byStatus['PREPARED'] ?? 0, barColor: 'bg-emerald-500', textColor: 'text-emerald-700 dark:text-emerald-300' },
    { status: 'COLLECTED', label: 'Collected', count: byStatus['COLLECTED'] ?? 0, barColor: 'bg-green-600', textColor: 'text-green-700 dark:text-green-300' },
    { status: 'CANCELLED', label: 'Cancelled', count: byStatus['CANCELLED'] ?? 0, barColor: 'bg-red-500', textColor: 'text-red-700 dark:text-red-300' },
  ];

  const topStats = [
    { icon: ShoppingBag, label: "Today's Orders", value: orders.length, sub: `${byStatus['PENDING'] ?? 0} pending`, iconBg: 'bg-blue-100 dark:bg-blue-900/20', iconColor: 'text-blue-600 dark:text-blue-300' },
    // { icon: BadgeIndianRupee, label: "Today's Revenue", value: `₹${totalRevenue.toFixed(0)}`, sub: `${orders.filter(o => o.status !== 'CANCELLED').length} paid orders`, iconBg: 'bg-emerald-100 dark:bg-emerald-900/20', iconColor: 'text-emerald-600 dark:text-emerald-300' },
    { icon: Flame, label: 'Active in Kitchen', value: activeCount, sub: 'being processed', iconBg: 'bg-orange-100 dark:bg-orange-900/20', iconColor: 'text-orange-600 dark:text-orange-300' },
    { icon: MapPin, label: 'Locations', value: locations.filter(l => l.is_active).length, sub: `${timeSlots.filter(s => s.is_active).length} time slots active`, iconBg: 'bg-purple-100 dark:bg-purple-900/20', iconColor: 'text-purple-600 dark:text-purple-300' },
  ];

  if (isLoading) return (
    <div className="p-6 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-100 dark:bg-white/5" />)}
      </div>
    </div>
  );

  return (
    <div className="p-5 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-surface-900 dark:text-white">Dashboard</h2>
        <p className="text-sm text-surface-500 dark:text-white/40 mt-0.5">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {topStats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="rounded-2xl bg-white border border-surface-100 dark:border-white/5 dark:bg-white/5 p-4 shadow-sm"
            >
              <div className={cn('mb-3 flex h-9 w-9 items-center justify-center rounded-xl', stat.iconBg)}>
                <Icon className={cn('h-5 w-5', stat.iconColor)} strokeWidth={2} />
              </div>
              <p className="text-2xl font-black text-surface-900 dark:text-white">{stat.value}</p>
              <p className="text-xs font-semibold text-surface-600 dark:text-white/60 mt-0.5">{stat.label}</p>
              <p className="text-xs text-surface-400 dark:text-white/30 mt-0.5">{stat.sub}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Order Pipeline Bar Chart */}
      <div className="rounded-2xl border border-surface-200/70 bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <h3 className="mb-5 flex items-center gap-2 text-sm font-bold text-surface-900 dark:text-white">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/20">
            <UtensilsCrossed className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
          </span>
          Order Pipeline
        </h3>
        <div className="flex items-end gap-2" style={{ height: 120 }}>
          {pipeline.map((p, i) => {
            const maxCount = Math.max(...pipeline.map(x => x.count), 1);
            const heightPct = p.count > 0 ? Math.max(14, Math.round((p.count / maxCount) * 100)) : 5;
            return (
              <div key={p.status} className="flex flex-1 flex-col items-center justify-end gap-1.5" style={{ height: '100%' }}>
                <span className={cn('text-sm font-black', p.textColor)}>{p.count > 0 ? p.count : ''}</span>
                <motion.div
                  className={cn('w-full rounded-t-xl opacity-85', p.barColor)}
                  initial={{ height: 0 }}
                  animate={{ height: `${heightPct}%` }}
                  transition={{ duration: 0.7, delay: i * 0.07, ease: 'easeOut' }}
                />
                <span className="text-center text-xs font-medium leading-tight text-surface-500 dark:text-white/40">{p.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Orders table */}
      <div className="rounded-2xl border border-surface-200/70 bg-white overflow-hidden dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between border-b border-surface-100 px-5 py-3.5 dark:border-white/5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-surface-900 dark:text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-100 dark:bg-white/10">
              <ClipboardList className="h-3.5 w-3.5 text-surface-500 dark:text-white/40" />
            </span>
            Recent Orders
          </h3>
          <span className="text-xs text-surface-400 dark:text-white/30">Today · {orders.length} total</span>
        </div>
        {orders.length === 0 ? (
          <div className="py-12 text-center">
            <span className="text-3xl">📋</span>
            <p className="mt-2 text-sm text-surface-400 dark:text-white/30">No orders today yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-surface-100 bg-surface-50/50 dark:border-white/5 dark:bg-white/5">
                <tr>
                  {['Code', 'Employee', 'Slot', 'Amount', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-white/30">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-50 dark:divide-white/5">
                {orders.slice(0, 10).map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-surface-50/60 dark:hover:bg-white/5">
                    <td className="px-4 py-3 font-mono text-xs font-bold text-brand-600 dark:text-brand-400">{o.order_code}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-indigo-500 text-xs font-bold text-white">
                          {o.employee_name.charAt(0)}
                        </div>
                        <span className="font-medium text-surface-900 dark:text-white">{o.employee_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-surface-500 dark:text-white/40">{o.slot_name}</td>
                    <td className="px-4 py-3 font-semibold text-surface-900 dark:text-white">₹{parseFloat(o.total_amount).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', statusColors[o.status] ?? 'bg-gray-100 text-gray-600')}>{o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin: Time Slots Manager ─────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function AdminTimeSlots() {
  const { data: locations = [] } = useCmsLocations();
  const { data: slotTypes = [] } = useSlotTypes();
  const [canteenId, setCanteenId] = useState('');
  const { data: slots = [], isLoading } = useAdminTimeSlots(canteenId || undefined);
  const createSlot = useCreateTimeSlot();
  const updateSlot = useUpdateTimeSlot();
  const deleteSlot = useDeleteTimeSlot();
  const createSlotType = useCreateSlotType();
  const deleteSlotType = useDeleteSlotType();

  const blankSlot = { name: '', canteen: '', slot_type: '', start_time: '08:00', end_time: '09:00', applicable_days: [1,2,3,4,5], max_orders: '', is_active: true, display_color: '#3b82f6' };
  const [form, setForm] = useState<typeof blankSlot>(blankSlot);
  const [editing, setEditing] = useState<string | null>(null);
  const [showSlotTypeForm, setShowSlotTypeForm] = useState(false);
  const [stForm, setStForm] = useState({ name: '', category: 'MEAL' as 'MEAL'|'TEA_BREAK'|'SNACK', default_order_deadline_mins: 60, default_cancel_window_mins: 15 });

  const startEdit = (s: TimeSlot) => {
    setForm({ name: s.name, canteen: s.canteen, slot_type: s.slot_type, start_time: s.start_time, end_time: s.end_time, applicable_days: s.applicable_days, max_orders: s.max_orders?.toString() ?? '', is_active: s.is_active, display_color: s.display_color || '#3b82f6' });
    setEditing(s.id);
  };

  const save = () => {
    const { id: _id, ...formData } = { ...form, max_orders: form.max_orders ? parseInt(form.max_orders) : null } as unknown as TimeSlot & { id: string; canteen: string; slot_type: string };
    if (editing) {
      updateSlot.mutate({ id: editing, ...formData }, { onSuccess: () => { setEditing(null); setForm(blankSlot); } });
    } else {
      createSlot.mutate(formData as unknown as TimeSlot & { canteen: string; slot_type: string }, { onSuccess: () => setForm(blankSlot) });
    }
  };

  const toggleDay = (day: number) => setForm((f) => ({ ...f, applicable_days: f.applicable_days.includes(day) ? f.applicable_days.filter((d) => d !== day) : [...f.applicable_days, day] }));

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Time Slots</h2>
        <select value={canteenId} onChange={(e) => setCanteenId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-2">
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {/* Slot Type quick-add */}
      <div className="border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700 text-sm">Slot Types</h3>
          <button onClick={() => setShowSlotTypeForm((v) => !v)} className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium">{showSlotTypeForm ? 'Cancel' : '+ Add Type'}</button>
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {slotTypes.map((st) => (
            <span key={st.id} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full border border-blue-200">
              {st.name} <span className="opacity-60">·</span> {st.category}
              <button onClick={() => deleteSlotType.mutate(st.id)} className="ml-1 text-red-400 hover:text-red-600">×</button>
            </span>
          ))}
          {slotTypes.length === 0 && <span className="text-xs text-gray-400">No slot types yet — add one first.</span>}
        </div>
        {showSlotTypeForm && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-gray-100">
            <input placeholder="Type name (e.g. Lunch)" value={stForm.name} onChange={(e) => setStForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
            <select value={stForm.category} onChange={(e) => setStForm((f) => ({ ...f, category: e.target.value as 'MEAL'|'TEA_BREAK'|'SNACK' }))} className={inputCls}>
              <option value="MEAL">Meal</option><option value="TEA_BREAK">Tea Break</option><option value="SNACK">Snack</option>
            </select>
            <input type="number" placeholder="Order deadline (mins)" value={stForm.default_order_deadline_mins} onChange={(e) => setStForm((f) => ({ ...f, default_order_deadline_mins: +e.target.value }))} className={inputCls} />
            <input type="number" placeholder="Cancel window (mins)" value={stForm.default_cancel_window_mins} onChange={(e) => setStForm((f) => ({ ...f, default_cancel_window_mins: +e.target.value }))} className={inputCls} />
            <button onClick={() => createSlotType.mutate(stForm, { onSuccess: () => setShowSlotTypeForm(false) })} className="col-span-2 sm:col-span-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg">Save Slot Type</button>
          </div>
        )}
      </div>

      {/* Time Slot form */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-700 text-sm">{editing ? 'Edit Time Slot' : 'Add Time Slot'}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <input placeholder="Slot name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
          <select value={form.canteen} onChange={(e) => setForm((f) => ({ ...f, canteen: e.target.value }))} className={inputCls}>
            <option value="">Select location *</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={form.slot_type} onChange={(e) => setForm((f) => ({ ...f, slot_type: e.target.value }))} className={inputCls}>
            <option value="">Select slot type *</option>
            {slotTypes.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start Time</label>
            <input type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End Time</label>
            <input type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} className={inputCls} />
          </div>
          <input type="number" placeholder="Max orders (blank = unlimited)" value={form.max_orders} onChange={(e) => setForm((f) => ({ ...f, max_orders: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-2">Applicable Days</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((d, i) => (
              <button key={d} type="button" onClick={() => toggleDay(i + 1)} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${form.applicable_days.includes(i + 1) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>{d}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
            Active
          </label>
          <input type="color" value={form.display_color} onChange={(e) => setForm((f) => ({ ...f, display_color: e.target.value }))} className="w-8 h-8 rounded cursor-pointer border border-gray-300" title="Display color" />
          <div className="flex-1" />
          {editing && <button onClick={() => { setEditing(null); setForm(blankSlot); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>}
          <button onClick={save} disabled={!form.name || !form.canteen || !form.slot_type} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg">
            {editing ? 'Save Changes' : 'Add Slot'}
          </button>
        </div>
      </div>

      {/* Slots table */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : slots.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No time slots configured yet. Add one above.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Slot', 'Location', 'Type', 'Time', 'Days', 'Max Orders', 'Status', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {slots.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-semibold text-gray-900">{s.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{s.canteen_name}</td>
                  <td className="px-4 py-2.5"><span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">{s.slot_type_name}</span></td>
                  <td className="px-4 py-2.5 font-mono text-gray-700">{s.start_time?.slice(0,5)} – {s.end_time?.slice(0,5)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{(s.applicable_days ?? []).map((d) => DAYS[d-1]).join(', ')}</td>
                  <td className="px-4 py-2.5 text-gray-600">{s.max_orders ?? '∞'}</td>
                  <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(s)} className="text-xs text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => deleteSlot.mutate(s.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Admin: Locations Manager ──────────────────────────────────────────────

function AdminLocations() {
  const { data: locations = [], isLoading } = useCmsLocations();
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();
  const deleteLocation = useDeleteLocation();

  const blank = { name: '', address: '', capacity: '', operating_hours_start: '08:00', operating_hours_end: '20:00', contact_person: '', contact_mobile: '', is_active: true };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500';

  const startEdit = (l: CmsLocation) => {
    setForm({ name: l.name, address: l.address ?? '', capacity: l.capacity?.toString() ?? '', operating_hours_start: l.operating_hours_start, operating_hours_end: l.operating_hours_end, contact_person: l.contact_person ?? '', contact_mobile: l.contact_mobile ?? '', is_active: l.is_active });
    setEditing(l.id);
  };

  const save = () => {
    const payload = { ...form, capacity: form.capacity ? parseInt(form.capacity) : null };
    if (editing) {
      updateLocation.mutate({ id: editing, ...payload } as CmsLocation & { id: string }, { onSuccess: () => { setEditing(null); setForm(blank); } });
    } else {
      createLocation.mutate(payload as unknown as CmsLocation, { onSuccess: () => setForm(blank) });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-lg font-bold text-gray-900">Canteen Locations</h2>

      {/* Form */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-gray-700 text-sm">{editing ? 'Edit Location' : 'Add Location'}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <input placeholder="Canteen name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
          <input placeholder="Address / Floor" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} />
          <input type="number" placeholder="Capacity (optional)" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} className={inputCls} />
          <div>
            <label className="block text-xs text-gray-500 mb-1">Opens</label>
            <input type="time" value={form.operating_hours_start} onChange={(e) => setForm((f) => ({ ...f, operating_hours_start: e.target.value }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Closes</label>
            <input type="time" value={form.operating_hours_end} onChange={(e) => setForm((f) => ({ ...f, operating_hours_end: e.target.value }))} className={inputCls} />
          </div>
          <input placeholder="Contact person" value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} className={inputCls} />
          <input placeholder="Contact mobile" value={form.contact_mobile} onChange={(e) => setForm((f) => ({ ...f, contact_mobile: e.target.value }))} className={inputCls} />
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
            Active
          </label>
          <div className="flex-1" />
          {editing && <button onClick={() => { setEditing(null); setForm(blank); }} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>}
          <button onClick={save} disabled={!form.name} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg">
            {editing ? 'Save Changes' : 'Add Location'}
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No locations yet. Add one above to get started.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Name', 'Address', 'Hours', 'Contact', 'Capacity', 'Status', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-gray-600 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {locations.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-semibold text-gray-900">{l.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{l.address || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-700 whitespace-nowrap">{l.operating_hours_start?.slice(0,5)} – {l.operating_hours_end?.slice(0,5)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{l.contact_person || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{l.capacity ?? '—'}</td>
                  <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${l.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{l.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(l)} className="text-xs text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => deleteLocation.mutate(l.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── CMS: Admin Orders Kanban ─────────────────────

function CmsAdminOrders() {
  const [filterDate, setFilterDate] = useState(() => new Date().toISOString().split('T')[0]);
  const { data: orders = [], isLoading } = useAdminOrders({ date: filterDate });
  const accept = useAcceptOrder();
  const reject = useRejectOrder();

  const grouped = useMemo(() => {
    const g: Record<string, CmsOrder[]> = { PENDING: [], ACCEPTED: [], PREPARING: [], PREPARED: [], COLLECTED: [] };
    orders.forEach((o) => { if (g[o.status]) g[o.status].push(o); });
    return g;
  }, [orders]);

  const cols = [
    { key: 'PENDING', label: 'Pending', color: 'bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-700/30' },
    { key: 'ACCEPTED', label: 'Accepted', color: 'bg-blue-50 border-blue-200 dark:bg-blue-900/10 dark:border-blue-700/30' },
    { key: 'PREPARING', label: 'Preparing', color: 'bg-orange-50 border-orange-200 dark:bg-orange-900/10 dark:border-orange-700/30' },
    { key: 'PREPARED', label: 'Ready', color: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/10 dark:border-emerald-700/30' },
    { key: 'COLLECTED', label: 'Done', color: 'bg-surface-50 border-surface-200 dark:bg-surface-900/10 dark:border-surface-700/30' },
  ] as const;

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-3">
        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-xs dark:border-white/10 dark:bg-surface-800 dark:text-white"
        />
        <span className="text-xs text-surface-500 dark:text-white/40">{orders.length} total</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[1,2,3,4,5].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-surface-100 dark:bg-white/5" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {cols.map(({ key, label, color }) => (
            <div key={key} className={cn('rounded-xl border p-2', color)}>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-surface-700 dark:text-white/70">{label}</span>
                <span className="text-xs font-bold text-surface-900 dark:text-white">{grouped[key]?.length ?? 0}</span>
              </div>
              <div className="space-y-2 max-h-[360px] overflow-y-auto">
                {grouped[key]?.map((o) => (
                  <div key={o.id} className="rounded-lg bg-white dark:bg-surface-900 p-2 shadow-xs text-xs">
                    <p className="font-mono font-bold text-surface-900 dark:text-white">{o.order_code}</p>
                    <p className="text-surface-500 dark:text-white/40 truncate">{o.employee_name}</p>
                    <p className="font-medium text-surface-700 dark:text-white/70">₹{Number(o.total_amount).toFixed(2)}</p>
                    {key === 'PENDING' && (
                      <div className="mt-1.5 flex gap-1">
                        <button onClick={() => accept.mutate(o.id)} disabled={accept.isPending}
                          className="flex-1 rounded bg-brand-600 py-1 text-xs text-white hover:bg-brand-700 disabled:opacity-50">Accept</button>
                        <button onClick={() => reject.mutate({ orderId: o.id, reason: 'Rejected by admin' })} disabled={reject.isPending}
                          className="flex-1 rounded bg-danger-600 py-1 text-xs text-white hover:bg-danger-700 disabled:opacity-50">Reject</button>
                      </div>
                    )}
                  </div>
                ))}
                {(grouped[key]?.length ?? 0) === 0 && (
                  <p className="text-center py-4 text-xs text-surface-400 dark:text-white/20">—</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── CMS: Admin Billing Report ────────────────────

function CmsBillingReport() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const { data: summaries = [], isLoading } = useBillingReport(month);
  const generate = useGenerateBilling();
  const lock = useLockBilling();

  const totalNet = useMemo(
    () => summaries.reduce((sum, s) => sum + Number(s.net_deduction), 0),
    [summaries],
  );

  const exportBillingReport = () => {
    if (summaries.length === 0) return;

    downloadCSV(
      summaries.map((s) => ({
        Employee: s.employee_name,
        Code: s.employee_code,
        Department: s.department || '',
        Orders: s.total_orders,
        Total: Number(s.total_amount),
        Reversals: Number(s.total_reversals),
        Net: Number(s.net_deduction),
        Status: s.status,
      })),
      `billing-report-${month}`,
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-xs dark:border-white/10 dark:bg-surface-800 dark:text-white"
        />
        <button
          onClick={() => generate.mutate(month)}
          disabled={generate.isPending}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {generate.isPending ? 'Generating…' : 'Generate Report'}
        </button>
        <button
          onClick={() => { if (window.confirm('Lock this billing period? This cannot be undone.')) lock.mutate(month); }}
          disabled={lock.isPending || summaries.length === 0}
          className="rounded-lg border border-danger-300 px-3 py-1.5 text-xs font-semibold text-danger-600 hover:bg-danger-50 dark:border-danger-700/50 dark:text-danger-400 disabled:opacity-50"
        >
          {lock.isPending ? 'Locking…' : 'Lock Period'}
        </button>
        <button
          type="button"
          onClick={exportBillingReport}
          disabled={summaries.length === 0}
          className="rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-semibold text-surface-600 hover:bg-surface-100 dark:border-white/10 dark:text-white/60"
        >
          Export Excel
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-10 animate-pulse rounded-xl bg-surface-100 dark:bg-white/5" />)}</div>
      ) : (
        <>
          <GlassCard className="!p-3 flex items-center justify-between">
            <span className="text-sm text-surface-700 dark:text-white/70">Total Net Deduction</span>
            <span className="text-lg font-bold text-surface-900 dark:text-white">₹{totalNet.toFixed(2)}</span>
          </GlassCard>
          <div className="overflow-x-auto rounded-xl border border-surface-100 dark:border-white/5">
            <table className="w-full text-xs">
              <thead className="bg-surface-50 dark:bg-white/5">
                <tr>
                  {['Employee', 'Dept', 'Orders', 'Total', 'Reversals', 'Net', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-surface-600 dark:text-white/50">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-white/5">
                {summaries.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-50 dark:hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <div>
                        <p className="font-medium text-surface-900 dark:text-white">{s.employee_name}</p>
                        <p className="text-surface-400 dark:text-white/30">{s.employee_code}</p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-surface-600 dark:text-white/60">{s.department || '—'}</td>
                    <td className="px-3 py-2 text-surface-700 dark:text-white/70">{s.total_orders}</td>
                    <td className="px-3 py-2 text-surface-700 dark:text-white/70">₹{Number(s.total_amount).toFixed(2)}</td>
                    <td className="px-3 py-2 text-danger-600 dark:text-danger-400">−₹{Number(s.total_reversals).toFixed(2)}</td>
                    <td className="px-3 py-2 font-bold text-surface-900 dark:text-white">₹{Number(s.net_deduction).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
                        s.status === 'FINALISED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' :
                        s.status === 'PROCESSED' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' :
                        'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
                      )}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {summaries.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-surface-400 dark:text-white/30">No data. Click "Generate Report" first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── CMS: Kitchen Board (fullscreen-style) ─────────

function CmsKitchenBoard() {
  const canteenId = undefined;
  const { data: board, isLoading } = useKitchenBoard(canteenId);
  const markPreparing = useMarkPreparing();
  const markPrepared = useMarkPrepared();
  const [showGuestLogger, setShowGuestLogger] = useState(false);

  const cols = [
    { key: 'accepted' as const, label: 'To Do', actionLabel: 'Start', color: 'bg-blue-600', action: (id: string) => markPreparing.mutate(id) },
    { key: 'preparing' as const, label: 'Preparing', actionLabel: 'Done', color: 'bg-amber-600', action: (id: string) => markPrepared.mutate(id) },
    { key: 'prepared' as const, label: 'Ready for Pickup', actionLabel: null, color: 'bg-emerald-600', action: null },
  ];

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-2">
          <UtensilsCrossed className="h-4 w-4 text-brand-500" />
          Kitchen Board
        </h3>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowGuestLogger(true)}
            className="flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-pink-700">
            <BookOpen className="h-3.5 w-3.5" /> Log Guest Meal
          </button>
          {board && <span className="text-xs text-surface-400 dark:text-white/30">Updated {new Date(board.timestamp).toLocaleTimeString()}</span>}
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-400" />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">{[1,2,3].map(i => <div key={i} className="h-48 animate-pulse rounded-xl bg-surface-100 dark:bg-white/5" />)}</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cols.map(({ key, label, actionLabel, color, action }) => (
            <div key={key} className="rounded-xl border border-surface-100 dark:border-white/5">
              <div className={cn('flex items-center justify-between rounded-t-xl px-3 py-2 text-white', color)}>
                <span className="text-sm font-bold">{label}</span>
                <span className="text-sm font-bold">{board?.[key]?.length ?? 0}</span>
              </div>
              <div className="divide-y divide-surface-100 dark:divide-white/5 max-h-[400px] overflow-y-auto">
                {board?.[key]?.map((order) => (
                  <div key={order.id} className="p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-surface-900 dark:text-white">{order.order_code}</span>
                      <span className="text-xs text-surface-500 dark:text-white/40">
                        {order.placed_at ? new Date(order.placed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p className="text-xs text-surface-700 dark:text-white/70">{order.employee_name} · {order.slot_name}</p>
                    <div className="space-y-0.5">
                      {order.order_items?.map((item) => (
                        <p key={item.id} className="text-xs text-surface-500 dark:text-white/40">
                          {item.item_name_snapshot} ×{item.quantity}
                        </p>
                      ))}
                    </div>
                    {action && actionLabel && (
                      <button
                        onClick={() => action(order.id)}
                        className={cn('mt-1.5 w-full rounded-lg py-1.5 text-xs font-semibold text-white', color, 'hover:opacity-90 disabled:opacity-50')}
                      >
                        {actionLabel}
                      </button>
                    )}
                  </div>
                ))}
                {(board?.[key]?.length ?? 0) === 0 && (
                  <p className="py-8 text-center text-xs text-surface-300 dark:text-white/20">Empty</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showGuestLogger && <GuestMealLoggerModal onClose={() => setShowGuestLogger(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── CMS: Counter Station ─────────────────────────

function CmsCounterStation() {
  const [code, setCode] = useState('');
  const verify = useVerifyOrderCode();
  const collect = useCollectOrder();
  const acceptByCounter = useAcceptOrderByCounter();
  const { verifiedOrder, setVerifiedOrder } = useCanteenStore();
  const [showReceipt, setShowReceipt] = useState(false);
  const [showGuestLogger, setShowGuestLogger] = useState(false);

  function handleVerify() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    verify.mutate(trimmed, { onSuccess: (res) => setVerifiedOrder(res.order) });
  }

  function handleCollect() {
    if (!verifiedOrder) return;
    collect.mutate(
      { orderId: verifiedOrder.id, orderCode: code.trim().toUpperCase() },
      { onSuccess: () => { setVerifiedOrder(null); setCode(''); } },
    );
  }

  function handlePrintAndForward() {
    if (!verifiedOrder) return;
    acceptByCounter.mutate(verifiedOrder.id, {
      onSuccess: (updated) => {
        setVerifiedOrder(updated);
        setShowReceipt(true);
      },
    });
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-2">
          <QrCode className="h-4 w-4 text-brand-500" />
          Counter Station
        </h3>
        <button onClick={() => setShowGuestLogger(true)}
          className="flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-2 text-xs font-medium text-white hover:bg-pink-700">
          <BookOpen className="h-3.5 w-3.5" /> Log Guest Meal
        </button>
      </div>

      {/* Code input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
          placeholder="Scan or type order code…"
          className="flex-1 rounded-xl border border-surface-200 bg-white px-3 py-2 font-mono text-sm font-bold tracking-wider text-surface-900 placeholder:font-normal placeholder:text-surface-400 dark:border-white/10 dark:bg-surface-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
          autoFocus
        />
        <button
          onClick={handleVerify}
          disabled={!code.trim() || verify.isPending}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {verify.isPending ? '…' : 'Verify'}
        </button>
      </div>

      {/* Error */}
      {verify.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 dark:border-danger-800/50 dark:bg-danger-900/10">
          <AlertCircle className="h-4 w-4 text-danger-500 shrink-0" />
          <p className="text-sm text-danger-700 dark:text-danger-400">
            {(verify.error as Error)?.message ?? 'Order not found or not ready.'}
          </p>
        </div>
      )}

      {/* Verified order details */}
      {verifiedOrder && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-lg font-bold text-surface-900 dark:text-white">{verifiedOrder.order_code}</p>
                <p className="text-sm text-surface-600 dark:text-white/60">{verifiedOrder.employee_name}</p>
                <p className="text-xs text-surface-500 dark:text-white/40">{verifiedOrder.slot_name}</p>
              </div>
              <OrderStatusBadge status={verifiedOrder.status} size="md" />
            </div>

            <div className="space-y-1.5">
              {verifiedOrder.order_items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-surface-700 dark:text-white/70">{item.item_name_snapshot} ×{item.quantity}</span>
                  <span className="font-medium text-surface-900 dark:text-white">₹{Number(item.line_total).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-surface-100 dark:border-white/10 pt-2 flex justify-between">
              <span className="text-sm font-semibold text-surface-700 dark:text-white/70">Total</span>
              <span className="text-base font-bold text-surface-900 dark:text-white">₹{Number(verifiedOrder.total_amount).toFixed(2)}</span>
            </div>

            {/* Action buttons based on status */}
            {verifiedOrder.status === 'PENDING' && (
              <button
                onClick={handlePrintAndForward}
                disabled={acceptByCounter.isPending}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Printer className="h-4 w-4" />
                {acceptByCounter.isPending ? 'Processing…' : 'Print Receipt & Forward to Kitchen'}
              </button>
            )}

            {(verifiedOrder.status === 'ACCEPTED' || verifiedOrder.status === 'PREPARING') && (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-center dark:bg-amber-900/10">
                <div className="flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin text-amber-500" />
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Waiting for kitchen…</p>
                </div>
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Status: <strong>{verifiedOrder.status}</strong>
                </p>
              </div>
            )}

            {verifiedOrder.status === 'PREPARED' && (
              <button
                onClick={handleCollect}
                disabled={collect.isPending}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {collect.isPending ? 'Collecting…' : 'Confirm Collection ✓'}
              </button>
            )}

            {verifiedOrder.status === 'COLLECTED' && (
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center dark:bg-emerald-900/10">
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">✓ Order Collected</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { setVerifiedOrder(null); setCode(''); }}
                className="flex-1 rounded-xl border border-surface-200 py-2 text-sm text-surface-600 dark:border-white/10 dark:text-white/50"
              >
                Clear
              </button>
              <button
                onClick={() => setShowReceipt(true)}
                className="rounded-xl border border-surface-200 px-3 py-2 text-sm text-surface-600 hover:bg-surface-50 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/5"
              >
                <Printer className="h-4 w-4" />
              </button>
            </div>
            {collect.isError && (
              <p className="text-xs text-danger-500 text-center">{(collect.error as Error)?.message}</p>
            )}
          </GlassCard>
        </motion.div>
      )}

      {/* Receipt Modal */}
      <AnimatePresence>
        {showReceipt && verifiedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-surface-900">
              <div className="flex items-center justify-between border-b border-surface-100 px-5 py-4 dark:border-white/10">
                <h2 className="text-base font-semibold text-surface-900 dark:text-white">Order Receipt</h2>
                <button onClick={() => setShowReceipt(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 dark:hover:bg-white/10">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5 space-y-4 font-mono text-sm" id="receipt-content">
                <div className="text-center">
                  <p className="text-base font-bold">Cafinity</p>
                  <p className="text-xs text-surface-500 dark:text-white/40">{new Date().toLocaleString()}</p>
                </div>
                <div className="border-t border-dashed border-surface-200 pt-3 dark:border-white/10">
                  <div className="flex justify-between"><span>Order:</span><span className="font-bold">{verifiedOrder.order_code}</span></div>
                  <div className="flex justify-between"><span>Employee:</span><span>{verifiedOrder.employee_name}</span></div>
                  <div className="flex justify-between"><span>Slot:</span><span>{verifiedOrder.slot_name}</span></div>
                </div>
                <div className="border-t border-dashed border-surface-200 pt-3 dark:border-white/10 space-y-1.5">
                  {verifiedOrder.order_items.map((item) => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.item_name_snapshot} ×{item.quantity}</span>
                      <span>₹{Number(item.line_total).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t-2 border-surface-900 pt-2 flex justify-between font-bold dark:border-white">
                  <span>TOTAL</span><span>₹{Number(verifiedOrder.total_amount).toFixed(2)}</span>
                </div>
              </div>
              <div className="flex gap-2 border-t border-surface-100 px-5 py-4 dark:border-white/10">
                <button onClick={() => setShowReceipt(false)}
                  className="flex-1 rounded-xl border border-surface-200 py-2 text-sm text-surface-600 dark:border-white/10 dark:text-white/50">Close</button>
                <button onClick={() => window.print()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  <Printer className="h-4 w-4" /> Print
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Guest Meal Logger */}
      <AnimatePresence>
        {showGuestLogger && <GuestMealLoggerModal onClose={() => setShowGuestLogger(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ─── macOS Dock Navigation ───────────────────────────────────────────────────

const DOCK_ICONS: Record<string, LucideIcon> = {
  'admin-dashboard': LayoutDashboard,
  'admin-orders':    ShoppingBag,
  'time-slots':      Clock,
  'manage-menu':     ChefHat,
  'locations':       MapPin,
  'billing':         Receipt,
  'kitchen':         Flame,
  'counter':         ScanLine,
  'order':           ShoppingCart,
  'my-orders':       ClipboardList,
  'rules':           Shield,
  'guest-meals':     Users,
  'employees':       UserCheck,
};

const DOCK_COLORS: Record<string, string> = {
  'admin-dashboard': 'from-violet-500 to-indigo-600',
  'admin-orders':    'from-blue-500 to-blue-700',
  'time-slots':      'from-sky-400 to-cyan-600',
  'manage-menu':     'from-orange-400 to-rose-500',
  'locations':       'from-emerald-400 to-teal-600',
  'billing':         'from-amber-400 to-yellow-600',
  'kitchen':         'from-red-500 to-rose-700',
  'counter':         'from-slate-500 to-gray-700',
  'order':           'from-green-400 to-emerald-600',
  'my-orders':       'from-purple-500 to-indigo-600',
  'rules':           'from-violet-500 to-purple-700',
  'guest-meals':     'from-pink-500 to-rose-600',
  'employees':       'from-teal-500 to-cyan-700',
};

function DockItem({
  tab,
  mouseX,
  isActive,
  onClick,
}: {
  tab: { label: string; value: string };
  mouseX: ReturnType<typeof useMotionValue<number>>;
  isActive: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const sizeTransform = useTransform(distance, [-160, 0, 160], [44, 76, 44]);
  const size = useSpring(sizeTransform, { mass: 0.08, stiffness: 200, damping: 16 });

  const yTransform = useTransform(distance, [-160, 0, 160], [0, -14, 0]);
  const y = useSpring(yTransform, { mass: 0.08, stiffness: 200, damping: 16 });

  const iconSize = useTransform(size, (s: number) => s * 0.52);

  const Icon = DOCK_ICONS[tab.value] ?? Menu;
  const gradient = DOCK_COLORS[tab.value] ?? 'from-gray-400 to-gray-600';

  return (
    <div className="flex flex-col items-center gap-1 relative group" ref={ref}>
      {/* Tooltip */}
      <motion.div
        className="absolute -top-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-gray-900/90 backdrop-blur-sm text-white text-xs font-semibold whitespace-nowrap pointer-events-none shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        style={{ zIndex: 50 }}
      >
        {tab.label}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900/90" />
      </motion.div>

      {/* Icon button */}
      <motion.button
        style={{ width: size, height: size, y }}
        onClick={onClick}
        whileTap={{ scale: 0.88 }}
        className={cn(
          'relative rounded-2xl flex items-center justify-center shadow-md cursor-pointer select-none overflow-hidden',
          `bg-gradient-to-br ${gradient}`,
          isActive
            ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-100 shadow-xl'
            : 'hover:shadow-xl',
        )}
      >
        <motion.div
          className="flex items-center justify-center"
          style={{ width: iconSize, height: iconSize }}
        >
          <Icon strokeWidth={1.8} size={undefined} color="white" />
        </motion.div>
        {/* Shine overlay */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-white/30 via-transparent to-transparent pointer-events-none" />
      </motion.button>

      {/* Active dot */}
      <div className={cn('w-1 h-1 rounded-full transition-all duration-200', isActive ? 'bg-gray-500 opacity-100' : 'opacity-0')} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN ORDERING RULES
// ═══════════════════════════════════════════════════════════════

function AdminOrderingRules() {
  const { data: locations = [] } = useCmsLocations();
  const [selectedCanteen, setSelectedCanteen] = useState<string>('');
  const canteenId = selectedCanteen || locations[0]?.id;
  const { data: rules = [] } = useOrderingRules(canteenId);
  const updateRules = useUpdateOrderingRules();
  const [drafts, setDrafts] = useState<Record<string, Partial<OrderingRule>>>({});

  const rule = rules[0];
  const draft = (rule && drafts[rule.id]) ?? {};
  const merged: Partial<OrderingRule> = rule ? { ...rule, ...draft } : {};

  function field(key: keyof OrderingRule, label: string, type: 'number' | 'boolean' = 'number', unit?: string) {
    if (type === 'boolean') {
      return (
        <label key={key} className="flex cursor-pointer items-center justify-between rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
          <span className="text-sm font-medium text-surface-800 dark:text-white/80">{label}</span>
          <input type="checkbox"
            checked={!!(merged as Record<string, unknown>)[key]}
            onChange={(e) => rule && setDrafts((d) => ({ ...d, [rule.id]: { ...d[rule.id], [key]: e.target.checked } }))}
            className="h-5 w-5 rounded accent-brand-600"
          />
        </label>
      );
    }
    return (
      <label key={key} className="flex flex-col gap-1.5 rounded-xl border border-surface-200 bg-surface-50 px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <span className="text-xs font-semibold text-surface-600 dark:text-white/60">{label}</span>
        <div className="flex items-center gap-2">
          <input type="number"
            value={String((merged as Record<string, unknown>)[key] ?? '')}
            onChange={(e) => rule && setDrafts((d) => ({ ...d, [rule.id]: { ...d[rule.id], [key]: Number(e.target.value) } }))}
            className="w-full rounded-lg border border-surface-300/60 bg-white px-3 py-2 text-sm text-surface-900 focus:border-brand-400 focus:outline-none dark:border-white/10 dark:bg-surface-900 dark:text-white"
            min={0}
          />
          {unit && <span className="shrink-0 text-xs text-surface-500 dark:text-white/40">{unit}</span>}
        </div>
      </label>
    );
  }

  function handleSave() {
    if (!rule) return;
    updateRules.mutate(
      { id: rule.id, ...drafts[rule.id] } as Partial<OrderingRule> & { id: string },
      { onSuccess: () => setDrafts((d) => ({ ...d, [rule.id]: {} })) },
    );
  }

  return (
    <div className="space-y-5 p-4">
      {locations.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <button key={l.id} onClick={() => setSelectedCanteen(l.id)}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                canteenId === l.id
                  ? 'bg-surface-900 text-white dark:bg-white dark:text-surface-900'
                  : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-white/5 dark:text-white/60')}>
              {l.name}
            </button>
          ))}
        </div>
      )}

      {!rule ? (
        <p className="py-8 text-center text-sm text-surface-400 dark:text-white/30">No ordering policy configured.</p>
      ) : (
        <div className="rounded-2xl border border-surface-200/70 bg-surface-0 p-5 shadow-xs dark:border-white/10 dark:bg-white/5">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-900/30">
              <Shield className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Order Policies</h3>
              <p className="text-xs text-surface-500 dark:text-white/40">{locations.find((l) => l.id === canteenId)?.name}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {field('min_quantity_per_item', 'Minimum Order Quantity', 'number', 'items')}
            {field('max_quantity_per_item', 'Maximum Order Quantity', 'number', 'items')}
            {field('max_orders_per_day', 'Max Orders Per Day', 'number', 'orders')}
            {field('order_buffer_minutes', 'Order Buffer Time', 'number', 'mins')}
            {field('preparation_time_minutes', 'Preparation Time', 'number', 'mins')}
            {field('cancellation_window_minutes', 'Cancellation Window', 'number', 'mins')}
            {field('require_admin_approval', 'Require Admin Approval', 'boolean')}
            {field('auto_accept', 'Auto-Accept Orders', 'boolean')}
          </div>

          <div className="mt-5 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-900/10">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                These rules are visible to employees on the ordering portal.
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button onClick={handleSave} disabled={updateRules.isPending}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              <Settings2 className="h-4 w-4" />
              {updateRules.isPending ? 'Saving…' : 'Save Policies'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  GUEST MEAL LOGGER MODAL
// ═══════════════════════════════════════════════════════════════

function GuestMealLoggerModal({ onClose }: { onClose: () => void }) {
  const { data: locations = [] } = useCmsLocations();
  const { data: slots = [] } = useAdminTimeSlots(locations[0]?.id);
  const createMeal = useCreateGuestMeal();

  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState<GuestMealPayload>({
    guest_name: '',
    guest_organisation: '',
    meal_description: '',
    canteen: locations[0]?.id ?? '',
    slot: slots[0]?.id ?? '',
    meal_date: today,
    guest_count: 1,
    estimated_cost: undefined,
    notes: '',
  });

  function handleSave() {
    if (!form.guest_name.trim() || !form.meal_description.trim()) return;
    createMeal.mutate({ ...form, canteen: form.canteen || (locations[0]?.id ?? ''), slot: form.slot || undefined }, {
      onSuccess: () => onClose(),
    });
  }

  const inputCls = 'w-full rounded-xl border border-surface-300/70 bg-surface-0 px-3 py-2 text-sm text-surface-900 placeholder-surface-400 focus:border-brand-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder-white/30';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-surface-900">
        <div className="flex items-center justify-between border-b border-surface-100 px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-pink-100 dark:bg-pink-900/30">
              <BookOpen className="h-4 w-4 text-pink-600 dark:text-pink-400" />
            </div>
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">Log Guest Meal</h2>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 dark:hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <input type="text" placeholder="Guest Name *" value={form.guest_name}
              onChange={(e) => setForm((f) => ({ ...f, guest_name: e.target.value }))} className={inputCls} />
          </div>
          <input type="text" placeholder="Organisation (optional)" value={form.guest_organisation}
            onChange={(e) => setForm((f) => ({ ...f, guest_organisation: e.target.value }))} className={inputCls} />
          <input type="date" value={form.meal_date}
            onChange={(e) => setForm((f) => ({ ...f, meal_date: e.target.value }))} className={inputCls} />
          <select value={form.canteen} onChange={(e) => setForm((f) => ({ ...f, canteen: e.target.value }))} className={inputCls}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select value={form.slot ?? ''} onChange={(e) => setForm((f) => ({ ...f, slot: e.target.value || undefined }))} className={inputCls}>
            <option value="">— No specific slot —</option>
            {slots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="number" placeholder="Number of guests" value={form.guest_count ?? 1} min={1}
            onChange={(e) => setForm((f) => ({ ...f, guest_count: Number(e.target.value) }))} className={inputCls} />
          <input type="number" placeholder="Estimated cost (₹, optional)" value={form.estimated_cost ?? ''} min={0}
            onChange={(e) => setForm((f) => ({ ...f, estimated_cost: e.target.value || undefined }))} className={inputCls} />
          <textarea rows={3} placeholder="Meal description *" value={form.meal_description}
            onChange={(e) => setForm((f) => ({ ...f, meal_description: e.target.value }))}
            className={cn(inputCls, 'sm:col-span-2 resize-none')} />
          <textarea rows={2} placeholder="Additional notes (optional)" value={form.notes ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className={cn(inputCls, 'sm:col-span-2 resize-none')} />
        </div>

        <div className="flex justify-end gap-2 border-t border-surface-100 px-5 py-4 dark:border-white/10">
          <button onClick={onClose}
            className="rounded-xl border border-surface-200 px-4 py-2 text-sm text-surface-600 dark:border-white/10 dark:text-white/50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!form.guest_name.trim() || !form.meal_description.trim() || createMeal.isPending}
            className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-700 disabled:opacity-50">
            {createMeal.isPending ? 'Saving…' : 'Log Meal'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN GUEST MEALS
// ═══════════════════════════════════════════════════════════════

function AdminGuestMeals() {
  const { data: meals = [] } = useGuestMeals();
  const deleteMeal = useDeleteGuestMeal();
  const [showLogger, setShowLogger] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Guest Meals Log</h2>
          <p className="text-xs text-surface-500 dark:text-white/40">{meals.length} entries</p>
        </div>
        <button onClick={() => setShowLogger(true)}
          className="flex items-center gap-1.5 rounded-xl bg-pink-600 px-3 py-2 text-xs font-medium text-white hover:bg-pink-700">
          <Plus className="h-3.5 w-3.5" /> Log Guest Meal
        </button>
      </div>

      {meals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="h-10 w-10 text-surface-300 dark:text-white/20" />
          <p className="mt-3 text-sm text-surface-500 dark:text-white/40">No guest meals logged yet.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-surface-200/70 bg-surface-0 shadow-xs dark:border-white/10 dark:bg-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 bg-surface-50/60 dark:border-white/5 dark:bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Guest</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Organisation</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Meal</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Slot</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Guests</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Cost</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100 dark:divide-white/5">
                {meals.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-50/60 dark:hover:bg-white/5">
                    <td className="px-4 py-3">
                      <p className="font-medium text-surface-900 dark:text-white">{m.guest_name}</p>
                      <p className="text-xs text-surface-400 dark:text-white/30">{m.canteen_name}</p>
                    </td>
                    <td className="px-4 py-3 text-surface-600 dark:text-white/60">{m.guest_organisation || '—'}</td>
                    <td className="max-w-xs px-4 py-3 text-surface-700 dark:text-white/70 truncate">{m.meal_description}</td>
                    <td className="px-4 py-3 text-surface-500 dark:text-white/40 whitespace-nowrap">{m.meal_date}</td>
                    <td className="px-4 py-3 text-surface-500 dark:text-white/40">{m.slot_name ?? '—'}</td>
                    <td className="px-4 py-3 text-surface-700 dark:text-white/70">{m.guest_count ?? 1}</td>
                    <td className="px-4 py-3 text-surface-700 dark:text-white/70">
                      {m.estimated_cost ? `₹${m.estimated_cost}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {confirmId === m.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => { deleteMeal.mutate(m.id); setConfirmId(null); }}
                            className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white">Delete</button>
                          <button onClick={() => setConfirmId(null)}
                            className="rounded-lg border border-surface-200 px-2 py-1 text-xs text-surface-600 dark:border-white/10 dark:text-white/50">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmId(m.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showLogger && <GuestMealLoggerModal onClose={() => setShowLogger(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SUPER ADMIN EMPLOYEES
// ═══════════════════════════════════════════════════════════════

function SuperAdminEmployees() {
  const { data: employees = [] } = useEmployees();
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editEmp, setEditEmp] = useState<Employee | null>(null);

  type EmpForm = { name: string; employee_code: string; email: string; department: string; designation: string; is_active: boolean };
  const blank: EmpForm = { name: '', employee_code: '', email: '', department: '', designation: '', is_active: true };
  const [form, setForm] = useState<EmpForm>(blank);

  function openAdd() { setForm(blank); setEditEmp(null); setShowForm(true); }
  function openEdit(e: Employee) {
    setForm({ name: e.name, employee_code: e.employee_code, email: e.email, department: e.department, designation: e.designation, is_active: e.is_active });
    setEditEmp(e);
    setShowForm(true);
  }
  function handleSave() {
    if (!form.name.trim() || !form.employee_code.trim()) return;
    if (editEmp) {
      updateEmployee.mutate({ id: editEmp.id, ...form }, { onSuccess: () => setShowForm(false) });
    } else {
      createEmployee.mutate(form, { onSuccess: () => setShowForm(false) });
    }
  }

  const filtered = employees.filter((e) =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.email.toLowerCase().includes(search.toLowerCase()) || e.department.toLowerCase().includes(search.toLowerCase()),
  );

  const inputCls = 'w-full rounded-xl border border-surface-300/70 bg-surface-0 px-3 py-2 text-sm text-surface-900 placeholder-surface-400 focus:border-brand-400 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder-white/30';

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Employee Management</h2>
          <p className="text-xs text-surface-500 dark:text-white/40">{employees.length} employees</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="rounded-xl border border-surface-200 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white" />
          <button onClick={openAdd}
            className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-3 py-2 text-xs font-medium text-white hover:bg-teal-700">
            <Plus className="h-3.5 w-3.5" /> Add Employee
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl border border-surface-200/70 bg-surface-50 p-4 dark:border-white/10 dark:bg-white/5">
            <h3 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">{editEmp ? 'Edit Employee' : 'Add Employee'}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="text" placeholder="Full Name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              <input type="text" placeholder="Employee Code *" value={form.employee_code} onChange={(e) => setForm((f) => ({ ...f, employee_code: e.target.value }))} className={inputCls} />
              <input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} />
              <input type="text" placeholder="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} className={inputCls} />
              <input type="text" placeholder="Designation" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} className={inputCls} />
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-surface-200 px-4 py-2 dark:border-white/10">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="h-4 w-4 rounded accent-teal-600" />
                <span className="text-sm text-surface-700 dark:text-white/70">Active</span>
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="rounded-xl border border-surface-200 px-4 py-2 text-sm text-surface-600 dark:border-white/10 dark:text-white/50">Cancel</button>
              <button onClick={handleSave} disabled={!form.name.trim() || !form.employee_code.trim()}
                className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                {createEmployee.isPending || updateEmployee.isPending ? 'Saving…' : editEmp ? 'Update' : 'Add'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rounded-2xl border border-surface-200/70 bg-surface-0 shadow-xs dark:border-white/10 dark:bg-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-100 bg-surface-50/60 dark:border-white/5 dark:bg-white/5">
                <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Employee</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Department</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Designation</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-surface-600 dark:text-white/50">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100 dark:divide-white/5">
              {filtered.map((emp) => (
                <tr key={emp.id} className="hover:bg-surface-50/60 dark:hover:bg-white/5">
                  <td className="px-4 py-3">
                    <p className="font-medium text-surface-900 dark:text-white">{emp.name}</p>
                    <p className="text-xs text-surface-400 dark:text-white/30">{emp.email}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-surface-600 dark:text-white/60">{emp.employee_code}</td>
                  <td className="px-4 py-3 text-surface-600 dark:text-white/60">{emp.department}</td>
                  <td className="px-4 py-3 text-surface-500 dark:text-white/40">{emp.designation}</td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium',
                      emp.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-white/40')}>
                      {emp.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(emp)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-white/10 dark:hover:text-white/80">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => updateEmployee.mutate({ id: emp.id, is_active: !emp.is_active })}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-white/10 dark:hover:text-white/80">
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MacDock({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: { label: string; value: string }[];
  activeTab: string;
  onTabChange: (v: string) => void;
}) {
  const mouseX = useMotionValue(Infinity);

  return (
    <div className="fixed bottom-6 left-0 right-0 flex justify-center z-50 pointer-events-none">
      <motion.div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="flex items-end gap-2.5 px-5 py-3 pointer-events-auto"
      >
        {tabs.map((tab) => (
          <DockItem
            key={tab.value}
            tab={tab}
            mouseX={mouseX}
            isActive={activeTab === tab.value}
            onClick={() => onTabChange(tab.value)}
          />
        ))}
      </motion.div>
    </div>
  );
}

// ─── Main CanteenPanel ───────────────────────────

export function CanteenPanel() {
  const portal = useUIStore((s) => s.portal);
  const role = useUIStore((s) => s.role);
  const username = useUIStore((s) => s.username);
  const setPortal = useUIStore((s) => s.setPortal);
  const logout = useUIStore((s) => s.logout);
  // portal='cms' means admin portal; portal='ess' means employee portal
  const isAdmin = portal === 'cms';

  const { activeView } = useCanteenStore();
  const { data: locations = [] } = useCanteenLocations();

  // If an active CMS-specific view is set, show it fullscreen
  if (activeView === 'order-confirmation') return <CmsOrderConfirmation />;

  const employeeTabs = [
    {
      label: 'Order',
      value: 'order',
      content: <OrderMenu locations={locations} />,
    },
    {
      label: 'My Orders',
      value: 'my-orders',
      content: <CmsOrderHistory />,
    },
    {
      label: 'Wallet',
      value: 'wallet',
      content: <WalletView />,
    },
  ];

  const adminTabs = [
    {
      label: 'Dashboard',
      value: 'admin-dashboard',
      content: <AdminDashboard />,
    },
    {
      label: 'Orders',
      value: 'admin-orders',
      content: <CmsAdminOrders />,
    },
    {
      label: 'Time Slots',
      value: 'time-slots',
      content: <AdminTimeSlots />,
    },
    {
      label: 'Menu Items',
      value: 'manage-menu',
      content: <AdminMenuManagement locations={locations} />,
    },
    {
      label: 'Locations',
      value: 'locations',
      content: <AdminLocations />,
    },
    {
      label: 'Billing',
      value: 'billing',
      content: <CmsBillingReport />,
    },
    {
      label: 'Kitchen',
      value: 'kitchen',
      content: <CmsKitchenBoard />,
    },
    {
      label: 'Counter',
      value: 'counter',
      content: <CmsCounterStation />,
    },
    {
      label: 'Policies',
      value: 'rules',
      content: <AdminOrderingRules />,
    },
    {
      label: 'Guest Meals',
      value: 'guest-meals',
      content: <AdminGuestMeals />,
    },
  ];

  const superAdminTabs = [
    ...adminTabs,
    {
      label: 'Employees',
      value: 'employees',
      content: <SuperAdminEmployees />,
    },
  ];

  const tabs = role === 'super_admin' ? superAdminTabs : isAdmin ? adminTabs : employeeTabs;
  const [activeTab, setActiveTab] = useState(tabs[0].value);

  // Reset to first tab when portal changes
  useEffect(() => { setActiveTab(tabs[0].value); }, [isAdmin]);

  const activeContent = tabs.find((t) => t.value === activeTab)?.content;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top nav bar */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/60 px-4 py-2.5 flex items-center justify-between shadow-sm sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <img src="/assets/cafinity-logo.png" alt="Cafinity" className="h-9 w-auto rounded-md bg-white p-1" />
          <span className="font-black text-gray-900 text-lg">Cafinity</span>
          <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
            role === 'super_admin' ? 'bg-purple-100 text-purple-700'
            : isAdmin ? 'bg-amber-100 text-amber-700'
            : 'bg-orange-100 text-orange-700'
          }`}>
            {role === 'super_admin' ? '👑 Super Admin' : isAdmin ? '⚙️ Admin' : '👤 ESS'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 hidden sm:block">👋 {username}</span>
          {(role === 'admin' || role === 'super_admin') && (
            <button
              onClick={() => setPortal(null)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Switch Portal
            </button>
          )}
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Employee portal: Canteen card with inline tabs */}
      {!isAdmin ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
            {/* Section title */}
            <div className="px-6 pt-4 pb-0">
              <span className="text-sm font-semibold text-surface-800 border-b-2 border-brand-600 inline-block pb-1">
                Canteen
              </span>
            </div>
            {/* Inline tabs */}
            <div className="flex border-b border-surface-200 px-6 mt-2">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                    activeTab === tab.value
                      ? 'border-brand-600 text-brand-700'
                      : 'border-transparent text-surface-500 hover:text-surface-700',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {activeContent}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <>
          {/* Admin portal: full page content + dock */}
          <div className="flex-1 overflow-auto pb-28">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 12, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                {activeContent}
              </motion.div>
            </AnimatePresence>
          </div>
          {/* macOS dock — fixed bottom */}
          <MacDock tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        </>
      )}
    </div>
  );
}

export default CanteenPanel;
