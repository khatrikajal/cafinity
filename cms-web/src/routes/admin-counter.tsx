// Cafinity rebrand — logo + favicon update
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AdminLayout, getExactRoleType } from "./admin-orders";
import { fetchRecentCounterCollections, printCounterReceipt } from "@/api/counter";
import { buildThermalReceiptHtml, printReceiptTwice } from "@/lib/printReceipt";
import { fetchAdminOrders, fetchCanteens, type CanteenOption } from "@/api/admin";
import { formatINR, type Order, type OrderItem } from "@/lib/store";
import type { AxiosError } from "axios";
import { getCurrentUser } from "@/lib/auth";
import { 
  CheckSquare, 
  Search, 
  XCircle,
  Printer,
  Receipt,
} from "lucide-react";

export const Route = createFileRoute("/admin-counter")({ component: AdminCounter });

function AdminCounter() {
  const [orderCode, setOrderCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const [liveOrders, setLiveOrders] = useState<Order[]>([]);
  const [printedCount, setPrintedCount] = useState(0);
  const [roleType, setRoleType] = useState("");
  const [canteenFilter, setCanteenFilter] = useState("All");
  const [canteens, setCanteens] = useState<CanteenOption[]>([]);
  const [canteenLoading, setCanteenLoading] = useState(false);
  const isLimitedAdmin = roleType === "LIMITED_ADMIN";

  // Set current date
  useEffect(() => {
    const today = new Date();
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    setCurrentDate(today.toLocaleDateString('en-US', options));
  }, []);

  useEffect(() => {
    setRoleType(getExactRoleType(getCurrentUser()));
  }, []);

  useEffect(() => {
    if (isLimitedAdmin) return;

    let mounted = true;
    setCanteenLoading(true);
    fetchCanteens()
      .then((items) => {
        if (mounted) setCanteens(items);
      })
      .catch(() => {
        if (mounted) setCanteens([]);
      })
      .finally(() => {
        if (mounted) setCanteenLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isLimitedAdmin]);

  useEffect(() => {
    let mounted = true;
    fetchAdminOrders({
      live_only: true,
      page: 1,
      page_size: 100,
      canteen_id: !isLimitedAdmin && canteenFilter !== "All" ? canteenFilter : undefined,
    })
      .then((response) => {
        if (!mounted) return;
        setLiveOrders(response.results);
      })
      .catch(() => {
        if (mounted) setLiveOrders([]);
      });

    return () => {
      mounted = false;
    };
  }, [canteenFilter, isLimitedAdmin]);

  useEffect(() => {
    let mounted = true;
    fetchRecentCounterCollections()
      .then((orders) => {
        if (!mounted) return;
        setPrintedCount(orders.length);
      })
      .catch(() => {
        if (mounted) setPrintedCount(0);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const getOrderCode = (order: Order) => order.orderNumber ?? order.id;
  const getOrderTotal = (order: Order) => order.total ?? order.totalAmount ?? 0;
  const getItemQuantity = (item: OrderItem) => item.quantity ?? 0;
  const getItemUnitPrice = (item: OrderItem) => item.unitPrice ?? item.price ?? 0;
  const getItemTotal = (item: OrderItem) => item.totalPrice ?? getItemUnitPrice(item) * getItemQuantity(item);
  const getSlotLabel = (order: Order) => (order as any).slot ?? order.slotName ?? "-";
  const getOrderDigits = (order: Order) => getOrderCode(order).replace(/^CMS-/i, "").replace(/\D/g, "");
  const getOrderSearchText = (order: Order) =>
    `${getOrderCode(order)} ${getOrderDigits(order)} ${(order.customerName ?? "")} ${(order.items ?? []).map((item) => item.name ?? "").join(" ")}`.toLowerCase();
  const getStatusLabel = (order: Order) => {
    if (order.status === "delivered") return "DELIVERED";
    if (order.status === "cancelled" || order.status === "expired") return String(order.status).toUpperCase();
    return "PENDING";
  };
  const getStatusClassName = (order: Order) => {
    if (order.status === "delivered") {
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
    }
    if (order.status === "cancelled" || order.status === "expired") {
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    }
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  };
  const getErrorMessage = (err: unknown) => {
    const axiosError = err as AxiosError<{ detail?: string; code?: string; current_status?: string }>;
    const data = axiosError?.response?.data;
    if (data?.code === "ORDER_EXPIRED") {
      return "This order is expired. Print is blocked to prevent stale handover.";
    }
    if (data?.code === "ORDER_STATUS_NOT_PRINTABLE") {
      if (data.current_status) {
        return `Receipt can be printed only when order is Preparing or Ready. Current status: ${data.current_status}.`;
      }
      return "Receipt can be printed only when order is Preparing or Ready.";
    }
    if (data?.detail) return data.detail;
    if (err instanceof Error) return err.message;
    return "Request failed";
  };
  const normalizedQuery = orderCode.trim().replace(/^CMS-/i, "").replace(/\D/g, "").toLowerCase();
  const orderedList = [...liveOrders].sort((a, b) => {
    const timeA = new Date(a.createdAt ?? a.updatedAt ?? 0).getTime();
    const timeB = new Date(b.createdAt ?? b.updatedAt ?? 0).getTime();
    return timeB - timeA;
  });
  const visibleOrders = normalizedQuery.length === 0
    ? orderedList
    : orderedList.filter((order) => getOrderSearchText(order).includes(normalizedQuery));
  const getOrderTime = (order: Order) => {
    const value = order.createdAt ?? order.updatedAt;
    if (!value) return "-";
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };
  const getItemsSummary = (order: Order) => {
    const items = order.items ?? [];
    if (items.length === 0) return "-";
    return items
      .slice(0, 2)
      .map((item) => `${item.name ?? "Item"} x${getItemQuantity(item)}`)
      .join(", ") + (items.length > 2 ? ` +${items.length - 2} more` : "");
  };

  const generateReceiptHTML = (order: Order) => {
    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cafinity Receipt - ${getOrderCode(order)}</title>
        <style>
          body {
            font-family: 'Courier New', monospace;
            margin: 0;
            padding: 20px;
            background: white;
            width: 300px;
            margin: 0 auto;
          }
          .header {
            text-align: center;
            border-bottom: 2px dashed #000;
            padding-bottom: 10px;
            margin-bottom: 20px;
          }
          .title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .subtitle {
            font-size: 12px;
            color: #666;
          }
          .order-info {
            margin-bottom: 20px;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            font-size: 12px;
          }
          .items-section {
            margin-bottom: 20px;
          }
          .item-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 12px;
          }
          .item-name {
            flex: 1;
          }
          .item-qty {
            margin-right: 10px;
            text-align: center;
          }
          .item-price {
            text-align: right;
            min-width: 60px;
          }
          .total-section {
            border-top: 2px dashed #000;
            padding-top: 10px;
            margin-top: 20px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            font-size: 14px;
            font-weight: bold;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 10px;
            color: #666;
            border-top: 2px dashed #000;
            padding-top: 10px;
          }
          .status {
            display: inline-block;
            padding: 2px 8px;
            background: #4CAF50;
            color: white;
            font-size: 10px;
            border-radius: 10px;
            margin-bottom: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="title">CANTEEN RECEIPT</div>
          <div class="subtitle">Employee Meal Service</div>
        </div>
        
        <div class="order-info">
          <div class="status">${getStatusLabel(order)}</div>
          <div class="info-row">
            <span>Order ID:</span>
            <span>${getOrderCode(order)}</span>
          </div>
          <div class="info-row">
            <span>Date:</span>
            <span>${new Date().toLocaleDateString()}</span>
          </div>
          <div class="info-row">
            <span>Time:</span>
            <span>${new Date().toLocaleTimeString()}</span>
          </div>
          <div class="info-row">
            <span>Customer:</span>
            <span>${order.customerName ?? "Employee"}</span>
          </div>
          <div class="info-row">
            <span>Department:</span>
            <span>${order.department ?? "-"}</span>
          </div>
          <div class="info-row">
            <span>Time Slot:</span>
            <span>${getSlotLabel(order)}</span>
          </div>
        </div>
        
        <div class="items-section">
          <div style="font-weight: bold; margin-bottom: 10px; font-size: 14px;">ORDER ITEMS</div>
          ${order.items.map(item => `
            <div class="item-row">
              <span class="item-name">${item.name ?? "Item"}</span>
              <span class="item-qty">x${getItemQuantity(item)}</span>
              <span class="item-price">${formatINR(getItemTotal(item))}</span>
            </div>
          `).join('')}
        </div>
        
        <div class="total-section">
          <div class="total-row">
            <span>TOTAL AMOUNT:</span>
            <span>${formatINR(getOrderTotal(order))}</span>
          </div>
        </div>
        
        <div class="footer">
          <div>Thank you for your order!</div>
          <div>Please present this receipt at the counter</div>
          <div style="margin-top: 10px;">Generated: ${new Date().toLocaleString()}</div>
        </div>
      </body>
      </html>
    `;
    return receiptHTML;
  };

  const openPrintWindow = async (order: Order) => {
    const body = `
      <div class="header">
        <div style="font-size:16px;font-weight:bold;">CANTEEN RECEIPT</div>
        <div>Employee Meal Service</div>
      </div>
      <div class="row"><span>Order #:</span><span>${getOrderCode(order)}</span></div>
      <div class="row"><span>Customer:</span><span>${order.customerName ?? "Employee"}</span></div>
      <div class="row"><span>Time Slot:</span><span>${getSlotLabel(order)}</span></div>
      <div class="items">
        ${(order.items ?? [])
          .map(
            (item) =>
              `<div class="item"><span>${item.name ?? "Item"} x${getItemQuantity(item)}</span><span>${formatINR(getItemTotal(item))}</span></div>`,
          )
          .join("")}
      </div>
      <div class="total row"><span>TOTAL</span><span>${formatINR(getOrderTotal(order))}</span></div>
    `;
    await printReceiptTwice(buildThermalReceiptHtml(body, `Cafinity Receipt - ${getOrderCode(order)}`));
  };

  const printOrderFromTable = async (order: Order) => {
    setIsLoading(true);
    setError("");
    try {
      const deliveredOrder = await printCounterReceipt(order.id);
      await openPrintWindow(deliveredOrder);
      setLiveOrders((orders) => orders.filter((item) => item.id !== deliveredOrder.id));
      setPrintedCount((count) => count + 1);
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes("network")) {
        setError("Connection issue. Please check your internet and retry.");
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AdminLayout crumb="Counter Station">
      <div className="space-y-6 text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ef7f1a] text-white">
              <CheckSquare className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#23160d] dark:text-[#fff3e5]">Counter Station</h1>
              <p className="text-sm text-[#7d6a56] dark:text-[#c8af95]">{currentDate}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[22px] border border-[#eadfce] bg-[#fffdf9] p-5 dark:border-[#4c3020] dark:bg-[#17100c]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#8d7a65] dark:text-[#b99d80]">Total Orders</p>
                  <p className="mt-2 text-3xl font-bold text-[#23160d] dark:text-[#fff3e5]">{orderedList.length}</p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ef7f1a] text-white">
                  <CheckSquare className="h-6 w-6" />
                </div>
              </div>
            </div>

            <div className="rounded-[22px] border border-[#eadfce] bg-[#fffdf9] p-5 dark:border-[#4c3020] dark:bg-[#17100c]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[#8d7a65] dark:text-[#b99d80]">Total Printed</p>
                  <p className="mt-2 text-3xl font-bold text-[#23160d] dark:text-[#fff3e5]">{printedCount}</p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ef7f1a] text-white">
                  <Receipt className="h-6 w-6" />
                </div>
              </div>
            </div>
          </div>

          {/* Ordered List Table */}
          <div className="overflow-hidden rounded-[24px] border border-[#eadfce] bg-[#fffdf9] dark:border-[#4c3020] dark:bg-[#17100c]">
            <div className="flex flex-col gap-4 border-b border-[#eadfce] px-6 py-5 dark:border-[#4c3020] lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-bold text-[#23160d] dark:text-[#fff3e5]">Ordered List</h3>
                <p className="text-sm text-[#7d6a56] dark:text-[#c8af95]">
                  Search an order code and print receipts directly from the list.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {!isLimitedAdmin && (
                  <select
                    value={canteenFilter}
                    onChange={(event) => setCanteenFilter(event.target.value)}
                    disabled={canteenLoading}
                    className="h-10 rounded-xl border border-[#e6d6c3] bg-[#fff8ef] px-3 text-sm font-semibold text-[#23160d] focus:border-[#e18b2c] focus:outline-none focus:ring-2 focus:ring-[#f3b66c]/30 dark:border-[#533525] dark:bg-[#221712] dark:text-[#fff2e3]"
                  >
                    <option value="All">{canteenLoading ? "Loading canteens..." : "All Canteens"}</option>
                    {canteens.map((canteen) => (
                      <option key={canteen.id} value={canteen.id}>
                        {canteen.name}
                      </option>
                    ))}
                  </select>
                )}
                <div className="relative w-full sm:w-[320px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8d7a65] dark:text-[#b99d80]" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={orderCode}
                    onChange={(event) => {
                      setOrderCode(event.target.value.replace(/\D/g, "").slice(0, 5));
                      setError("");
                    }}
                    placeholder="12345"
                    className="w-full rounded-xl border border-[#e6d6c3] bg-[#fff8ef] py-2.5 pl-[4.75rem] pr-3 font-mono text-sm text-[#23160d] placeholder:text-[#9e8d7a] focus:border-[#e18b2c] focus:outline-none focus:ring-2 focus:ring-[#f3b66c]/30 dark:border-[#533525] dark:bg-[#221712] dark:text-[#fff2e3] dark:placeholder:text-[#9b8167]"
                  />
                  <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-[#d36f18]">
                    CMS-
                  </span>
                </div>
                <span className="w-fit rounded-full border border-[#e6d6c3] bg-[#fff8ef] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[#d36f18] dark:border-[#4d3223] dark:bg-[#221712]">
                  {visibleOrders.length} / {orderedList.length} Orders
                </span>
              </div>
            </div>

            {error && (
              <div className="border-b border-destructive/20 bg-destructive/10 px-6 py-3">
                <p className="flex items-center gap-2 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  {error}
                </p>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-[#fff8ef] text-xs uppercase tracking-wide text-[#8d7a65] dark:bg-[#211611] dark:text-[#b99d80]">
                  <tr>
                    <th className="px-6 py-4 font-bold">Order Code</th>
                    <th className="px-4 py-4 font-bold">Employee</th>
                    <th className="px-4 py-4 font-bold">Items</th>
                    <th className="px-4 py-4 font-bold">Slot</th>
                    <th className="px-4 py-4 font-bold">Time</th>
                    <th className="px-4 py-4 text-right font-bold">Amount</th>
                    <th className="px-4 py-4 font-bold">Status</th>
                    <th className="px-6 py-4 text-right font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eadfce] dark:divide-[#3c281e]">
                  {visibleOrders.map((order) => (
                    <tr key={order.id} className="bg-white transition-colors hover:bg-[#fffaf4] dark:bg-[#17100c] dark:hover:bg-[#211611]">
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm font-bold text-[#23160d] dark:text-[#fff3e5]">
                          {getOrderCode(order)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-[#23160d] dark:text-[#fff3e5]">
                          {order.customerName ?? "Employee"}
                        </div>
                        <div className="text-xs text-[#8d7a65] dark:text-[#b99d80]">
                          {order.department ?? "-"}
                        </div>
                      </td>
                      <td className="max-w-[260px] px-4 py-4 text-[#7d6a56] dark:text-[#c8af95]">
                        <span className="line-clamp-2">{getItemsSummary(order)}</span>
                      </td>
                      <td className="px-4 py-4 text-[#7d6a56] dark:text-[#c8af95]">{getSlotLabel(order)}</td>
                      <td className="px-4 py-4 text-[#7d6a56] dark:text-[#c8af95]">{getOrderTime(order)}</td>
                      <td className="px-4 py-4 text-right font-bold text-[#d36f18]">
                        {formatINR(getOrderTotal(order))}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${getStatusClassName(order)}`}>
                          {getStatusLabel(order)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => printOrderFromTable(order)}
                          disabled={isLoading}
                          className="inline-flex items-center gap-2 rounded-xl bg-[#ef7f1a] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#dd7418] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Printer className="h-4 w-4" />
                          Print
                        </button>
                        <p className="mt-1 text-[10px] text-[#8d7a65] dark:text-[#b99d80]">2 copies will be printed automatically</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visibleOrders.length === 0 && (
              <div className="border-t border-[#eadfce] px-6 py-12 text-center text-[#8d7a65] dark:border-[#4c3020] dark:text-[#b99d80]">
                <CheckSquare className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="text-sm font-medium">
                  {orderedList.length === 0 ? "No live orders available" : "No matching order found"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
