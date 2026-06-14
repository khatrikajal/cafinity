// Cafinity — Guest Menu Three Tabs (Guest / New Joinee / Vendor)
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  Calendar,
  CheckCircle,
  Clock,
  Coffee,
  Download,
  Edit3,
  IndianRupee,
  Moon,
  Plus,
  Search,
  Star,
  Sun,
  User,
  UtensilsCrossed,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { AdminLayout } from "./admin-orders";
import { Pagination } from "@/components/Pagination";
import { TablePanel } from "@/components/TablePanel";
import { DigitalTimePicker } from "@/components/DigitalTimePicker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableToolbar, formatShortDateInput, parseShortDateInput } from "@/components/DataTableToolbar";
import { formatINR, type Day, type ItemCategory } from "@/lib/store";
import api from "@/api/client";
import {
  type MenuItem,
  type GuestTypeValue,
  useCreateGuestOrder,
  useGuestOrderStats,
  useGuestOrders,
  useMenuAvailable,
  useMenuSlots,
  useUpdateGuestOrderStatus,
} from "@/hooks/useCanteen";

const GUEST_TABS: Array<{ key: GuestTypeValue; label: string; query: string }> = [
  { key: "GUEST", label: "Guest", query: "guest" },
  { key: "NEW_JOINEE", label: "New Joinee", query: "new_joinee" },
  { key: "VENDOR", label: "Vendor", query: "vendor" },
];

function guestTypeFromQuery(tab?: string): GuestTypeValue {
  if (tab === "new_joinee") return "NEW_JOINEE";
  if (tab === "vendor") return "VENDOR";
  return "GUEST";
}

export const Route = createFileRoute("/admin-guest-orders")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : "guest",
  }),
  component: GuestOrders,
});

type GuestOrder = import("@/hooks/useCanteen").GuestOrder;

type GuestOrderStatus = GuestOrder["status"];
type DateRange = "today" | "7d" | "all" | "custom";
type OrderMode = "menu" | "custom";

const GUEST_ORDERS_PAGE_SIZE = 8;
const MAX_GUEST_NAME_LENGTH = 100;
const MAX_SPECIAL_INSTRUCTIONS_LENGTH = 100;
const MAX_CUSTOM_ITEM_NAME_LENGTH = 100;
const MAX_CUSTOM_ITEM_PRICE = 99999;
const MAX_ITEM_QTY = 99;
const STATUS_FILTERS: Array<"all" | GuestOrderStatus> = [
  "all",
  "pending",
  "accepted",
  "preparing",
  "prepared",
  "collected",
  "cancelled",
];

function GuestOrders() {
  const navigate = useNavigate({ from: "/admin-guest-orders" });
  const searchParams = Route.useSearch() as { tab?: string };
  const activeGuestType = guestTypeFromQuery(searchParams.tab);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | GuestOrderStatus>("all");
  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [customFrom, setCustomFrom] = useState(formatShortDateInput(new Date()));
  const [customTo, setCustomTo] = useState(formatShortDateInput(new Date()));
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSlot, setSelectedSlot] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory | "all">("all");
  const [menuSearchQuery, setMenuSearchQuery] = useState("");
  const [currentDay] = useState<Day>(getCurrentDay());
  const [orderMode, setOrderMode] = useState<OrderMode>("menu");
  const [customItem, setCustomItem] = useState({
    name: "",
    price: "",
    qty: 1,
  });
  const [formData, setFormData] = useState({
    guestName: "",
    phone: "",
    organisation: "",
    items: [] as Array<{
      id: string;
      name: string;
      price: number;
      qty: number;
      isCustom?: boolean;
    }>,
    specialInstructions: "",
    estimatedTime: "",
  });

  const { data: guestOrders = [] } = useGuestOrders({
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: searchQuery || undefined,
    page_size: 100,
    guest_type: activeGuestType,
  });
  const guestOrderStats = useGuestOrderStats(activeGuestType);
  const createGuestOrderMutation = useCreateGuestOrder();
  const updateGuestOrderStatus = useUpdateGuestOrderStatus();
  const { data: menuItems = [] } = useMenuAvailable({
    slot: selectedSlot !== "all" ? selectedSlot : undefined,
    category: selectedCategory !== "all" ? selectedCategory : undefined,
    search: menuSearchQuery || undefined,
    day: currentDay,
  });
  const { data: menuSlots = [] } = useMenuSlots();

  useEffect(() => {
    setCurrentPage(1);
  }, [customFrom, customTo, dateRange, searchQuery, statusFilter, selectedSlot, selectedCategory, menuSearchQuery]);

  const filteredOrders = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return [...guestOrders]
      .filter((order) => {
        const createdAt = new Date(order.created_at).getTime();

        if (dateRange === "today") {
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          if (createdAt < startOfDay.getTime()) return false;
        }

        if (dateRange === "7d" && Date.now() - createdAt > 7 * 24 * 60 * 60 * 1000) {
          return false;
        }

        if (dateRange === "custom") {
          const from = parseShortDateInput(customFrom);
          const to = parseShortDateInput(customTo);
          if (from && createdAt < from.setHours(0, 0, 0, 0)) return false;
          if (to && createdAt > to.setHours(23, 59, 59, 999)) return false;
        }

        const orderId = order.order_number ?? order.id;
        const matchesSearch =
          !normalizedQuery ||
          orderId.toLowerCase().includes(normalizedQuery) ||
          order.guest_name.toLowerCase().includes(normalizedQuery) ||
          (order.phone ?? "").toLowerCase().includes(normalizedQuery);

        const matchesStatus = statusFilter === "all" || order.status === statusFilter;

        return matchesSearch && matchesStatus;
      })
      .sort(
        (first, second) =>
          new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
      );
  }, [customFrom, customTo, dateRange, guestOrders, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / GUEST_ORDERS_PAGE_SIZE));
  const pagedOrders = filteredOrders.slice(
    (currentPage - 1) * GUEST_ORDERS_PAGE_SIZE,
    currentPage * GUEST_ORDERS_PAGE_SIZE,
  );

  const availableSlots = useMemo(() => {
    if (menuSlots.length > 0) {
      return menuSlots;
    }

    const slots = [
      ...new Set(
        menuItems
          .filter((item) => item.live)
          .map((item) => item.slot)
          .filter(Boolean),
      ),
    ];
    return slots.sort() as string[];
  }, [menuItems, menuSlots]);

  const filteredMenuItems = useMemo(() => {
    let filtered = menuItems.filter((item) => item.live);

    if (selectedSlot !== "all") {
      filtered = filtered.filter((item) => item.slot === selectedSlot);
    }

    if (selectedCategory !== "all") {
      filtered = filtered.filter((item) => item.category === selectedCategory);
    }

    if (menuSearchQuery.trim()) {
      const query = menuSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.description.toLowerCase().includes(query) ||
          item.tag?.toLowerCase().includes(query),
      );
    }

    filtered = filtered.filter((item) => !item.days || item.days.includes(currentDay));

    return filtered;
  }, [currentDay, menuItems, menuSearchQuery, selectedCategory, selectedSlot]);

  const menuBySlot = useMemo(() => {
    const grouped: Record<string, MenuItem[]> = {};

    filteredMenuItems.forEach((item) => {
      const slotName = item.slot ?? "General";
      if (!grouped[slotName]) {
        grouped[slotName] = [];
      }
      grouped[slotName].push(item);
    });

    return grouped;
  }, [filteredMenuItems]);

  const totalRevenue = guestOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const averageOrderValue =
    guestOrderStats.data?.average_order ??
    (guestOrders.length > 0 ? Math.round(totalRevenue / guestOrders.length) : 0);
  const activeGuestOrders = guestOrderStats.data?.active_orders ??
    guestOrders.filter((order) => order.status !== "completed" && order.status !== "cancelled").length;
  const guestCount = guestOrderStats.data?.total_guests ?? guestOrders.length;
  const todaysRevenue = guestOrderStats.data?.todays_revenue ?? totalRevenue;
  const hasMenuResults = Object.keys(menuBySlot).length > 0;

  const normalizeGuestTime = (value: string) => {
    const raw = value.trim();
    if (!raw) return undefined;

    if (/^\d{1,4}$/.test(raw)) {
      const digits = raw;
      if (digits.length <= 2) {
        return `${digits.padStart(2, '0')}:00`;
      }
      if (digits.length === 3) {
        return `${digits[0]}:${digits.slice(1).padStart(2, '0')}`;
      }
      return `${digits.slice(0, 2)}:${digits.slice(2)}`;
    }

    const normalized = raw.replace(/\s+/g, '');
    const match = normalized.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (match) {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      const second = match[3] ? Number(match[3]) : undefined;
      if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && (second === undefined || (second >= 0 && second < 60))) {
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` +
          (second !== undefined ? `:${String(second).padStart(2, '0')}` : '');
      }
    }

    return undefined;
  };

  const addToGuestCart = (menuItem: MenuItem | null, isCustom = false) => {
    const itemId = isCustom ? `custom-${Date.now()}` : (menuItem?.id ?? "");
    if (!itemId) return;

    const existingItem = formData.items.find((item) => item.id === itemId);

    if (existingItem) {
      setFormData((prev) => ({
        ...prev,
        items: prev.items.map((item) =>
          item.id === itemId ? { ...item, qty: item.qty + 1 } : item,
        ),
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: itemId,
          name: isCustom ? customItem.name : (menuItem?.name ?? ""),
          price: isCustom ? Number(customItem.price) : (menuItem?.price ?? 0),
          qty: isCustom ? customItem.qty : 1,
          isCustom,
        },
      ],
    }));

    if (isCustom) {
      setCustomItem({ name: "", price: "", qty: 1 });
    }
  };

  const updateGuestQty = (itemId: string, qty: number) => {
    if (!Number.isFinite(qty)) return;
    const normalizedQty = Math.floor(qty);
    if (qty <= 0) {
      setFormData((prev) => ({
        ...prev,
        items: prev.items.filter((item) => item.id !== itemId),
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.id === itemId ? { ...item, qty: Math.min(MAX_ITEM_QTY, normalizedQty) } : item,
      ),
    }));
  };

  const updateGuestQtyFromInput = (itemId: string, value: string) => {
    const parsed = Number.parseInt(value, 10);
    updateGuestQty(itemId, Number.isFinite(parsed) ? parsed : 1);
  };

  const getTotal = () => formData.items.reduce((sum, item) => sum + item.price * item.qty, 0);

  const validateGuestOrderForm = (): string | null => {
    const guestName = formData.guestName.trim();
    const phone = formData.phone.trim();
    const specialInstructions = formData.specialInstructions.trim();

    if (!guestName) {
      return "Guest name is required.";
    }

    if (guestName.length > MAX_GUEST_NAME_LENGTH) {
      return `Guest name cannot exceed ${MAX_GUEST_NAME_LENGTH} characters.`;
    }

    if (specialInstructions.length > MAX_SPECIAL_INSTRUCTIONS_LENGTH) {
      return `Special instructions cannot exceed ${MAX_SPECIAL_INSTRUCTIONS_LENGTH} characters.`;
    }

    if (phone) {
      if (!/^\d+$/.test(phone)) {
        return "Phone number must contain only digits.";
      }

      if (phone.length !== 10) {
        return "Phone number must be exactly 10 digits.";
      }
    }

    const invalidCustomItem = formData.items.find((item) => item.isCustom && (
      item.name.trim().length > MAX_CUSTOM_ITEM_NAME_LENGTH ||
      !Number.isFinite(item.price) ||
      item.price <= 0 ||
      item.price > MAX_CUSTOM_ITEM_PRICE ||
      !Number.isInteger(item.qty) ||
      item.qty <= 0 ||
      item.qty > MAX_ITEM_QTY
    ));

    if (invalidCustomItem) {
      return `Custom items must have name <= ${MAX_CUSTOM_ITEM_NAME_LENGTH} chars, price between 1 and ${MAX_CUSTOM_ITEM_PRICE}, and qty between 1 and ${MAX_ITEM_QTY}.`;
    }

    const invalidOrderItem = formData.items.find(
      (item) =>
        !Number.isInteger(item.qty) ||
        item.qty <= 0 ||
        item.qty > MAX_ITEM_QTY,
    );
    if (invalidOrderItem) {
      return `Item quantity must be between 1 and ${MAX_ITEM_QTY}.`;
    }

    return null;
  };

  const createGuestOrder = async () => {
    if (!formData.guestName || formData.items.length === 0) {
      alert("Please fill in guest name and add items to order");
      return;
    }

    const validationError = validateGuestOrderForm();
    if (validationError) {
      alert(validationError);
      return;
    }

    const estimatedTimeValue = formData.estimatedTime?.trim();
    const normalizedEstimatedTime = estimatedTimeValue
      ? normalizeGuestTime(estimatedTimeValue)
      : undefined;

    if (estimatedTimeValue && !normalizedEstimatedTime) {
      alert("Estimated pickup time must be a valid time like 9, 09:00, 930, or 12:30.");
      return;
    }

    await createGuestOrderMutation.mutateAsync({
      guest_name: formData.guestName,
      guest_type: activeGuestType,
      phone: formData.phone || "",
      estimated_time: normalizedEstimatedTime,
      special_instructions: formData.specialInstructions || "",
      items: formData.items.map((item) =>
        item.isCustom
          ? {
              name: item.name,
              price: item.price,
              qty: item.qty,
            }
          : {
              menu_item_id: item.id,
              qty: item.qty,
            },
      ),
    });

    setFormData({
      guestName: "",
      phone: "",
      organisation: "",
      items: [],
      specialInstructions: "",
      estimatedTime: "",
    });
    setOrderMode("menu");
    setShowCreateForm(false);
  };

  const downloadBlobAsExcel = async (blob: Blob, filename: string) => {
    if (blob.type.includes("spreadsheet")) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${filename}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }

    const csvText = await blob.text();
    const workbook = XLSX.read(csvText, { type: "string" });
    XLSX.writeFile(workbook, `${filename}.xlsx`, { bookType: "xlsx" });
  };

  const exportGuestOrdersCSV = async () => {
    const query = new URLSearchParams();
    if (statusFilter !== "all") query.append("status", statusFilter);
    if (dateRange === "custom") {
      query.append("date_from", customFrom);
      query.append("date_to", customTo);
    }

    const { blob } = await api.download(`/guest-orders/export_csv/?${query.toString()}`);
    await downloadBlobAsExcel(blob, "guest-orders");
  };

  const exportGuestOrdersDetailed = async () => {
    const query = new URLSearchParams();
    if (statusFilter !== "all") query.append("status", statusFilter);
    if (dateRange === "custom") {
      query.append("date_from", customFrom);
      query.append("date_to", customTo);
    }

    const { blob } = await api.download(`/guest-orders/export_detailed/?${query.toString()}`);
    await downloadBlobAsExcel(blob, "guest-orders-detailed");
  };

  const handleUpdateGuestOrderStatus = async (id: string, status: GuestOrderStatus) => {
    try {
      await updateGuestOrderStatus.mutateAsync({ id, status });
    } catch (error) {
      console.error(error);
      alert("Unable to update guest order status.");
    }
  };

  return (
    <AdminLayout crumb="Guest Orders">
      <div className="space-y-8 p-6 md:p-8">
        <section className="rounded-[32px] border border-[#eadfce] bg-[linear-gradient(135deg,#fffaf1_0%,#fff3e2_50%,#fffdf9_100%)] p-6 shadow-[0_28px_80px_-50px_rgba(105,56,16,0.45)] dark:border-[#4b3020] dark:bg-[linear-gradient(135deg,#241711_0%,#1a120e_50%,#130d0a_100%)] dark:shadow-[0_28px_80px_-40px_rgba(0,0,0,0.5)] sm:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#f1ddbe] bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#b56c1d] dark:border-[#5a3924] dark:bg-[#241711]/80 dark:text-[#ffb467]">
                <UtensilsCrossed className="h-3.5 w-3.5" />
                Counter Operations
              </div>
              <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#23160d] dark:text-[#fff3e5] sm:text-4xl">
                Guest Orders
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={exportGuestOrdersCSV}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#ddcfbd] bg-white px-5 py-3 text-sm font-semibold text-[#322013] shadow-[0_16px_40px_-28px_rgba(95,58,23,0.45)] transition-all hover:border-[#cfa876] hover:bg-[#fffaf3] dark:border-[#4d3223] dark:bg-[#1d1410] dark:text-[#f1decb] dark:hover:border-[#8f6138] dark:hover:bg-[#281b15]"
              >
                <Download className="h-4 w-4" />
                Export Excel
              </button>
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#f3a133_0%,#e07b1f_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_-20px_rgba(224,123,31,0.65)] transition-all hover:translate-y-[-1px] hover:shadow-[0_24px_55px_-18px_rgba(224,123,31,0.72)]"
              >
                <Plus className="h-4 w-4" />
                Create Guest Order
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {GUEST_TABS.map((tab) => {
              const count = tab.key === activeGuestType ? guestOrders.length : undefined;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => navigate({ search: { tab: tab.query } })}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    activeGuestType === tab.key
                      ? "bg-[#ef7f1a] text-white"
                      : "border border-[#eadfce] bg-white text-[#7d6a56] hover:bg-[#fff8ef] dark:border-[#4c3020] dark:bg-[#17100c] dark:text-[#c8af95]"
                  }`}
                >
                  {tab.label}
                  {typeof count === "number" ? (
                    <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <GuestMetricCard
              label="Total Guests"
              value={String(guestCount).padStart(2, "0")}
              hint="Orders created today"
              icon={User}
            />
            <GuestMetricCard
              label="Active Orders"
              value={String(activeGuestOrders).padStart(2, "0")}
              hint="Pending service"
              icon={Clock}
            />
            <GuestMetricCard
              label="Revenue"
              value={formatINR(todaysRevenue)}
              hint="Today's collected sales"
              icon={IndianRupee}
            />
            <GuestMetricCard
              label="Average Order"
              value={formatINR(averageOrderValue)}
              hint="Per guest ticket"
              icon={UtensilsCrossed}
            />
          </div>
        </section>

        <section className="rounded-[28px] border border-[#eadfce] bg-[#fffdf9] p-5 shadow-[0_20px_60px_-45px_rgba(88,54,26,0.55)] dark:border-[#4b3020] dark:bg-[#17110d] dark:shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)] sm:p-6">
          <DataTableToolbar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search by order id, guest name, or phone..."
            options={[
              { value: "today", label: "Today" },
              { value: "7d", label: "Last 7 Days" },
              { value: "all", label: "All" },
              { value: "custom", label: "Custom" },
            ]}
            activeOption={dateRange}
            onOptionChange={(value) => setDateRange(value as DateRange)}
            fromValue={customFrom}
            toValue={customTo}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
            extraFilters={
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | GuestOrderStatus)}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  {STATUS_FILTERS.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            }
            actions={
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={exportGuestOrdersCSV}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#ddcfbd] bg-white px-4 py-2 text-sm font-semibold text-[#322013] transition-all hover:border-[#cfa876] hover:bg-[#fffaf3] dark:border-[#4d3223] dark:bg-[#1d1410] dark:text-[#f1decb] dark:hover:border-[#8f6138] dark:hover:bg-[#281b15]"
                >
                  Export Excel
                </button>
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#f3a133_0%,#e07b1f_100%)] px-4 py-2 text-sm font-semibold text-white transition-all hover:translate-y-[-1px] hover:shadow-[0_8px_18px_-8px_rgba(224,123,31,0.72)]"
                >
                  Create Guest Order
                </button>
              </div>
            }
          />

          <div className="mt-5 rounded-2xl border border-[#efe2d2] bg-[#fff8ef] px-4 py-3 text-xs font-medium uppercase tracking-[0.22em] text-[#9a7a50] dark:border-[#4b3123] dark:bg-[#221712] dark:text-[#c9af95]">
            {filteredOrders.length} guest orders matched
          </div>
        </section>
        <TablePanel
          title="Guest Orders"
          description={`${filteredOrders.length} guest orders found`}
          summary={
            <div className="rounded-full border border-[#eadfce] bg-[#fff8ef] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#9a7a50] dark:border-[#4b3021] dark:bg-[#241711] dark:text-[#c9af95]">
              Live Counter View
            </div>
          }
          className="rounded-[28px] border-[#eadfce] bg-[#fffdf9] shadow-[0_20px_60px_-45px_rgba(88,54,26,0.55)] dark:border-[#4b3020] dark:bg-[#17110d] dark:shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)]"
        >
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#fff1dd] text-[#d67a1f] dark:bg-[#382317] dark:text-[#ffb467]">
                <User className="h-8 w-8" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-[#2b1c12]">No guest orders found</h3>
              <p className="mt-1 text-sm text-[#7a6752]">
                {searchQuery ? "Try adjusting your search" : "Start by creating a new guest order"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#efe2d2] bg-[#fff8ef] dark:border-[#3f2b21] dark:bg-[#221712]">
                      <TableHead className="whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Order ID
                      </TableHead>
                      <TableHead className="whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Guest
                      </TableHead>
                      <TableHead className="min-w-[280px] py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Items
                      </TableHead>
                      <TableHead className="whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Ordered On
                      </TableHead>
                      <TableHead className="whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Pickup Time
                      </TableHead>
                      <TableHead className="whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Status
                      </TableHead>
                      <TableHead className="whitespace-nowrap py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Actions
                      </TableHead>
                      <TableHead className="whitespace-nowrap py-4 text-right text-[11px] font-bold uppercase tracking-[0.22em] text-[#8c765b]">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedOrders.map((order) => {
                      const StatusIcon = getStatusIcon(order.status);
                      return (
                        <TableRow
                          key={order.id}
                          className="border-[#f2e8dc] hover:bg-[#fffaf4] dark:border-[#3d2a20] dark:hover:bg-[#221712]"
                        >
                          <TableCell className="py-5 font-semibold text-[#d36f18]">
                            {order.order_number ?? order.id}
                          </TableCell>
                          <TableCell className="py-5">
                            <div className="flex items-start gap-3">
                              <div
                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${getStatusColor(order.status)}`}
                              >
                                <StatusIcon className="h-4 w-4" />
                              </div>
                              <div className="space-y-1">
                                <div className="font-semibold text-[#2b1c12]">
                                  {order.guest_name}
                                </div>
                                <div className="text-xs text-[#83705c]">{order.phone || "N/A"}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-5 text-sm text-[#6f5d49]">
                            <div>
                              {order.items
                                .map((item) => `${item.name} x${item.qty}`)
                                .join(", ")}
                            </div>
                            {order.special_instructions ? (
                              <div className="mt-2 rounded-xl bg-[#fff5e9] px-3 py-2 text-xs text-[#936f45]">
                                Note: {order.special_instructions}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="py-5 text-sm text-[#6f5d49]">
                            {formatGuestDate(order.created_at)}
                          </TableCell>
                          <TableCell className="py-5 text-sm text-[#6f5d49]">
                            {order.estimated_time || "-"}
                          </TableCell>
                          <TableCell className="py-5">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${getStatusColor(order.status)}`}
                            >
                              {order.status}
                            </span>
                          </TableCell>
                          <TableCell className="py-5 text-left">
                            <div className="flex flex-col items-start gap-2">
                              {order.status === "pending" ? (
                                <button
                                  onClick={() => handleUpdateGuestOrderStatus(order.id, "accepted")}
                                  className="rounded-2xl bg-[#f5af47] px-3 py-1 text-xs font-semibold text-white"
                                >
                                  Accept
                                </button>
                              ) : null}
                              {order.status === "accepted" ? (
                                <button
                                  onClick={() => handleUpdateGuestOrderStatus(order.id, "preparing")}
                                  className="rounded-2xl bg-[#f9b851] px-3 py-1 text-xs font-semibold text-white"
                                >
                                  Prepare
                                </button>
                              ) : null}
                              {order.status === "preparing" ? (
                                <button
                                  onClick={() => handleUpdateGuestOrderStatus(order.id, "prepared")}
                                  className="rounded-2xl bg-[#5ab96b] px-3 py-1 text-xs font-semibold text-white"
                                >
                                  Mark Ready
                                </button>
                              ) : null}
                              {order.status === "prepared" ? (
                                <button
                                  onClick={() => handleUpdateGuestOrderStatus(order.id, "collected")}
                                  className="rounded-2xl bg-[#4097f6] px-3 py-1 text-xs font-semibold text-white"
                                >
                                  Collect
                                </button>
                              ) : null}
                              {['pending', 'accepted', 'preparing'].includes(order.status) ? (
                                <button
                                  onClick={() => handleUpdateGuestOrderStatus(order.id, "cancelled")}
                                  className="rounded-2xl bg-[#f35f5f] px-3 py-1 text-xs font-semibold text-white"
                                >
                                  Cancel
                                </button>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="py-5 text-right font-semibold text-[#2b1c12]">
                            {formatINR(order.total)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                totalItems={filteredOrders.length}
                pageSize={GUEST_ORDERS_PAGE_SIZE}
              />
            </>
          )}
        </TablePanel>

        {showCreateForm ? (
          <div className="fixed inset-0 z-50 bg-[#1d140d]/55 p-4 backdrop-blur-[6px]">
            <div className="mx-auto flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-none border border-[#eadfce] bg-[#fffdf9] shadow-[0_32px_100px_-28px_rgba(41,24,10,0.65)] dark:border-[#4b3020] dark:bg-[#17110d] dark:shadow-[0_32px_100px_-20px_rgba(0,0,0,0.6)]">
              <div className="flex items-start justify-between border-b border-[#efe2d2] px-6 py-5 sm:px-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#b17027]">
                    Counter Entry
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-[#23160d] dark:text-[#fff3e5]">
                    Create Guest Order
                  </h2>
                  <p className="mt-1 text-sm text-[#786652]">
                    Add a guest order with clear selection, cleaner spacing, and better visual
                    balance.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-2xl border border-[#eadfce] bg-white p-2.5 text-[#7e6b57] transition-colors hover:bg-[#fff6ec] hover:text-[#2b1c12] dark:border-[#4b3020] dark:bg-[#201510] dark:text-[#bca189] dark:hover:bg-[#2b1c15] dark:hover:text-[#fff2e3]"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="overflow-y-auto px-6 py-6 sm:px-8">
                <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="space-y-5">
                    <div className="rounded-[28px] border border-[#eadfce] bg-[#fff8ef] p-5 dark:border-[#4c3122] dark:bg-[#211611]">
                      <h3 className="text-lg font-semibold text-[#23160d] dark:text-[#fff3e5]">
                        Guest Information
                      </h3>
                      <div className="mt-5 space-y-4">
                        <Field label="Guest Name *" icon={User}>
                          <input
                            type="text"
                            value={formData.guestName}
                            onChange={(e) => {
                              const raw = e.target.value.slice(0, MAX_GUEST_NAME_LENGTH);
                              const sanitized = raw.replace(/[^a-zA-Z0-9 ]/g, "");
                              setFormData((prev) => ({
                                ...prev,
                                guestName: sanitized,
                              }));
                            }}
                            placeholder="Enter guest name"
                            maxLength={MAX_GUEST_NAME_LENGTH}
                            className={inputClassName(true)}
                          />
                        </Field>

                        <Field label="Guest Phone" icon={User}>
                          <input
                            type="text"
                            value={formData.phone}
                            onChange={(e) => {
                              const onlyDigits = e.target.value.replace(/\D/g, "").slice(0, 10);
                              setFormData((prev) => ({ ...prev, phone: onlyDigits }));
                            }}
                            placeholder="Enter phone number"
                            maxLength={10}
                            className={inputClassName(true)}
                          />
                        </Field>

                        <Field label="Estimated Pickup Time" icon={Clock}>
                          <DigitalTimePicker
                            value={formData.estimatedTime}
                            onChange={(time) =>
                              setFormData((prev) => ({ ...prev, estimatedTime: time }))
                            }
                            placeholder="HH:MM"
                          />
                        </Field>

                        <div>
                          <label className="mb-2 block text-sm font-semibold text-[#3e2a1b]">
                            Special Instructions
                          </label>
                          <textarea
                            value={formData.specialInstructions}
                            onChange={(e) => {
                              const raw = e.target.value.slice(0, MAX_SPECIAL_INSTRUCTIONS_LENGTH);
                              const sanitized = raw.replace(/[^a-zA-Z0-9 ]/g, "");
                              setFormData((prev) => ({
                                ...prev,
                                specialInstructions: sanitized,
                              }));
                            }}
                            placeholder="Any special requests or dietary requirements..."
                            rows={5}
                            maxLength={MAX_SPECIAL_INSTRUCTIONS_LENGTH}
                            className="w-full resize-none rounded-2xl border border-[#e6d6c3] bg-white p-4 text-sm text-[#2d1d12] outline-none transition-all placeholder:text-[#9e8d7a] focus:border-[#e18b2c] focus:ring-2 focus:ring-[#f3b66c]/30 dark:border-[#4f3425] dark:bg-[#1d1410] dark:text-[#fff2e4] dark:placeholder:text-[#9d8368]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div className="rounded-[28px] border border-[#eadfce] bg-white p-5 dark:border-[#4c3122] dark:bg-[#1c1410]">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-[#23160d] dark:text-[#fff3e5]">
                            Select Items
                          </h3>
                          <p className="mt-1 text-sm text-[#7d6a56] dark:text-[#c9af95]">
                            Choose from live menu items or create a custom order.
                          </p>
                        </div>
                        <div className="flex rounded-2xl border border-[#eadfce] bg-[#fff8ef] p-1 dark:border-[#4b3021] dark:bg-[#241711]">
                          <button
                            onClick={() => setOrderMode("menu")}
                            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                              orderMode === "menu"
                                ? "bg-[linear-gradient(135deg,#ef8f23_0%,#dd6f16_100%)] text-white shadow-[0_14px_30px_-20px_rgba(221,111,22,0.9)]"
                                : "text-[#7b6855] hover:text-[#2b1c12]"
                            }`}
                          >
                            <UtensilsCrossed className="h-4 w-4" />
                            Menu Items
                          </button>
                          <button
                            onClick={() => setOrderMode("custom")}
                            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                              orderMode === "custom"
                                ? "bg-[#2b1c12] text-white shadow-[0_14px_30px_-20px_rgba(43,28,18,0.85)]"
                                : "text-[#7b6855] hover:text-[#2b1c12]"
                            }`}
                          >
                            <Star className="h-4 w-4" />
                            Custom Order
                          </button>
                        </div>
                      </div>

                      {orderMode === "menu" ? (
                        <div className="mt-5 space-y-4">
                          <div className="relative">
                            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#967f66]" />
                            <input
                              type="text"
                              value={menuSearchQuery}
                              onChange={(e) => setMenuSearchQuery(e.target.value)}
                              placeholder="Search menu items..."
                              className="w-full rounded-2xl border border-[#e6d6c3] bg-[#fffaf4] py-3 pl-11 pr-4 text-sm text-[#2d1d12] outline-none transition-all placeholder:text-[#9e8d7a] focus:border-[#e18b2c] focus:bg-white focus:ring-2 focus:ring-[#f3b66c]/30 dark:border-[#4f3425] dark:bg-[#221712] dark:text-[#fff2e4] dark:placeholder:text-[#9d8368] dark:focus:bg-[#1a120e]"
                            />
                          </div>

                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <FilterChip
                                active={selectedSlot === "all"}
                                onClick={() => setSelectedSlot("all")}
                              >
                                All Slots
                              </FilterChip>
                              {availableSlots.map((slot) => (
                                <FilterChip
                                  key={slot}
                                  active={selectedSlot === slot}
                                  onClick={() => setSelectedSlot(slot)}
                                  tone={selectedSlot === slot ? "dark" : "accent"}
                                >
                                  <span className="inline-flex items-center gap-2">
                                    {getSlotIcon(slot)}
                                    {slot}
                                  </span>
                                </FilterChip>
                              ))}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <FilterChip
                                active={selectedCategory === "all"}
                                onClick={() => setSelectedCategory("all")}
                              >
                                All Categories
                              </FilterChip>
                              {(["Veg", "Non-Veg", "Beverages"] as const).map((category) => (
                                <FilterChip
                                  key={category}
                                  active={selectedCategory === category}
                                  onClick={() => setSelectedCategory(category)}
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <span
                                      className={`h-2.5 w-2.5 rounded-full ${getCategoryDotClass(category)}`}
                                    />
                                    {category}
                                  </span>
                                </FilterChip>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-[#efe2d2] bg-[#fff8ef] px-4 py-3 text-sm text-[#8c6c45] dark:border-[#4a3023] dark:bg-[#241711] dark:text-[#c9af95]">
                            <span className="inline-flex items-center gap-2 font-medium">
                              <Calendar className="h-4 w-4" />
                              Showing items available on {currentDay}
                            </span>
                          </div>

                          <div className="max-h-[360px] overflow-y-auto rounded-[24px] border border-[#efe2d2] bg-[#fffaf4] p-4 dark:border-[#4a3023] dark:bg-[#201510]">
                            {!hasMenuResults ? (
                              <div className="flex flex-col items-center justify-center py-12 text-center">
                                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-[#b78553] shadow-sm dark:bg-[#2a1b15] dark:text-[#ffb467]">
                                  <Search className="h-6 w-6" />
                                </div>
                                <h4 className="mt-4 font-semibold text-[#2b1c12]">
                                  No items found
                                </h4>
                                <p className="mt-1 text-sm text-[#7d6a56] dark:text-[#c9af95]">
                                  Try adjusting your filters or search query.
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                {Object.entries(menuBySlot).map(([slot, items]) => (
                                  <div key={slot}>
                                    <div className="mb-3 flex items-center gap-2">
                                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-[#c26f1b] shadow-sm dark:bg-[#2a1b15] dark:text-[#ffb467]">
                                        {getSlotIcon(slot)}
                                      </div>
                                      <div>
                                        <h4 className="font-semibold text-[#2b1c12]">{slot}</h4>
                                        <p className="text-xs text-[#88715a]">
                                          {items.length} items
                                        </p>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      {items.map((menuItem) => {
                                        const cartItem = formData.items.find(
                                          (item) => item.id === menuItem.id,
                                        );
                                        const qty = cartItem?.qty || 0;
                                        const isInCart = qty > 0;

                                        return (
                                          <div
                                            key={menuItem.id}
                                            className={`flex flex-col gap-3 rounded-2xl border p-4 transition-all sm:flex-row sm:items-center ${
                                              isInCart
                                                ? "border-[#efb26e] bg-white shadow-[0_18px_30px_-26px_rgba(225,139,44,0.75)] dark:bg-[#211611]"
                                                : "border-[#eadfce] bg-white hover:border-[#d7b288] dark:border-[#4b3021] dark:bg-[#1c1410] dark:hover:border-[#8b6038]"
                                            }`}
                                          >
                                            <div className="min-w-0 flex-1">
                                              <div className="flex flex-wrap items-center gap-2">
                                                <h4 className="font-semibold text-[#2b1c12]">
                                                  {menuItem.name}
                                                </h4>
                                                {menuItem.tag ? (
                                                  <span className="rounded-full bg-[#fff1dd] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#c26f1b]">
                                                    {menuItem.tag}
                                                  </span>
                                                ) : null}
                                              </div>
                                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                                <span className="text-sm font-bold text-[#d36f18]">
                                                  {formatINR(menuItem.price)}
                                                </span>
                                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7d6a56] dark:text-[#c9af95]">
                                                  <span
                                                    className={`h-2.5 w-2.5 rounded-full ${getCategoryDotClass(menuItem.category as ItemCategory)}`}
                                                  />
                                                  {menuItem.category}
                                                </span>
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                              {!isInCart ? (
                                                <button
                                                  onClick={() => addToGuestCart(menuItem)}
                                                  className="rounded-xl bg-[linear-gradient(135deg,#ef8f23_0%,#dd6f16_100%)] px-4 py-2 text-sm font-semibold text-white"
                                                >
                                                  Add
                                                </button>
                                              ) : (
                                                <>
                                                  <input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={qty}
                                                    onChange={(e) =>
                                                      updateGuestQtyFromInput(menuItem.id, e.target.value)
                                                    }
                                                    className="w-20 rounded-xl border border-[#e6d6c3] bg-white px-3 py-2 text-sm font-semibold text-[#2d1d12] outline-none transition-all focus:border-[#e18b2c] focus:ring-2 focus:ring-[#f3b66c]/30 dark:border-[#4f3425] dark:bg-[#1d1410] dark:text-[#fff2e4]"
                                                  />
                                                  <div className="min-w-[76px] text-right text-sm font-semibold text-[#d36f18]">
                                                    {formatINR(menuItem.price * qty)}
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-5 rounded-[24px] border border-[#eadfce] bg-[#fff8ef] p-5 dark:border-[#4c3122] dark:bg-[#211611]">
                          <div className="flex items-center gap-2">
                            <Star className="h-5 w-5 text-[#c26f1b]" />
                            <h4 className="font-semibold text-[#2b1c12]">
                              Custom Order for Special Requests
                            </h4>
                          </div>

                          <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <Field label="Item Name *" icon={Edit3}>
                                <input
                                  type="text"
                                  value={customItem.name}
                                  onChange={(e) => {
                                    const raw = e.target.value.slice(0, MAX_CUSTOM_ITEM_NAME_LENGTH);
                                    const sanitized = raw.replace(/[^a-zA-Z0-9 ]/g, "");
                                    setCustomItem((prev) => ({
                                      ...prev,
                                      name: sanitized,
                                    }));
                                  }}
                                  placeholder="e.g., Special Pasta, Custom Cake"
                                  maxLength={MAX_CUSTOM_ITEM_NAME_LENGTH}
                                  className={inputClassName(true)}
                                />
                              </Field>
                            </div>

                            <Field label="Price (INR) *" icon={IndianRupee}>
                              <input
                                type="number"
                                value={customItem.price}
                                onChange={(e) => {
                                  const onlyDigits = e.target.value.replace(/\D/g, "");
                                  const normalized = onlyDigits ? String(Math.min(MAX_CUSTOM_ITEM_PRICE, Number(onlyDigits))) : "";
                                  setCustomItem((prev) => ({ ...prev, price: normalized }));
                                }}
                                placeholder="0"
                                min="1"
                                max={MAX_CUSTOM_ITEM_PRICE}
                                step="1"
                                className={inputClassName(true)}
                              />
                            </Field>

                            <div>
                              <label className="mb-2 block text-sm font-semibold text-[#3e2a1b]">
                                Quantity *
                              </label>
                              <input
                                type="number"
                                value={customItem.qty}
                                onChange={(e) => {
                                  const parsedQty = Number.parseInt(e.target.value, 10);
                                  const safeQty = Number.isFinite(parsedQty)
                                    ? Math.min(MAX_ITEM_QTY, Math.max(1, parsedQty))
                                    : 1;
                                  setCustomItem((prev) => ({
                                    ...prev,
                                    qty: safeQty,
                                  }));
                                }}
                                min="1"
                                max={MAX_ITEM_QTY}
                                className="w-full rounded-2xl border border-[#e6d6c3] bg-white px-4 py-3 text-sm text-[#2d1d12] outline-none transition-all focus:border-[#e18b2c] focus:ring-2 focus:ring-[#f3b66c]/30 dark:border-[#4f3425] dark:bg-[#1d1410] dark:text-[#fff2e4]"
                              />
                            </div>
                          </div>

                          <button
                            onClick={() => {
                              const trimmedName = customItem.name.trim();
                              const parsedPrice = Number(customItem.price);
                              const isValidCustomItem =
                                !!trimmedName &&
                                trimmedName.length <= MAX_CUSTOM_ITEM_NAME_LENGTH &&
                                Number.isFinite(parsedPrice) &&
                                parsedPrice >= 1 &&
                                parsedPrice <= MAX_CUSTOM_ITEM_PRICE &&
                                Number.isInteger(customItem.qty) &&
                                customItem.qty >= 1 &&
                                customItem.qty <= MAX_ITEM_QTY;

                              if (isValidCustomItem) {
                                addToGuestCart(null, true);
                              } else {
                                alert(`Enter valid custom item details: name (1-${MAX_CUSTOM_ITEM_NAME_LENGTH} chars), price (1-${MAX_CUSTOM_ITEM_PRICE}), quantity (1-${MAX_ITEM_QTY}).`);
                              }
                            }}
                            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#ef8f23_0%,#dd6f16_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_38px_-24px_rgba(221,111,22,0.95)]"
                          >
                            <Plus className="h-4 w-4" />
                            Add Custom Item
                          </button>

                          {formData.items.filter((item) => item.isCustom).length > 0 ? (
                            <div className="mt-5 space-y-2 border-t border-[#eadfce] pt-5">
                              {formData.items
                                .filter((item) => item.isCustom)
                                .map((item) => (
                                  <div
                                    key={item.id}
                                    className="flex items-center justify-between rounded-2xl border border-[#eadfce] bg-white px-4 py-3 dark:border-[#4a3022] dark:bg-[#1d1410]"
                                  >
                                    <div>
                                      <p className="font-medium text-[#2b1c12]">{item.name}</p>
                                      <p className="text-xs text-[#8c6c45]">Custom item</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => updateGuestQty(item.id, item.qty - 1)}
                                        className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#eadfce] bg-[#fff8ef] text-[#6e5b47] dark:border-[#4a3022] dark:bg-[#241711] dark:text-[#d5bba2]"
                                      >
                                        -
                                      </button>
                                      <span className="w-8 text-center text-sm font-semibold text-[#2b1c12]">
                                        {item.qty}
                                      </span>
                                      <button
                                        onClick={() => updateGuestQty(item.id, item.qty + 1)}
                                        className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#2b1c12] text-white"
                                      >
                                        +
                                      </button>
                                      <div className="min-w-[68px] text-right text-sm font-semibold text-[#d36f18]">
                                        {formatINR(item.price * item.qty)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="rounded-[28px] border border-[#eadfce] bg-[#fff8ef] p-5 dark:border-[#4c3122] dark:bg-[#211611]">
                      <div className="flex items-center justify-between">
                        <h4 className="text-lg font-semibold text-[#23160d] dark:text-[#fff3e5]">
                          Order Summary
                        </h4>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#9a7a50] dark:bg-[#2a1b15] dark:text-[#c9af95]">
                          {formData.items.length} items
                        </span>
                      </div>

                      {formData.items.length === 0 ? (
                        <p className="mt-4 text-sm text-[#7d6a56] dark:text-[#c9af95]">
                          Add items to see the summary here.
                        </p>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {formData.items.map((item, index) => (
                            <div
                              key={index}
                              className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3 dark:bg-[#1d1410]"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-[#2b1c12]">{item.name}</span>
                                  {item.isCustom ? (
                                    <span className="rounded-full bg-[#fff1dd] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#c26f1b]">
                                      Custom
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-xs text-[#7d6a56] dark:text-[#c9af95]">
                                  Qty {item.qty}
                                </p>
                              </div>
                              <span className="text-sm font-semibold text-[#2b1c12]">
                                {formatINR(item.price * item.qty)}
                              </span>
                            </div>
                          ))}

                          <div className="border-t border-[#eadfce] pt-4">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8c765b]">
                                Total
                              </span>
                              <span className="text-2xl font-bold text-[#d36f18]">
                                {formatINR(getTotal())}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col-reverse gap-3 border-t border-[#efe2d2] pt-6 sm:flex-row sm:justify-end">
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="rounded-2xl border border-[#ddcfbd] bg-white px-6 py-3 text-sm font-semibold text-[#3a281b] transition-colors hover:bg-[#fff8ef] dark:border-[#4d3223] dark:bg-[#1d1410] dark:text-[#f1decb] dark:hover:bg-[#281b15]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createGuestOrder}
                    className="rounded-2xl bg-[linear-gradient(135deg,#ef8f23_0%,#dd6f16_100%)] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_-24px_rgba(221,111,22,0.85)]"
                  >
                    Create Guest Order
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}

function GuestMetricCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-[28px] border border-[#eadfce] bg-[#fffaf4] p-5 shadow-[0_18px_45px_-36px_rgba(96,52,12,0.55)] dark:border-[#4a3021] dark:bg-[#1c1410] dark:shadow-[0_18px_45px_-20px_rgba(0,0,0,0.4)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9a7a50] dark:text-[#c7ab90]">
            {label}
          </p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-[#23160d] dark:text-[#fff3e5]">
            {value}
          </p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff1dd] text-[#c26f1b] dark:bg-[#382216] dark:text-[#ffb467]">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  tone = "accent",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: "accent" | "dark";
}) {
  const activeClass =
    tone === "dark"
      ? "bg-[#2b1c12] text-white dark:bg-[#fff1df] dark:text-[#2b1c12]"
      : "bg-[linear-gradient(135deg,#ef8f23_0%,#dd6f16_100%)] text-white";

  return (
    <button
      onClick={onClick}
      className={`rounded-2xl px-4 py-2 text-sm font-semibold transition-all ${
        active
          ? activeClass
          : "border border-[#e6d6c3] bg-white text-[#6d5a46] dark:border-[#4f3425] dark:bg-[#1d1410] dark:text-[#d5bba2]"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-[#3e2a1b] dark:text-[#f0decb]">
        {label}
      </label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#967f66] dark:text-[#b89c80]" />
        {children}
      </div>
    </div>
  );
}

function inputClassName(withIcon = false) {
  return `w-full rounded-2xl border border-[#e6d6c3] bg-white py-3 ${
    withIcon ? "pl-11" : "pl-4"
  } pr-4 text-sm text-[#2d1d12] outline-none transition-all placeholder:text-[#9e8d7a] focus:border-[#e18b2c] focus:ring-2 focus:ring-[#f3b66c]/30 dark:border-[#4f3425] dark:bg-[#1f1510] dark:text-[#fff2e4] dark:placeholder:text-[#9d8368]`;
}

function getCurrentDay(): Day {
  const days: Day[] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[new Date().getDay()];
}

function getStatusIcon(status: GuestOrderStatus) {
  switch (status) {
    case "pending":
      return Clock;
    case "accepted":
      return Star;
    case "preparing":
      return UtensilsCrossed;
    case "prepared":
    case "collected":
      return CheckCircle;
    case "cancelled":
      return XCircle;
    default:
      return Clock;
  }
}

function getStatusColor(status: GuestOrderStatus) {
  switch (status) {
    case "pending":
      return "bg-[#fff4e2] text-[#c47b1e] dark:bg-[#3a2617] dark:text-[#ffb467]";
    case "accepted":
      return "bg-[#fef5e6] text-[#d28c2d] dark:bg-[#3e2819] dark:text-[#ffcc7a]";
    case "preparing":
      return "bg-[#fff1dd] text-[#d36f18] dark:bg-[#3b2416] dark:text-[#ffb467]";
    case "prepared":
      return "bg-[#e9f7ef] text-[#2f8f57] dark:bg-[#173323] dark:text-[#65d49a]";
    case "collected":
      return "bg-[#eef4ff] text-[#456ec9] dark:bg-[#1b2740] dark:text-[#8aaeff]";
    case "cancelled":
      return "bg-[#fdeceb] text-[#c65044] dark:bg-[#3c1d1a] dark:text-[#f08f86]";
    default:
      return "bg-[#f5efe6] text-[#7f6c57] dark:bg-[#2a1c15] dark:text-[#c3a88d]";
  }
}

function getSlotIcon(slot: string) {
  switch (slot.toLowerCase()) {
    case "breakfast":
      return <Coffee className="h-3.5 w-3.5" />;
    case "lunch":
      return <Sun className="h-3.5 w-3.5" />;
    case "dinner":
      return <Moon className="h-3.5 w-3.5" />;
    default:
      return <UtensilsCrossed className="h-3.5 w-3.5" />;
  }
}

function getCategoryDotClass(category: ItemCategory) {
  switch (category) {
    case "Veg":
      return "bg-emerald-500";
    case "Non-Veg":
      return "bg-rose-500";
    case "Beverages":
      return "bg-sky-500";
    case "Desserts":
      return "bg-violet-500";
    default:
      return "bg-amber-500";
  }
}

function formatGuestDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}
