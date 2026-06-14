import { createFileRoute } from "@tanstack/react-router";
import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { fetchKitchenOrderHistory } from "@/api/kitchen";
import {
  DataTableToolbar,
  formatShortDateInput,
  parseShortDateInput,
} from "@/components/DataTableToolbar";
import { Pagination } from "@/components/Pagination";
import { TablePanel } from "@/components/TablePanel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { downloadCSV, formatINR, type Order } from "@/lib/store";
import { KitchenLayout } from "./kitchen";

export const Route = createFileRoute("/kitchen-history")({ component: KitchenHistory });

const PAGE_SIZE = 8;
type HistoryRange = "24h" | "7d" | "all" | "custom";

function KitchenHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<HistoryRange>("24h");
  const [slotFilter, setSlotFilter] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [customFrom, setCustomFrom] = useState(
    formatShortDateInput(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)),
  );
  const [customTo, setCustomTo] = useState(formatShortDateInput(new Date()));

  const loadHistory = useCallback(async () => {
    const today = new Date();
    const params: Parameters<typeof fetchKitchenOrderHistory>[0] = {};

    if (range === "24h") {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      params.date_from = toApiDate(yesterday);
      params.date_to = toApiDate(today);
    } else if (range === "7d") {
      const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      params.date_from = toApiDate(weekAgo);
      params.date_to = toApiDate(today);
    } else if (range === "custom") {
      const from = parseShortDateInput(customFrom);
      const to = parseShortDateInput(customTo);
      if (from) params.date_from = toApiDate(from);
      if (to) params.date_to = toApiDate(to);
    } else {
      params.all = true;
    }

    try {
      setIsLoading(true);
      setError("");
      const nextOrders = await fetchKitchenOrderHistory(params);
      setOrders(nextOrders);
    } catch (err) {
      setOrders([]);
      setError((err as Error).message || "Could not load kitchen history.");
      toast.error((err as Error).message || "Could not load kitchen history.");
    } finally {
      setIsLoading(false);
    }
  }, [customFrom, customTo, range]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const completedOrders = useMemo(
    () => [...orders].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [orders],
  );

  const slotOptions = useMemo(
    () => ["All", ...Array.from(new Set(completedOrders.map((order) => order.slotName).filter(Boolean)))],
    [completedOrders],
  );

  const filteredOrders = useMemo(() => {
    const now = Date.now();
    return completedOrders.filter((order) => {
      const updatedAt = new Date(order.updatedAt).getTime();
      if (range === "24h" && now - updatedAt > 24 * 60 * 60 * 1000) return false;
      if (range === "7d" && now - updatedAt > 7 * 24 * 60 * 60 * 1000) return false;
      if (range === "custom") {
        const from = parseShortDateInput(customFrom);
        const to = parseShortDateInput(customTo);
        if (from && updatedAt < from.setHours(0, 0, 0, 0)) return false;
        if (to && updatedAt > to.setHours(23, 59, 59, 999)) return false;
      }
      if (slotFilter !== "All" && order.slotName !== slotFilter) return false;
      return true;
    });
  }, [completedOrders, customFrom, customTo, range, slotFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [range, slotFilter]);

  const handleExport = () => {
    if (filteredOrders.length === 0) return;

    const rows = filteredOrders.map((order) => ({
      "Order ID": order.orderNumber ?? order.id,
      Employee: order.customerName ?? "Employee",
      Department: order.department ?? "-",
      Slot: order.slotName ?? "-",
      Items: (order.items ?? []).map((item) => `${item.quantity}x ${item.name}`).join(", "),
      Total: formatINR(order.total ?? order.totalAmount ?? 0),
      "Completed At": new Date(order.updatedAt).toLocaleString(),
      Status: order.status,
    }));

    downloadCSV(rows, `kitchen-history-${range}-${slotFilter.toLowerCase()}`);
  };

  return (
    <KitchenLayout title="Order History">
      <div className="mb-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-border bg-card p-4">
          <DataTableToolbar
            options={[
              { value: "24h", label: "Last 24 Hours" },
              { value: "7d", label: "Last 7 Days" },
              { value: "all", label: "All Time" },
              { value: "custom", label: "Custom" },
            ]}
            activeOption={range}
            onOptionChange={(value) => {
              setRange(value as HistoryRange);
              setPage(1);
            }}
            fromValue={customFrom}
            toValue={customTo}
            onFromChange={setCustomFrom}
            onToChange={setCustomTo}
            extraFilters={
              <select
                value={slotFilter}
                onChange={(event) => {
                  setSlotFilter(event.target.value);
                  setPage(1);
                }}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
              >
                {slotOptions.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            }
            actions={
              <div className="flex gap-2">
                <button
                  onClick={loadHistory}
                  className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
                <button
                  onClick={handleExport}
                  disabled={filteredOrders.length === 0}
                  className="flex items-center gap-1 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
                >
                  <Download className="h-3 w-3" /> Excel
                </button>
              </div>
            }
          />
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="text-[10px] tracking-widest text-muted-foreground">Total Orders</div>
          <div className="mt-2 text-3xl font-bold text-primary">{filteredOrders.length}</div>
        </div>
      </div>

      <TablePanel title="Order History" description={`${filteredOrders.length} completed orders found`}>
        {error && <div className="px-5 py-3 text-sm text-destructive">{error}</div>}
        {isLoading ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">
            Loading order history...
          </div>
        ) : pagedOrders.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground">
            No completed orders match this filter.
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
                <TableHead>Completed</TableHead>
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
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(order.updatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        order.status === "delivered"
                          ? "bg-emerald-500/15 text-emerald-600"
                          : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {order.status.toUpperCase()}
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
          totalItems={filteredOrders.length}
          pageSize={PAGE_SIZE}
        />
      </TablePanel>
    </KitchenLayout>
  );
}

function toApiDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
