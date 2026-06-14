import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Clock3, RefreshCw, BellRing } from "lucide-react";

import { fetchKitchenOrders } from "@/api/kitchen";
import { getCurrentUser } from "@/lib/auth";
import type { Order } from "@/lib/store";
import { KitchenLayout } from "./kitchen";

export const Route = createFileRoute("/ready-screen")({
  beforeLoad: () => {
    const user = getCurrentUser();
    if (!user || user.role !== "kitchen") {
      throw redirect({ to: "/login" });
    }
  },
  component: ReadyScreen,
});

const REFRESH_MS = 10_000;

function ReadyScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());

  const loadReadyOrders = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError("");

    try {
      const kitchenOrders = await fetchKitchenOrders();
      setOrders(kitchenOrders.filter((order) => order.status === "ready"));
      setLastUpdated(new Date());
    } catch (err) {
      setOrders([]);
      setError((err as Error).message || "Could not load ready orders.");
    }

    if (!silent) setIsLoading(false);
  };

  useEffect(() => {
    void loadReadyOrders();

    const refreshTimer = window.setInterval(() => {
      void loadReadyOrders(true);
    }, REFRESH_MS);

    const clockTimer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  const sortedOrders = useMemo(
    () =>
      [...orders].sort(
        (a, b) =>
          new Date(a.updatedAt ?? a.createdAt).getTime() -
          new Date(b.updatedAt ?? b.createdAt).getTime(),
      ),
    [orders],
  );

  return (
    <KitchenLayout title="Ready Screen | Pickup Display">
      <div className="min-h-screen bg-[linear-gradient(180deg,#fff7ed_0%,#fffdf8_48%,#fff2df_100%)] text-[#241407]">
      <div className="mx-auto flex min-h-screen max-w-[1900px] flex-col px-4 py-4 md:px-8">
        <header className="mb-5 overflow-hidden rounded-[28px] border border-[#f0d8bd] bg-[linear-gradient(135deg,#fffaf4_0%,#fff3e2_56%,#ffe0bd_100%)] shadow-[0_24px_70px_rgba(137,72,12,0.16)]">
          <div className="flex flex-wrap items-center justify-between gap-5 px-6 py-5 md:px-8">
            <div>
              <div className="text-[13px] font-black uppercase tracking-[0.35em] text-[#ff9d42]">
                Now Ready
              </div>
              <h1 className="mt-2 text-4xl font-black tracking-tight md:text-6xl">
                Collect Your Order
              </h1>
              <p className="mt-2 text-base font-semibold text-[#8a5b31] md:text-xl">
                Match your order token at the pickup counter.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-[22px] border border-[#f1cda6] bg-white/78 px-5 py-4 shadow-sm">
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#b86618]">Ready</div>
                <div className="mt-1 text-5xl font-black leading-none text-[#ff9d42]">
                  {String(sortedOrders.length).padStart(2, "0")}
                </div>
              </div>
              <div className="rounded-[22px] border border-[#f1cda6] bg-white/78 px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#8a5b31]">
                  <Clock3 className="h-4 w-4" />
                  Time
                </div>
                <div className="mt-1 text-3xl font-black leading-none md:text-4xl">
                  {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
              <button
                onClick={() => void loadReadyOrders()}
                className="inline-flex items-center gap-2 rounded-[22px] bg-[#ff8a1f] px-5 py-4 text-base font-black text-white shadow-[0_18px_40px_rgba(255,138,31,0.32)] transition hover:bg-[#ff9a32]"
              >
                <RefreshCw className="h-5 w-5" />
                Refresh
              </button>
            </div>
          </div>

        </header>

        {error && (
          <div className="mb-5 rounded-[24px] border border-red-300 bg-red-50 px-5 py-4 text-base font-semibold text-red-700">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-[28px] border border-[#f0d8bd] bg-white px-8 py-10 text-center shadow-[0_24px_70px_rgba(137,72,12,0.16)]">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#f3dfc7] border-t-[#ff9d42]" />
              <div className="text-xl font-bold text-[#241407]">Loading ready orders...</div>
            </div>
          </div>
        ) : sortedOrders.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-4xl rounded-[40px] border border-[#f0d8bd] bg-white/82 px-8 py-16 text-center shadow-[0_24px_70px_rgba(137,72,12,0.16)]">
              <BellRing className="mx-auto h-20 w-20 text-[#ff9d42]" />
              <h2 className="mt-6 text-5xl font-black">No Ready Orders</h2>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-[minmax(96px,1fr)] grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {sortedOrders.map((order, index) => {
              const code = order.orderNumber ?? order.id;
              const parts = splitOrderCode(code);

              return (
                <div
                  key={order.id}
                  className="relative flex min-h-[96px] overflow-hidden rounded-[20px] border border-[#f0d8bd] bg-[linear-gradient(145deg,#ffffff_0%,#fff8ef_62%,#ffe7ca_100%)] p-3 shadow-[0_16px_36px_rgba(137,72,12,0.14)]"
                >
                  <div className="absolute right-[-2rem] top-[-2rem] h-20 w-20 rounded-full bg-[#ff8a1f]/16" />
                  <div className="absolute bottom-0 left-0 h-1 w-full bg-[#ff8a1f]" />

                  <div className="relative flex w-full flex-col items-center justify-center text-center">
                    <div className="flex items-center justify-between gap-3">
                      <span className="absolute right-0 top-0 text-[11px] font-black text-[#9a6a3d]/55">
                        #{String(index + 1).padStart(2, "0")}
                      </span>
                    </div>

                    <div>
                      {parts.prefix && (
                        <div className="mb-1 text-sm font-black uppercase tracking-[0.22em] text-[#c76c16]">
                          {parts.prefix}
                        </div>
                      )}
                      <div className="break-all text-[clamp(1.9rem,3.1vw,4.25rem)] font-black leading-[0.9] tracking-normal text-[#241407]">
                        {parts.main}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[#f0d8bd] bg-white/78 px-5 py-4 text-base font-semibold text-[#8a5b31] shadow-[0_16px_36px_rgba(137,72,12,0.1)]">
          <div>Auto refresh every 10 seconds</div>
          <div>
            Last updated:{" "}
            {lastUpdated
              ? lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
              : "--:--:--"}
          </div>
        </footer>
      </div>
      </div>
    </KitchenLayout>
  );
}

function splitOrderCode(code: string) {
  const trimmed = String(code).trim();
  const match = trimmed.match(/^([A-Z]+)-(.+)$/);
  if (!match) return { prefix: "", main: trimmed };
  return { prefix: `${match[1]}-`, main: match[2] };
}
