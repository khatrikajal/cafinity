// Cafinity rebrand — logo + favicon update
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LayoutGrid,
  ChefHat,
  Clock3,
  ReceiptText,
  Flame,
  CheckSquare,
  Search,
  LogOut,
  ShoppingBag,
  User,
  Megaphone,
  UserPlus2,
  KeyRound,
  ClipboardList,
} from "lucide-react";

import { fetchAdminOrders, fetchCanteens, type AdminOrdersParams, type CanteenOption } from "@/api/admin";
import api from "@/api/client";
import { fetchUpcomingSlots } from "@/api/slotapi";
import { getCurrentUser, logoutAndRedirect } from "@/lib/auth";
import { fetchValidatedRole, getValidatedRoleSync } from "@/lib/authRole";
import { getClaimsFromStorage } from "@/lib/authStorage";
import { BottomNav, type BottomNavItem } from "@/components/BottomNav";
import {
  DataTableToolbar,
  formatShortDateInput,
  parseShortDateInput,
} from "@/components/DataTableToolbar";
import { Pagination } from "@/components/Pagination";
import { TablePanel } from "@/components/TablePanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatINR, type Order } from "@/lib/store";
import { redirectToLogin } from "@/lib/navigation";

export const Route = createFileRoute("/admin-orders")({ component: AdminOrders });

const adminNav: BottomNavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutGrid, color: "bg-gradient-to-br from-violet-400 to-indigo-600" },
  { to: "/admin-menu", label: "Menu", icon: ChefHat, color: "bg-gradient-to-br from-orange-300 to-red-500" },
  { to: "/admin-slots", label: "Slots", icon: Clock3, color: "bg-gradient-to-br from-cyan-300 to-sky-700" },
  { to: "/admin-orders", label: "Orders", icon: ShoppingBag, color: "bg-gradient-to-br from-sky-400 to-blue-700" },
  { to: "/admin-counter", label: "Counter", icon: CheckSquare, color: "bg-gradient-to-br from-orange-400 to-amber-600" },
  { to: "/admin-guest-orders", label: "Guest Orders", icon: User, color: "bg-gradient-to-br from-emerald-400 to-teal-600" },
  { to: "/admin-announcements", label: "Announcement", icon: Megaphone, color: "bg-gradient-to-br from-fuchsia-400 to-pink-600" },
  { to: "/admin-kitchen", label: "Kitchen Users", icon: KeyRound, color: "bg-gradient-to-br from-lime-400 to-emerald-700" },
  { to: "/admin-employees", label: "Employees", icon: UserPlus2, color: "bg-gradient-to-br from-cyan-400 to-blue-600" },
  { to: "/admin-billing", label: "Reports", icon: ReceiptText, color: "bg-gradient-to-br from-amber-300 to-orange-600" },
  { to: "/admin-notifications", label: "Alerts", icon: Flame, color: "bg-gradient-to-br from-rose-400 to-red-700" },
  { to: "/admin/audit-logs", label: "Audit Logs", icon: ClipboardList, color: "bg-gradient-to-br from-indigo-400 to-violet-700" },
];

const limitedAdminNavPaths = new Set([
  "/admin",
  "/admin-orders",
  "/admin-counter",
  "/admin-guest-orders",
  "/admin-slots",
  "/admin-menu",
  "/admin-announcements",
  "/admin-notifications",
  "/admin/audit-logs",
  "/admin/menu-create",
  "/admin/set-password",
]);

function isLimitedAdminPathAllowed(pathname: string) {
  return Array.from(limitedAdminNavPaths).some((path) => (
    pathname === path || pathname.startsWith(`${path}/`)
  ));
}

export function getExactRoleType(_user?: ReturnType<typeof getCurrentUser>) {
  return getValidatedRoleSync()?.role_type ?? "";
}

export function AdminLayout({ children, crumb }: { children: ReactNode; crumb: string }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Initialize synchronously so the redirect guard never fires on a stale null.
  const [user, setUser] = useState<ReturnType<typeof getCurrentUser>>(() => getCurrentUser());
  const [roleType, setRoleType] = useState(() => getExactRoleType(getCurrentUser()));
  const [assignedCanteenName, setAssignedCanteenName] = useState(() => {
    const u = getCurrentUser();
    const claims = getClaimsFromStorage<{ canteen_id?: string; canteen_name?: string }>();
    return u?.canteenName || claims?.canteen_name || "";
  });
  const [assignedCanteenId, setAssignedCanteenId] = useState(() => {
    const u = getCurrentUser();
    const claims = getClaimsFromStorage<{ canteen_id?: string; canteen_name?: string }>();
    return u?.canteenId || claims?.canteen_id || "";
  });
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const currentUser = getCurrentUser();
    const claims = getClaimsFromStorage<{ canteen_id?: string; canteen_name?: string }>();
    setUser(currentUser);
    setAssignedCanteenName(currentUser?.canteenName || claims?.canteen_name || "");
    setAssignedCanteenId(currentUser?.canteenId || claims?.canteen_id || "");

    void fetchValidatedRole(true).then((profile) => {
      if (profile?.role_type) {
        setRoleType(profile.role_type);
      }
      if (profile?.canteen_name) {
        setAssignedCanteenName(profile.canteen_name);
      }
      if (profile?.canteen_id) {
        setAssignedCanteenId(profile.canteen_id);
      }
    });
  }, []);

  const isLimitedAdmin = roleType === "LIMITED_ADMIN";
  const mustChangePassword = getValidatedRoleSync()?.must_change_password === true
    || getClaimsFromStorage<{ must_change_password?: boolean }>()?.must_change_password === true;

  useEffect(() => {
    if (!isLimitedAdmin) return;

    let ignore = false;
    api.get<{ canteen_name?: string; canteen_id?: string }>("/auth/me/")
      .then((response) => {
        if (ignore) return;
        setAssignedCanteenName(response.data?.canteen_name || "");
        setAssignedCanteenId(response.data?.canteen_id || "");
      })
      .catch(() => {
        // Keep whatever was already available from session storage.
      });

    return () => {
      ignore = true;
    };
  }, [isLimitedAdmin]);
  const visibleAdminNav = useMemo(
    () => isLimitedAdmin
      ? adminNav.filter((item) => limitedAdminNavPaths.has(item.to))
      : adminNav,
    [isLimitedAdmin],
  );

  useEffect(() => {
    if (isLimitedAdmin && !isLimitedAdminPathAllowed(location.pathname)) {
      navigate({ to: "/admin", replace: true });
    }
  }, [isLimitedAdmin, location.pathname, navigate]);

  useEffect(() => {
    if (!user) {
      redirectToLogin();
      return;
    }
    if (isLimitedAdmin && mustChangePassword && location.pathname !== "/admin/set-password") {
      navigate({ to: "/admin/set-password", replace: true });
    }
  }, [isLimitedAdmin, location.pathname, mustChangePassword, navigate, user]);

  const handleLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    logoutAndRedirect();
  };

  if (isLimitedAdmin && !isLimitedAdminPathAllowed(location.pathname)) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/60 px-4 backdrop-blur sm:px-6 lg:px-8" style={{justifyContent: "space-between"}}>
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-white p-1 shadow-sm">
            <img src="/assets/cafinity-logo.png" alt="Cafinity" className="h-full w-full object-contain" />
          </div>
          <div className="hidden sm:block">
            <div className="text-xs font-bold leading-tight text-primary">Admin Portal</div>
            <div className="text-[10px] text-muted-foreground">
              Admin / <span className="text-foreground">{crumb}</span>
            </div>
          </div>
        </div>
        {/* Search removed */}
        {/* <div className="ml-auto flex items-center gap-2 md:ml-0">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-amber-700" />
          <div className="hidden text-xs sm:block">
            <div className="font-semibold leading-none">{user?.name ?? "Admin"}</div>
            <div className="text-[10px] text-muted-foreground">ADMIN</div>
            <button onClick={handleLogout} className="text-muted-foreground flex hover:text-destructive" aria-label="Logout">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div> */}

        <div className="ml-auto flex items-center gap-2">
          <div
            className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-primary to-amber-700"
            title={
              isLimitedAdmin
                ? `Limited Admin${assignedCanteenName ? ` | Canteen: ${assignedCanteenName}` : ""}${assignedCanteenId ? ` | ID: ${assignedCanteenId}` : ""}`
                : user?.name ?? "Admin"
            }
          />
          <div className="hidden min-w-0 sm:block">
            <div className="text-xs font-semibold leading-none">{user?.name ?? "Admin"}</div>
            <div className="text-[10px] text-muted-foreground">
              {isLimitedAdmin ? "LIMITED ADMIN" : "ADMIN"}
            </div>
          </div>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Logout"
            title="Logout"
          >
            {isLoggingOut ? "..." : <LogOut className="h-4 w-4" />}
          </button>
        </div>
      </header>
      <main className="w-full flex-1 px-4 py-6 pb-28 sm:px-6 lg:px-8">{children}</main>
      <BottomNav items={visibleAdminNav} />
    </div>
  );
}

const STAGES = ["Preparing", "Ready", "Delivered"] as const;
type Stage = typeof STAGES[number];
const ITEMS_PER_PAGE = 10;

function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [serverCount, setServerCount] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [slotFilter, setSlotFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | Stage>("All");
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [range, setRange] = useState<"today" | "7d" | "all" | "custom">("all");
  const [customFrom, setCustomFrom] = useState(formatShortDateInput(new Date()));
  const [customTo, setCustomTo] = useState(formatShortDateInput(new Date()));
  const [roleType, setRoleType] = useState("");
  const [canteenFilter, setCanteenFilter] = useState("All");
  const [canteens, setCanteens] = useState<CanteenOption[]>([]);
  const [canteenLoading, setCanteenLoading] = useState(false);
  const [slotOptions, setSlotOptions] = useState<{ id: string; name: string }[]>([{ id: "All", name: "All Slots" }]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState("");
  const isLimitedAdmin = roleType === "LIMITED_ADMIN";

  const activeSlotOptions = useMemo(() => {
    if (slotOptions.length > 1) return slotOptions;

    const orderOptions = orders.reduce<Map<string, string>>((map, order) => {
      if (order.slotId) map.set(order.slotId, getAdminSlotName(order));
      return map;
    }, new Map());

    return [{ id: "All", name: "All Slots" }, ...Array.from(orderOptions, ([id, name]) => ({ id, name }))];
  }, [orders, slotOptions]);

  const liveOrders = orders;

  const counts = useMemo(
    () => ({
      Preparing: liveOrders.filter((order) => getAdminStageLabel(order.status) === "Preparing").length,
      Ready: liveOrders.filter((order) => getAdminStageLabel(order.status) === "Ready").length,
      Delivered: liveOrders.filter((order) => getAdminStageLabel(order.status) === "Delivered").length,
      Total: liveOrders.length,
    }),
    [liveOrders],
  );

  const visible = useMemo(() => {
    let list = [...liveOrders];

    if (slotFilter !== "All") {
      list = list.filter((order) => order.slotId === slotFilter);
    }

    return list;
  }, [liveOrders, slotFilter]);

  const totalPages = slotFilter === "All" ? serverTotalPages : Math.max(1, Math.ceil(visible.length / ITEMS_PER_PAGE));
  const paginatedOrders = slotFilter === "All"
    ? visible
    : visible.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [canteenFilter, customFrom, customTo, query, range, slotFilter, statusFilter]);

  useEffect(() => {
    setRoleType(getExactRoleType(getCurrentUser()));
  }, []);

  useEffect(() => {
    if (isLimitedAdmin) return;

    let ignore = false;
    setCanteenLoading(true);
    fetchCanteens()
      .then((items) => {
        if (!ignore) setCanteens(items);
      })
      .catch(() => {
        if (!ignore) setCanteens([]);
      })
      .finally(() => {
        if (!ignore) setCanteenLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [isLimitedAdmin]);

  useEffect(() => {
    let ignore = false;
    setSlotLoading(true);
    setSlotError("");

    fetchUpcomingSlots()
      .then((data) => {
        if (ignore) return;
        const options = data.data.map((slot) => ({
          id: slot.id,
          name: `${slot.name} • ${slot.date} ${slot.displayTime}`,
        }));
        setSlotOptions([{ id: "All", name: "All Slots" }, ...options]);
      })
      .catch((err) => {
        if (!ignore) setSlotError((err as Error).message || "Unable to load upcoming slots.");
      })
      .finally(() => {
        if (!ignore) setSlotLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    const params: AdminOrdersParams = {
      live_only: true,
      page: currentPage,
      page_size: ITEMS_PER_PAGE,
      canteen_id: !isLimitedAdmin && canteenFilter !== "All" ? canteenFilter : undefined,
      search: query.trim() || undefined,
      slot_id: slotFilter === "All" ? undefined : slotFilter,
      status: statusFilter === "All" ? undefined : stageToApiStatus(statusFilter),
    };

    if (range === "today" || range === "7d" || range === "all") {
      params.range = range;
    } else {
      const from = parseShortDateInput(customFrom);
      const to = parseShortDateInput(customTo);
      params.date_from = from ? formatApiDate(from) : undefined;
      params.date_to = to ? formatApiDate(to) : undefined;
    }

    setIsLoading(true);
    setError("");
    fetchAdminOrders(params)
      .then((data) => {
        if (ignore) return;
        setOrders(data.results);
        setServerCount(data.count);
        setServerTotalPages(data.totalPages);
      })
      .catch((err) => {
        if (!ignore) {
          setOrders([]);
          setServerCount(0);
          setServerTotalPages(1);
          setError((err as Error).message || "Failed to load orders.");
        }
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [canteenFilter, currentPage, customFrom, customTo, isLimitedAdmin, query, range, slotFilter, statusFilter]);

  return (
    <AdminLayout crumb="Live Orders">
      <div className="mb-2">
        <h1 className="text-2xl font-bold">Live Orders</h1>
        {/* <p className="text-xs text-muted-foreground">Shared order table style across admin, employee, and kitchen screens.</p> */}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>

      <div className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="TOTAL" value={counts.Total} color="text-primary" />
        <Stat label="PREPARING" value={counts.Preparing} color="text-warning" />
        <Stat label="READY" value={counts.Ready} color="text-info" />
        <Stat label="DELIVERED" value={counts.Delivered} color="text-success" />
      </div>

      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        <DataTableToolbar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search order # or customer..."
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
          extraFilters={
            <>
              {!isLimitedAdmin && (
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>Canteen</span>
                  <Select value={canteenFilter} onValueChange={setCanteenFilter}>
                    <SelectTrigger className="min-w-[180px]">
                      <SelectValue>
                        {canteenLoading
                          ? "Loading canteens..."
                          : canteenFilter === "All"
                            ? "All Canteens"
                            : canteens.find((canteen) => canteen.id === canteenFilter)?.name ?? "All Canteens"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Canteens</SelectItem>
                      {canteens.map((canteen) => (
                        <SelectItem key={canteen.id} value={canteen.id}>
                          {canteen.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Slot</span>
                <Select value={slotFilter} onValueChange={(value) => setSlotFilter(value)}>
                  <SelectTrigger className="min-w-[180px]">
                    <SelectValue>{slotLoading ? "Loading slots..." : activeSlotOptions.find((slot) => slot.id === slotFilter)?.name ?? "All Slots"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {activeSlotOptions.map((slot) => (
                      <SelectItem key={slot.id} value={slot.id}>
                        {slot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "All" | Stage)}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
                >
                  {(["All", ...STAGES] as const).map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </>
          }
        />
      </div>

      <TablePanel title="Live Orders Table" description={`${slotFilter === "All" ? serverCount : visible.length} orders matched`}>
        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading live orders...</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No live orders.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium text-primary">#{order.orderNumber ?? order.id}</TableCell>
                  <TableCell>
                    <div>
                      <div className="font-semibold">{order.customerName ?? "Employee"}</div>
                      <div className="text-xs text-muted-foreground">{order.department ?? "-"}</div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{getAdminSlotName(order)}</TableCell>
                  <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                    {(order.items ?? []).map((item: any) => `${getAdminItemQuantity(item)}x ${item.name}`).join(", ")}
                  </TableCell>
                  <TableCell className="font-semibold">{formatINR(order.total ?? order.totalAmount ?? 0)}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${stageStyle(
                        getAdminStageLabel(order.status),
                      )}`}
                    >
                      {getAdminStageLabel(order.status)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={slotFilter === "All" ? serverCount : visible.length}
          pageSize={ITEMS_PER_PAGE}
        />
      </TablePanel>
    </AdminLayout>
  );
}

function normalizeAdminStatus(status: string) {
  return String(status).trim().toLowerCase();
}

function getAdminStageLabel(status: string): Stage {
  const normalizedStatus = normalizeAdminStatus(status);

  if (normalizedStatus === "preparing") return "Preparing";
  if (normalizedStatus === "placed" || normalizedStatus === "pending" || normalizedStatus === "accepted") return "Preparing";
  if (normalizedStatus === "ready") return "Ready";
  if (normalizedStatus === "delivered") return "Delivered";
  if (normalizedStatus === "expired") return "Delivered";
  return "Preparing";
}

function stageToApiStatus(status: Stage): AdminOrdersParams["status"] {
  if (status === "Preparing") return "preparing";
  if (status === "Ready") return "ready";
  if (status === "Delivered") return "delivered";
  return "preparing";
}

function formatApiDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getAdminSlotName(order: any) {
  return order.slotName ?? order.slot ?? "Unassigned";
}

function getAdminItemQuantity(item: any) {
  return item.quantity ?? item.qty ?? 0;
}

function stageStyle(status: Stage) {
  if (status === "Preparing") return "bg-warning/20 text-warning";
  if (status === "Ready") return "bg-info/20 text-info";
  if (status === "Delivered") return "bg-success/20 text-success";
  return "bg-destructive/20 text-destructive";
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{String(value).padStart(2, "0")}</div>
    </div>
  );
}
