import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingBag, TrendingUp, Package, Users,
  Sunrise, UtensilsCrossed, Cookie, Moon, Flame,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchAdminDashboard, type AdminDashboardStats } from "@/api/admin";
import { LiveSlotDashboard } from "@/components/LiveSlotDashboard";
import { SlotOrderSummarySection } from "@/components/SlotOrderSummarySection";
import { getExactRoleType } from "../admin-orders";
import { getCurrentUser } from "@/lib/auth";
import { AdminLayout } from "../admin-orders";

export const Route = createFileRoute("/admin/")({ component: Admin });

/* ─── Mouse-tracking glow hook ─── */
function useBentoGlow() {
  const gridRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = grid.querySelectorAll<HTMLElement>(".bento-card");
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside =
        x >= -40 && x <= rect.width + 40 && y >= -40 && y <= rect.height + 40;
      card.style.setProperty("--glow-x", `${x}px`);
      card.style.setProperty("--glow-y", `${y}px`);
      card.style.setProperty("--glow-intensity", inside ? "1" : "0");
    });
  }, []);

  const handlePointerLeave = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.querySelectorAll<HTMLElement>(".bento-card").forEach((card) => {
      card.style.setProperty("--glow-intensity", "0");
    });
  }, []);

  return { gridRef, handlePointerMove, handlePointerLeave };
}

/* ─── Slot config ─── */
const SLOT_META: Record<string, { icon: LucideIcon; accent: string; bg: string }> = {
  Breakfast: { icon: Sunrise,            accent: "text-primary",          bg: "bg-muted" },
  Lunch:     { icon: UtensilsCrossed,    accent: "text-primary",          bg: "bg-muted" },
  Snacks:    { icon: Cookie,             accent: "text-primary",          bg: "bg-muted" },
  Dinner:    { icon: Moon,               accent: "text-primary",          bg: "bg-muted" },
};

function Admin() {
  const { gridRef, handlePointerMove, handlePointerLeave } = useBentoGlow();
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const roleType = getExactRoleType(getCurrentUser());
  const isLimitedAdmin = roleType === "LIMITED_ADMIN";

  const loadDashboard = async (isRetry = false) => {
    if (isRetry) setIsRetrying(true);
    setIsLoading(true);
    try {
      const data = await fetchAdminDashboard();
      setStats(data);
      setCardErrors({});
    } catch (err) {
      setCardErrors({
        todayOrders: (err as Error).message || "Could not load",
        todayRevenue: (err as Error).message || "Could not load",
      });
      if (!isRetry) {
        window.setTimeout(() => {
          void loadDashboard(true);
        }, 3000);
      }
    } finally {
      setIsLoading(false);
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const slotCounts = useMemo(
    () => stats?.slotCounts?.length ? stats.slotCounts : [{ slot: "No Slots", orders: 0, slotId: "" }],
    [stats],
  );

  const liveStatusData = [
    { status: "Pending", count: (stats?.statusCounts.placed ?? 0) + (stats?.statusCounts.preparing ?? 0) + (stats?.statusCounts.ready ?? 0) },
    { status: "Delivered", count: stats?.statusCounts.delivered ?? 0 },
  ];

  const activeStatusCount = liveStatusData.reduce((sum, item) => sum + item.count, 0);
  const peakSlot = slotCounts.reduce((max, s) => (s.orders > max.orders ? s : max), slotCounts[0]);

  return (
    <AdminLayout crumb="Dashboard">
      <div className="space-y-6 p-2 md:p-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          {isRetrying ? <p className="mt-2 text-xs text-muted-foreground">Retrying...</p> : null}
          {isLoading ? <p className="mt-2 text-xs text-muted-foreground">Loading dashboard...</p> : null}
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Live Slot Overview</h2>
          <LiveSlotDashboard />
        </div>

        {isLimitedAdmin ? <SlotOrderSummarySection /> : null}

        <div
          ref={gridRef}
          className="grid grid-cols-1 gap-4 lg:grid-cols-12"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <StatCard
            icon={ShoppingBag}
            label="Today's Orders"
            value={cardErrors.todayOrders ? "—" : String(stats?.todayOrders ?? 0)}
            accent="text-primary"
            className="lg:order-1 lg:col-span-6"
          />

          <div className="bento-card min-h-[180px] lg:order-2 lg:col-span-6">
            <div className="relative z-10 flex h-full flex-col">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight text-foreground">
                  Order Volume by Slot
                </h2>
                <span className="rounded-lg bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  {slotCounts.reduce((sum, slot) => sum + slot.orders, 0)} total
                </span>
              </div>

              <div className="mt-5 grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                {slotCounts.map((slot) => {
                  const meta = SLOT_META[slot.slot] ?? { icon: Package, accent: "text-primary", bg: "bg-muted" };
                  const SlotIcon = meta.icon;
                  const isPeak = slot === peakSlot && slot.orders > 0;
                  return (
                    <div
                      key={slot.slot}
                      className={`group relative flex flex-col justify-between rounded-2xl border border-border/60 ${meta.bg} p-4 transition-all duration-300 hover:scale-[1.03] hover:shadow-lg`}
                      style={{ minHeight: 100 }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <SlotIcon className={`h-4 w-4 ${meta.accent}`} />
                          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            {slot.slot}
                          </span>
                        </div>
                        {isPeak && (
                          <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold text-primary">
                            <Flame className="h-3 w-3" /> PEAK
                          </span>
                        )}
                      </div>
                      <div className="mt-3">
                        <span className={`text-3xl font-black ${meta.accent}`}>
                          {slot.orders}
                        </span>
                        <span className="ml-1.5 text-xs text-muted-foreground">orders</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            className="bento-card min-h-[360px] border-[#efcfad] bg-[#fff8ef] shadow-[0_18px_40px_rgba(245,128,32,0.08)] dark:border-[#4a2b16] dark:bg-[#20120d] dark:shadow-none lg:order-3 lg:col-span-6"
          >
            <div className="relative z-10 flex h-full flex-col">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Live Mix</span>
                  </div>
                  <h2 className="mt-1 text-lg font-bold tracking-tight text-foreground">
                    Status Distribution
                  </h2>
                </div>
                <div className="rounded-xl border border-[#ead8c8] bg-[#fff3e8] px-4 py-2.5 text-right dark:border-[#4e301d] dark:bg-[#2a1912]">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8d715b] dark:text-[#c7aa91]">
                    Active Orders
                  </div>
                  <div className="mt-0.5 text-2xl font-black text-[#f57c14] dark:text-primary">
                    {activeStatusCount}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex-1">
                {activeStatusCount === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-border py-12 text-center">
                    <Package className="h-10 w-10 text-muted-foreground/40" />
                    <p className="mt-2 text-sm text-muted-foreground">No active orders</p>
                  </div>
                ) : (
                  <StatusStickChart data={liveStatusData} />
                )}
              </div>
            </div>
          </div>

          <OperationalSnapshotCard
            activeUsers={stats?.activeUsers ?? 0}
            readyOrders={stats?.statusCounts.ready ?? 0}
            data={liveStatusData}
          />
        </div>
      </div>
    </AdminLayout>
  );
}

function StatusStickChart({
  data,
}: {
  data: Array<{ status: string; count: number }>;
}) {
  const maxCount = Math.max(...data.map((item) => item.count), 1);

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-[#e6ccb5] bg-[#f7eadf] px-5 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_18px_40px_rgba(160,103,54,0.10)] dark:border-[#5c3827] dark:bg-[#2a1812] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_40px_rgba(0,0,0,0.32)]">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div
          className="absolute inset-0 dark:hidden"
          style={{
            backgroundImage:
              "linear-gradient(rgba(140,88,46,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(140,88,46,0.07) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div
          className="absolute inset-0 hidden dark:block"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="absolute -right-10 top-0 h-28 w-28 rounded-full bg-[#ffb36a]/18 blur-2xl dark:bg-[#ff9b54]/12" />
        <div className="absolute left-1/2 top-8 h-24 w-24 -translate-x-1/2 rounded-full bg-[#ff8d8d]/10 blur-3xl dark:bg-[#ff5e8a]/10" />
      </div>

      <div className="relative z-10 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 sm:gap-5">
        {data.map((item) => {
          const height = item.count === 0 ? 0 : Math.max(28, Math.round((item.count / maxCount) * 138));
          return (
            <div key={item.status} className="flex flex-col items-center text-center">
              <div className="mb-4 min-h-[36px] rounded-full bg-[#ead7c5]/95 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.26em] text-[#6f5039] dark:bg-[#4a2d20]/90 dark:text-[#f5d8c1]">
                {item.status}
              </div>
              <div className="relative flex h-[156px] items-end justify-center">
                <div className="absolute bottom-0 top-0 w-3 rounded-full bg-[#d8c0ad] dark:bg-[#65473b]" />
                <div
                  className="relative z-10 w-3 rounded-full shadow-[0_0_18px_rgba(255,136,92,0.45)]"
                  style={{
                    height: `${height}px`,
                    background: "linear-gradient(180deg, #ffd17f 0%, #ffa26a 35%, #ff6d7a 70%, #e6538f 100%)",
                  }}
                />
                <div className="absolute bottom-0 w-8 border-b border-[#bb9a81]/45 dark:border-[#9f7764]/25" />
              </div>
              <div className="mt-4 text-2xl font-black tracking-tight text-[#2e1a11] dark:text-[#fff3e7]">
                {item.count}
              </div>
              <div className="mt-1 text-[11px] font-medium text-[#866850] dark:text-[#cfb29e]">
                live orders
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OperationalSnapshotCard({
  activeUsers,
  readyOrders,
  data,
}: {
  activeUsers: number;
  readyOrders: number;
  data: Array<{ status: string; count: number }>;
}) {
  const total = Math.max(data.reduce((sum, item) => sum + item.count, 0), 1);

  return (
    <div className="bento-card min-h-[360px] lg:order-4 lg:col-span-6">
      <div className="relative z-10 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-blue-500 dark:text-blue-400">
          <Users className="h-5 w-5" />
        </div>
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>
      </div>

      <div className="relative z-10 mt-5">
        <h2 className="text-lg font-bold tracking-tight text-foreground">Operational Snapshot</h2>
      </div>

      <div className="relative z-10 mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SnapshotMetric
          icon={Users}
          label="Active Users"
          value={String(activeUsers)}
          tone="text-blue-500"
        />
        <SnapshotMetric
          icon={Package}
          label="Ready Now"
          value={String(readyOrders)}
          tone="text-emerald-600"
        />
      </div>

      <div className="relative z-10 mt-6 space-y-3">
        {data.map((item) => {
          const width = Math.round((item.count / total) * 100);
          return (
            <div key={item.status}>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">{item.status}</span>
                <span className="font-bold text-foreground">{item.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SnapshotMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/60 p-3">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-background ${tone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className={`mt-3 text-2xl font-black ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  className = "",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent: string;
  className?: string;
}) {
  return (
    <div className={`bento-card min-h-[180px] ${className}`}>
      <div className="relative z-10 flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>
      </div>
      <div className="relative z-10 mt-auto pt-4">
        <div className={`text-3xl font-black tracking-tight ${accent}`}>
          {value}
        </div>
        <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}
