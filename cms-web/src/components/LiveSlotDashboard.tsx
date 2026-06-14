// Cafinity — Live Slot Dashboard Widget
import { useEffect, useState } from "react";
import { fetchLiveSlots, type LiveSlotsResponse } from "@/api/dashboard";

const POLL_MS = 30_000;

export function LiveSlotDashboard() {
  const [data, setData] = useState<LiveSlotsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    const load = async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const response = await fetchLiveSlots();
        if (!ignore) {
          setData(response);
          setError("");
        }
      } catch (err) {
        if (!ignore) {
          setError((err as Error).message || "Failed to load live slots.");
        }
      } finally {
        if (!ignore && !silent) setLoading(false);
      }
    };

    load();
    const timer = setInterval(() => load(true), POLL_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Loading live slot overview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const activeSlots = data?.active_slots ?? [];
  const nextSlot = data?.next_slot;

  if (activeSlots.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />
          No active slot right now
        </div>
        {nextSlot ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Next upcoming: <span className="font-semibold text-foreground">{nextSlot.slot_name}</span> at{" "}
            <span className="font-semibold text-foreground">{nextSlot.start_time}</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activeSlots.map((slot) => {
        const progress =
          slot.total_orders > 0 ? Math.round((slot.delivered_orders / slot.total_orders) * 100) : 0;
        return (
          <div key={slot.slot_id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <span className="relative inline-flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="uppercase tracking-wide text-emerald-600">Live</span>
              <span className="text-foreground">{slot.slot_name}</span>
              <span className="text-muted-foreground">
                {slot.start_time} – {slot.end_time}
              </span>
              {slot.canteen_name ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {slot.canteen_name}
                </span>
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-muted/40 p-3">
                <div className="text-xs uppercase text-muted-foreground">Total Orders</div>
                <div className="mt-1 text-2xl font-bold">{slot.total_orders}</div>
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3">
                <div className="text-xs uppercase text-emerald-700">Delivered</div>
                <div className="mt-1 text-2xl font-bold text-emerald-600">{slot.delivered_orders}</div>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-3">
                <div className="text-xs uppercase text-amber-700">Pending</div>
                <div className="mt-1 text-2xl font-bold text-amber-600">{slot.pending_orders}</div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
