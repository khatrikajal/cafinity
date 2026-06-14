// Cafinity rebrand — logo + favicon update
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BellRing, ChefHat, Clock3, Flame, LogOut, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { fetchKitchenOrders, updateKitchenOrderStatus } from "@/api/kitchen";
import { LiveSlotDashboard } from "@/components/LiveSlotDashboard";
import { BottomNav, type BottomNavItem } from "@/components/BottomNav";
import {
  DataTableToolbar,
  formatShortDateInput,
  parseShortDateInput,
} from "@/components/DataTableToolbar";
import { Pagination } from "@/components/Pagination";
import { TablePanel } from "@/components/TablePanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getCurrentUser, logoutAndRedirect } from "@/lib/auth";
import { writeReadyBoard } from "@/lib/readyBoard";
import { formatINR, type Order, type OrderStatus } from "@/lib/store";

export const Route = createFileRoute("/kitchen")({ component: Kitchen });

const PAGE_SIZE = 8;
const POLL_INTERVAL_MS = 5000;

const kitchenNav: BottomNavItem[] = [
  {
    to: "/kitchen",
    label: "Live",
    icon: ChefHat,
    color: "bg-gradient-to-br from-orange-300 to-red-500",
  },
  {
    to: "/kitchen-history",
    label: "History",
    icon: Clock3,
    color: "bg-gradient-to-br from-cyan-300 to-sky-700",
  },
  {
    to: "/kitchen-notifications",
    label: "Alerts",
    icon: Flame,
    color: "bg-gradient-to-br from-rose-400 to-red-700",
  },
  {
    to: "/ready-screen",
    label: "Ready Screen",
    icon: BellRing,
    color: "bg-gradient-to-br from-amber-300 to-orange-600",
  },
];

export function KitchenLayout({ children, title }: { children: ReactNode; title: string }) {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? getCurrentUser() : null;
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    logoutAndRedirect();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/60 px-4 backdrop-blur sm:px-6 lg:px-8" style={{justifyContent: "space-between"}}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ChefHat className="h-4 w-4" />
          </div>
          <div className="hidden text-sm font-semibold leading-tight sm:block">{title}</div>
        </div>
        {/* Search removed */}
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-amber-700" />
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <div className="font-semibold leading-none">
              {user?.name ?? "Chef"}
              <div className="text-[10px] text-muted-foreground">KITCHEN</div>
            </div>
            <ThemeToggle />
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="text-muted-foreground hover:text-destructive disabled:opacity-50"
              aria-label="Logout"
            >
              {isLoggingOut ? "..." : <LogOut className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>
      <main className="w-full flex-1 px-4 py-6 pb-28 sm:px-6 lg:px-8">{children}</main>
      <BottomNav items={kitchenNav} />
    </div>
  );
}

function Kitchen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [range, setRange] = useState<"today" | "7d" | "all" | "custom">("today");
  const [customFrom, setCustomFrom] = useState(formatShortDateInput(new Date()));
  const [customTo, setCustomTo] = useState(formatShortDateInput(new Date()));
  const [page, setPage] = useState(1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOrders = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      setError("");
      const nextOrders = await fetchKitchenOrders();
      setOrders(nextOrders);
    } catch (err) {
      setOrders([]);
      setError((err as Error).message || "Could not load kitchen orders.");
      if (!silent) toast.error((err as Error).message || "Could not load kitchen orders.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    pollRef.current = setInterval(() => loadOrders(true), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadOrders]);

  const liveOrders = useMemo(
    () =>
      orders
        .filter((order) => ["placed", "preparing", "ready", "pending"].includes(order.status))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [orders],
  );

  useEffect(() => {
    writeReadyBoard(orders.filter((order) => order.status === "ready"));
  }, [orders]);

  const filteredLiveOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const now = Date.now();

    return liveOrders.filter((order) => {
      const createdAt = new Date(order.createdAt).getTime();

      // The kitchen API already returns today's live queue. Avoid a second
      // browser-timezone filter here so valid backend orders are not hidden.
      if (range === "7d" && now - createdAt > 7 * 24 * 60 * 60 * 1000) return false;
      if (range === "custom") {
        const from = parseShortDateInput(customFrom);
        const to = parseShortDateInput(customTo);
        if (from && createdAt < from.setHours(0, 0, 0, 0)) return false;
        if (to && createdAt > to.setHours(23, 59, 59, 999)) return false;
      }
      if (!query) return true;

      return (
        String(order.orderNumber ?? "").toLowerCase().includes(query) ||
        String(order.customerName ?? "").toLowerCase().includes(query) ||
        String(order.slotName ?? "").toLowerCase().includes(query) ||
        (order.items ?? []).some((item) => String(item.name ?? "").toLowerCase().includes(query))
      );
    });
  }, [customFrom, customTo, liveOrders, range, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredLiveOrders.length / PAGE_SIZE));
  const pagedOrders = filteredLiveOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [customFrom, customTo, range, searchQuery]);

  const handleAdvanceOrder = async (order: Order) => {
    const nextStatus = getNextKitchenStatus(order.status);
    if (!nextStatus) return;

    setUpdatingId(order.id);
    const previousOrders = orders;
    if (nextStatus === "delivered") {
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
    }
    try {
      const updated = await updateKitchenOrderStatus(order.id, nextStatus);
      if (nextStatus === "delivered") {
        setOrders((current) => current.filter((entry) => entry.id !== updated.id));
      } else {
        setOrders((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      }
      toast.success(`${order.orderNumber ?? order.id} moved to ${nextStatus}`);
      loadOrders(true);
    } catch (err) {
      if (nextStatus === "delivered") {
        setOrders(previousOrders);
      }
      toast.error((err as Error).message || "Could not update order.");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <KitchenLayout title="Live Orders ">
      <div className="mb-6 space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Live Slot Overview</h2>
        <LiveSlotDashboard />
      </div>
      <TablePanel
        title="Live Orders"
        description="Monitoring the active preparation queue in real time."
        actions={
          <div className="w-full sm:w-auto">
            <DataTableToolbar
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Search orders, employees, items..."
              options={[
                { value: "today", label: "Today" },
                { value: "7d", label: "Last 7 Days" },
                { value: "all", label: "All" },
                { value: "custom", label: "Custom" },
              ]}
              activeOption={range}
              onOptionChange={(value) => setRange(value as "today" | "7d" | "all" | "custom")}
              fromValue={customFrom}
              toValue={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
              filterActions={
                <button
                  onClick={() => loadOrders()}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Refresh"
                  aria-label="Refresh live orders"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              }
            />
          </div>
        }
      >
        {error && <div className="px-5 py-3 text-sm text-destructive">{error}</div>}
        {isLoading ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">
            Loading kitchen orders...
          </div>
        ) : filteredLiveOrders.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">
            No live orders
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium text-primary">
                    {order.orderNumber ?? order.id}
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-semibold">{order.customerName ?? "Employee"}</div>
                      <div className="text-xs text-muted-foreground">{order.department ?? "-"}</div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{order.slotName ?? "-"}</TableCell>
                  <TableCell className="max-w-[320px] text-sm text-muted-foreground">
                    {(order.items ?? []).map((item) => `${item.quantity}x ${item.name}`).join(", ")}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {formatINR(order.total ?? order.totalAmount ?? 0)}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${getKitchenStatusClass(order.status)}`}
                    >
                      {getKitchenStatusLabel(order.status)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={filteredLiveOrders.length}
          pageSize={PAGE_SIZE}
        />
      </TablePanel>
    </KitchenLayout>
  );
}

function getKitchenStatusClass(status: OrderStatus) {
  switch (status) {
    case "pending":
    case "placed":
    case "preparing":
    case "ready":
      return "bg-primary/15 text-primary";
    case "delivered":
      return "bg-emerald-500/15 text-emerald-600";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getKitchenStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
    case "placed":
    case "preparing":
    case "ready":
      return "PENDING";
    case "delivered":
      return "DELIVERED";
    default:
      return String(status || "ORDER").toUpperCase();
  }
}

