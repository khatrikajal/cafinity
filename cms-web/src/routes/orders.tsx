import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Clock,
  Package,
  Plus,
  ShoppingBag,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cancelEmployeeOrder, fetchEmployeeMenu, fetchEmployeeOrders } from "@/api/employeeOrders";
import { AppLayout } from "@/components/AppLayout";
import { Pagination } from "@/components/Pagination";
import { TablePanel } from "@/components/TablePanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatINR,
  useCurrentCustomer,
  useEntities,
  type Order,
  type OrderStatusLog,
  type OrderStatus,
  type Slot,
} from "@/lib/store/index";

export const Route = createFileRoute("/orders")({ component: Orders });

type FilterStatus = "all" | "active" | "delivered" | "cancelled" | "expired";

const PAGE_SIZE = 5;
const CANCELLATION_REASONS = [
  "Ordered by mistake",
  "Changed my mind",
  "Selected wrong item",
  "Selected wrong slot",
  "Taking food from outside",
  "Other",
];

function Orders() {
  const navigate = useNavigate();
  const currentCustomer = useCurrentCustomer();
  const storedOrders = useEntities<Order>("orders");
  const storedMealSlots = useEntities<Slot>("slots");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [mounted, setMounted] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [remoteOrders, setRemoteOrders] = useState<Order[] | null>(null);
  const [remoteMealSlots, setRemoteMealSlots] = useState<Slot[] | null>(null);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState(CANCELLATION_REASONS[0]);
  const [customCancelReason, setCustomCancelReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const allOrders = useMemo(() => (remoteOrders ?? storedOrders).map(normalizeOrderForUi), [remoteOrders, storedOrders]);
  const mealSlots = remoteMealSlots ?? storedMealSlots;

  const userOrders = useMemo(() => {
    if (remoteOrders) return allOrders;
    if (!currentCustomer) return [];
    return allOrders.filter((order) => order.customerId === currentCustomer.id);
  }, [allOrders, currentCustomer, remoteOrders]);

  const activeOrders = useMemo(
    () => userOrders.filter((order) => ["pending", "placed", "preparing", "ready"].includes(order.status)),
    [userOrders],
  );
  const orderSlots = useMemo(() => {
    const byId = new Map(mealSlots.map((slot) => [slot.id, slot]));
    const seen = new Set<string>();
    return activeOrders
      .map((order) => {
        if (!order.slotId || seen.has(order.slotId)) return null;
        seen.add(order.slotId);
        return byId.get(order.slotId) ?? {
          id: order.slotId,
          name: order.slotName ?? "Slot",
          status: "upcoming" as Slot["status"],
          date: "",
          startTime: "",
          endTime: "",
          active: true,
          menuItemIds: [],
        };
      })
      .filter((slot): slot is Slot => Boolean(slot));
  }, [activeOrders, mealSlots]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let ignore = false;

    const loadOrders = () =>
      Promise.all([fetchEmployeeOrders(), fetchEmployeeMenu()])
        .then(([orders, menu]) => {
          if (ignore) return;
          setRemoteOrders(orders);
          setRemoteMealSlots(menu.slots);
        })
        .catch(() => {
          if (!ignore) {
            toast.error("Could not load orders from server.");
          }
        });

    loadOrders();
    const timer = setInterval(loadOrders, 15_000);

    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setSelectedSlotId((prev) => prev && orderSlots.some((slot) => slot.id === prev) ? prev : orderSlots[0]?.id ?? null);
  }, [orderSlots]);

  const activeOrdersForSlot = useMemo(() => {
    const activeStatuses: OrderStatus[] = ["pending", "placed", "preparing", "ready"];
    return userOrders.filter(
      (order) => order.slotId === selectedSlotId && activeStatuses.includes(order.status),
    );
  }, [selectedSlotId, userOrders]);

  useEffect(() => {
    if (activeOrdersForSlot.length === 0) {
      setSelectedOrderId(null);
      return;
    }

    const hasSelectedOrder = activeOrdersForSlot.some((order) => order.id === selectedOrderId);
    if (!hasSelectedOrder) {
      setSelectedOrderId(activeOrdersForSlot[0].id);
    }
  }, [activeOrdersForSlot, selectedOrderId]);

  const activeOrder = activeOrdersForSlot.find((order) => order.id === selectedOrderId) ?? null;

  const filteredOrders = userOrders.filter((order) => {
    if (filter === "all") return true;
    if (filter === "active")
      return ["placed", "preparing", "ready"].includes(order.status);
    if (filter === "delivered")
      return order.status === "delivered";
    if (filter === "cancelled") return order.status === "cancelled";
    return order.status === "expired";
  });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const pagedOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const filters: Array<{ value: FilterStatus; label: string }> = [
    { value: "all", label: "All Orders" },
    { value: "active", label: "Active" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
    { value: "expired", label: "Expired" },
  ];

  const openCancelDialog = (order: Order) => {
    setCancelOrder(order);
    setCancelReason(CANCELLATION_REASONS[0]);
    setCustomCancelReason("");
  };

  const closeCancelDialog = () => {
    if (isCancelling) return;
    setCancelOrder(null);
    setCustomCancelReason("");
    setCancelReason(CANCELLATION_REASONS[0]);
  };

  const handleCancelOrder = async () => {
    if (!cancelOrder) return;

    const reason = cancelReason === "Other" ? customCancelReason.trim() : cancelReason;
    if (!reason) {
      toast.error("Please enter a cancellation reason.");
      return;
    }

    try {
      setIsCancelling(true);
      const cancelled = normalizeOrderForUi(await cancelEmployeeOrder(cancelOrder.id, reason));
      setRemoteOrders((orders) => (orders ?? allOrders).map((order) => (order.id === cancelOrder.id ? cancelled : order)));
      setCancelOrder(null);
      toast.success("Order cancelled");
    } catch (error) {
      toast.error((error as Error).message || "Could not cancel order.");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <AppLayout title="Orders">
      <div
        className={`space-y-6 transition-opacity duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Your Orders</h1>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {orderSlots.map((slot) => {
              const isSelected = selectedSlotId === slot.id;
              const isActive = slot.status === "active";
              return (
                <button
                  key={slot.id}
                  onClick={() => setSelectedSlotId(slot.id)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                    isSelected
                      ? "bg-primary text-white shadow-md shadow-primary/20"
                      : isActive
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  {slot.name}
                </button>
              );
            })}
          </div>

          {activeOrdersForSlot.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 py-8 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                No active orders for this slot.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-6 rounded-xl bg-muted/30 p-4">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Select Order
                </label>
                <Select value={selectedOrderId ?? ""} onValueChange={setSelectedOrderId}>
                  <SelectTrigger className="w-full rounded-xl border-border bg-background px-4 py-2.5 text-left text-sm font-semibold sm:max-w-md">
                    <SelectValue placeholder="Select order" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeOrdersForSlot.map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {`${order.orderNumber ?? order.id} - ${order.items.map((item) => item.name ?? "Item").join(", ")} - ${formatINR(order.total ?? 0)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {activeOrder && (
                <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-orange-500/5 p-6 shadow-lg shadow-primary/5">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="font-bold">Current Order</h2>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusColor(activeOrder.status)}`}
                          >
                            {getDisplayStatusLabel(activeOrder.status).toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm text-primary">{activeOrder.orderNumber}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">
                        {formatINR(activeOrder.total ?? 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activeOrder.items.length} items
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-card/80 p-4 backdrop-blur">
                    <div className="space-y-2">
                      {activeOrder.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
                              {item.quantity}x
                            </span>
                            <span className="font-medium">{item.name}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {formatINR((item.unitPrice ?? item.price ?? 0) * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {canCancel(activeOrder.status) && (
                      <div className="mt-4 border-t border-border pt-4">
                        <button
                          onClick={() => openCancelDialog(activeOrder)}
                          className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm font-semibold text-destructive transition-all hover:bg-destructive/10 active:scale-95"
                        >
                          Cancel Order
                        </button>
                      </div>
                    )}

                    {activeOrder.statusLogs && activeOrder.statusLogs.length > 0 && (
                      <div className="mt-4 border-t border-border pt-4">
                        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Status Timeline
                        </p>
                        <div className="space-y-3">
                          {activeOrder.statusLogs.map((entry: OrderStatusLog) => (
                            <div key={entry.id} className="flex items-start gap-3 text-sm">
                              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium capitalize">{entry.toStatus}</span>
                                  {entry.changedByRole && (
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      {entry.changedByRole}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {formatOrderDate(entry.changedAt)} {formatOrderTime(entry.changedAt)}
                                  {entry.note ? ` · ${entry.note}` : ""}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
            {filters.map((item) => (
              <button
                key={item.value}
                onClick={() => {
                  setFilter(item.value);
                  setPage(1);
                }}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  filter === item.value
                    ? "bg-primary text-white shadow-lg shadow-primary/30"
                    : "border border-border bg-card hover:bg-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <TablePanel title="Order History" description={`${filteredOrders.length} orders found`}>
          {filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Package className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 font-semibold">No orders found</h3>
              <button
                onClick={() => navigate({ to: "/menu" })}
                className="mt-4 flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
              >
                <Plus className="h-4 w-4" />
                Browse Menu
              </button>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Slot</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Placed At</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium text-primary">#{order.orderNumber ?? order.id}</TableCell>
                      <TableCell className="text-muted-foreground">{order.slotName ?? "Unassigned"}</TableCell>
                      <TableCell className="max-w-[360px] text-sm text-muted-foreground">
                        {order.items.map((item) => `${item.quantity}x ${item.name ?? "Item"}`).join(", ")}
                      </TableCell>
                      <TableCell className="font-semibold">{formatINR(order.total ?? order.totalAmount ?? 0)}</TableCell>
                      <TableCell>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${getStatusColor(order.status)}`}>
                          {getDisplayStatusLabel(order.status)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatOrderDate(order.createdAt)} {formatOrderTime(order.createdAt)}
                      </TableCell>
                      <TableCell>
                        {canCancel(order.status) ? (
                          <button
                            onClick={() => openCancelDialog(order)}
                            className="text-xs font-semibold text-destructive hover:underline"
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDetailOrder(order)}
                            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            View Details <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                totalItems={filteredOrders.length}
                pageSize={PAGE_SIZE}
              />
            </>
          )}
        </TablePanel>
      </div>

      {detailOrder && (
        <OrderDetailsModal
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onCancel={
            canCancel(detailOrder.status)
              ? () => {
                  setDetailOrder(null);
                  openCancelDialog(detailOrder);
                }
              : undefined
          }
        />
      )}

      {cancelOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeCancelDialog();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Cancel Order</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select a reason for cancelling {cancelOrder.orderNumber}.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCancelDialog}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {CANCELLATION_REASONS.map((reason) => (
                <label
                  key={reason}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all ${
                    cancelReason === reason
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="cancel-reason"
                    checked={cancelReason === reason}
                    onChange={() => setCancelReason(reason)}
                    className="accent-primary"
                  />
                  <span className="font-medium">{reason}</span>
                </label>
              ))}
            </div>

            {cancelReason === "Other" && (
              <div className="mt-4">
                <label className="mb-2 block text-sm font-semibold">Custom reason</label>
                <textarea
                  value={customCancelReason}
                  onChange={(event) => setCustomCancelReason(event.target.value)}
                  placeholder="Write your cancellation reason..."
                  className="min-h-24 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={closeCancelDialog}
                disabled={isCancelling}
                className="flex-1 rounded-xl border border-border bg-card py-3 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-60"
              >
                Keep Order
              </button>
              <button
                type="button"
                onClick={handleCancelOrder}
                disabled={isCancelling}
                className="flex-1 rounded-xl bg-destructive py-3 text-sm font-semibold text-white shadow-lg shadow-destructive/20 transition-all hover:bg-destructive/90 disabled:opacity-60"
              >
                {isCancelling ? "Cancelling..." : "Cancel Order"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function OrderDetailsModal({
  order,
  onClose,
  onCancel,
}: {
  order: Order;
  onClose: () => void;
  onCancel?: () => void;
}) {
  const total = order.total ?? order.totalAmount ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="bg-primary p-6 text-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/80">Order Details</p>
              <h2 className="mt-1 text-2xl font-extrabold">#{order.orderNumber ?? order.id}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-white/20 px-3 py-1">{getDisplayStatusLabel(order.status)}</span>
                <span className="text-white/85">
                  {formatOrderDate(order.createdAt)} {formatOrderTime(order.createdAt)}
                </span>
                <span className="text-white/85">{order.slotName ?? "Unassigned"}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          <div className="space-y-3">
            {order.items.map((item, index) => {
              const unitPrice = item.unitPrice ?? item.price ?? 0;
              return (
                <div key={item.id ?? `${item.menuItemId}-${index}`} className="flex items-center justify-between rounded-xl border border-border bg-background p-4">
                  <div>
                    <div className="font-semibold">{item.name ?? "Item"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.quantity} x {formatINR(unitPrice)}
                    </div>
                  </div>
                  <div className="font-bold">{formatINR(unitPrice * item.quantity)}</div>
                </div>
              );
            })}
          </div>

          {order.statusLogs && order.statusLogs.length > 0 && (
            <div className="mt-6 border-t border-border pt-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Status Timeline</p>
              <div className="space-y-3">
                {order.statusLogs.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 text-sm">
                    <div className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                    <div>
                      <div className="font-medium capitalize">{getDisplayStatusLabel(entry.toStatus)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatOrderDate(entry.changedAt)} {formatOrderTime(entry.changedAt)}
                        {entry.note ? ` - ${entry.note}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
            <span className="text-sm font-semibold text-muted-foreground">Total</span>
            <span className="text-2xl font-bold text-primary">{formatINR(total)}</span>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                Cancel Order
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function canCancel(status: OrderStatus) {
  return ["pending", "placed", "preparing", "ready"].includes(normalizeOrderStatus(status));
}

function getStatusColor(status: OrderStatus) {
  switch (normalizeOrderStatus(status)) {
    case "pending":
    case "placed":
    case "preparing":
    case "ready":
      return "bg-sky-500/15 text-sky-700";
    case "delivered":
      return "bg-emerald-500/15 text-emerald-600";
    case "cancelled":
      return "bg-destructive/15 text-destructive";
    case "expired":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getDisplayStatusLabel(status: OrderStatus) {
  switch (normalizeOrderStatus(status)) {
    case "pending":
    case "placed":
    case "preparing":
    case "ready":
      return "Ordered";
    case "delivered":
      return "Delivered";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Processing";
    default:
      return "Processing";
  }
}

function formatOrderDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function normalizeOrderStatus(status: string | undefined | null): OrderStatus {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized === "pending" || normalized === "accepted" || normalized === "placed" || normalized === "preparing" || normalized === "ready" || normalized === "prepared") {
    return "pending";
  }
  if (normalized === "delivered" || normalized === "completed") return "delivered";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  if (normalized === "expired") return "expired";
  return "pending";
}

function normalizeOrderForUi(order: Order): Order {
  return {
    ...order,
    status: normalizeOrderStatus(order.status),
    statusLogs: order.statusLogs?.map((entry) => ({
      ...entry,
      fromStatus: entry.fromStatus ? normalizeOrderStatus(entry.fromStatus) : entry.fromStatus,
      toStatus: normalizeOrderStatus(entry.toStatus),
    })),
  };
}

function formatOrderTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
