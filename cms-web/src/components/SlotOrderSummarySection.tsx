// Cafinity — Order Count Per Menu Item for Limited Admin
import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  fetchLiveSlots,
  fetchSlotOrderSummary,
  sendSlotSummaryEmail,
  type SlotOrderSummaryResponse,
} from "@/api/dashboard";
import { fetchSlots } from "@/api/slotapi";
import type { Slot } from "@/lib/store";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function SlotOrderSummarySection() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [summary, setSummary] = useState<SlotOrderSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetchSlots()
      .then(({ data }) => {
        const filtered = data.filter((slot) => slot.date === date);
        const options = filtered.length > 0 ? filtered : data;
        setSlots(options);

        if (options.length === 0) {
          setSlotId("");
          return;
        }

        setSlotId((current) => {
          if (current && options.some((slot) => slot.id === current)) {
            return current;
          }
          return options[0].id;
        });
      })
      .catch(() => {
        setSlots([]);
        setSlotId("");
      });
  }, [date]);

  useEffect(() => {
    fetchLiveSlots()
      .then((live) => {
        const firstActive = live.active_slots?.[0];
        if (firstActive?.slot_id) {
          setSlotId((current) => current || firstActive.slot_id);
        }
      })
      .catch(() => undefined);
  }, []);

  const selectedSlot = useMemo(
    () => slots.find((slot) => slot.id === slotId),
    [slots, slotId],
  );

  const loadSummary = useCallback(async () => {
    if (!slotId) return;
    setLoading(true);
    try {
      const data = await fetchSlotOrderSummary({
        slot_id: slotId,
        date: selectedSlot?.date || date,
      });
      setSummary(data);
    } catch (err) {
      setSummary(null);
      toast.error((err as Error).message || "Failed to load order summary.");
    } finally {
      setLoading(false);
    }
  }, [slotId, date, selectedSlot?.date]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleSendEmail = async () => {
    if (!slotId) return;
    setSending(true);
    try {
      await sendSlotSummaryEmail(slotId);
      toast.success("Summary email sent.");
    } catch (err) {
      toast.error((err as Error).message || "Failed to send summary email.");
    } finally {
      setSending(false);
    }
  };

  const hasLineItems = (summary?.items?.length ?? 0) > 0;
  const orderCount = summary?.totals?.order_count ?? 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Order Summary</h3>
          <p className="text-sm text-muted-foreground">Per menu item counts for the selected slot.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
          />
          <select
            value={slotId}
            onChange={(event) => setSlotId(event.target.value)}
            className="h-10 min-w-[180px] rounded-xl border border-border bg-background px-3 text-sm"
          >
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => loadSummary()}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleSendEmail}
            disabled={sending || !slotId}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            <Mail className="h-4 w-4" />
            {sending ? "Sending..." : "Send Summary Email Now"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-muted-foreground">Loading summary...</div>
      ) : !hasLineItems ? (
        <div className="mt-6 text-sm text-muted-foreground">
          {orderCount > 0
            ? `${orderCount} order(s) found for this slot, but no menu line items are recorded yet.`
            : "No orders for this slot yet."}
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2">Menu Item</th>
                <th className="px-3 py-2">Ordered</th>
                <th className="px-3 py-2">Delivered</th>
                <th className="px-3 py-2">Pending</th>
              </tr>
            </thead>
            <tbody>
              {summary?.items?.map((item) => (
                <tr
                  key={item.item_id}
                  className={item.pending > 0 ? "bg-amber-500/10" : "border-b border-border/60"}
                >
                  <td className="px-3 py-2 font-medium">{item.item_name}</td>
                  <td className="px-3 py-2">{item.total_ordered}</td>
                  <td className="px-3 py-2 text-emerald-600">{item.delivered}</td>
                  <td className="px-3 py-2 text-amber-600">{item.pending}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="px-3 py-2">TOTAL</td>
                <td className="px-3 py-2">{summary?.totals?.total_ordered ?? 0}</td>
                <td className="px-3 py-2 text-emerald-600">{summary?.totals?.delivered ?? 0}</td>
                <td className="px-3 py-2 text-amber-600">{summary?.totals?.pending ?? 0}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
