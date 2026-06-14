import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Download,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { fetchEmployeeOrders } from "@/api/employeeOrders";
import { fetchEmployeeWallet, type EmployeeWallet } from "@/api/wallet";
import { AppLayout } from "@/components/AppLayout";
import { Pagination } from "@/components/Pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  downloadCSV,
  formatINR,
  useCurrentCustomer,
  useEntities,
  type Order,
  type WalletTransaction,
} from "@/lib/store/index";

export const Route = createFileRoute("/wallet")({ component: WalletPage });

const PAGE_SIZE = 5;

function WalletPage() {
  const currentCustomer = useCurrentCustomer();
  const orders = useEntities<Order>("orders");
  const walletTransactions = useEntities<WalletTransaction>("walletTransactions");
  const [wallet, setWallet] = useState<EmployeeWallet | null>(null);
  const [remoteOrders, setRemoteOrders] = useState<Order[] | null>(null);
  const [mounted, setMounted] = useState(false);

  const [page, setPage] = useState(1);
  const [selectedOrderRef, setSelectedOrderRef] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split("T")[0],
    end: new Date().toISOString().split("T")[0],
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let ignore = false;

    Promise.all([
      fetchEmployeeWallet({ start: dateRange.start, end: dateRange.end }),
      fetchEmployeeOrders(),
    ])
      .then(([walletData, orderList]) => {
        if (ignore) return;
        setWallet(walletData);
        setRemoteOrders(orderList);
      })
      .catch(() => {
        if (!ignore) toast.error("Could not load wallet from server.");
      });

    return () => {
      ignore = true;
    };
  }, [dateRange.end, dateRange.start]);

  const customerTransactions = useMemo(() => {
    if (wallet) return wallet.transactions;
    if (!currentCustomer) return [];
    return walletTransactions
      .filter((transaction) => transaction.customerId === currentCustomer.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [currentCustomer, wallet, walletTransactions]);

  const filteredTransactions = useMemo(() => {
    const start = new Date(dateRange.start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dateRange.end);
    end.setHours(23, 59, 59, 999);

    return customerTransactions.filter((transaction) => {
      const createdAt = new Date(transaction.createdAt);
      return createdAt >= start && createdAt <= end;
    });
  }, [customerTransactions, dateRange.end, dateRange.start]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE));
  const pagedTransactions = filteredTransactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const customerOrders = remoteOrders ?? (
    currentCustomer
      ? orders.filter((order) => order.customerId === currentCustomer.id)
      : []
  );

  const monthlySpending = wallet?.monthlySpent ?? customerOrders
    .filter((order) => {
      const createdAt = new Date(order.createdAt);
      const now = new Date();
      return (
        order.status !== "cancelled" &&
        createdAt.getMonth() === now.getMonth() &&
        createdAt.getFullYear() === now.getFullYear()
      );
    })
    .reduce((sum, order) => sum + (order.total ?? 0), 0);

  const ordersThisMonth = customerOrders.filter((order) => {
    const createdAt = new Date(order.createdAt);
    const now = new Date();
    return (
      order.status !== "cancelled" &&
      createdAt.getMonth() === now.getMonth() &&
      createdAt.getFullYear() === now.getFullYear()
    );
  });

  const ordersCountThisMonth = ordersThisMonth.length;
  const avgOrderValue = ordersCountThisMonth > 0 ? monthlySpending / ordersCountThisMonth : 0;
  const highestSingleSpend = ordersThisMonth.reduce((max, order) => Math.max(max, order.total ?? 0), 0);



  const selectedOrder = selectedOrderRef
    ? customerOrders.find((order) => order.orderNumber === selectedOrderRef) ?? null
    : null;



  const handleExport = () => {
    const rows = [
      ["Date", "Type", "Description", "Reference", "Amount"],
      ...filteredTransactions.map((transaction) => [
        formatDateTime(transaction.createdAt),
        transaction.type,
        transaction.description ?? transaction.reason,
        transaction.reference ?? transaction.orderId ?? "-",
        transaction.amount.toString(),
      ]),
    ];

    downloadCSV(rows, `wallet-transactions-${dateRange.start}-to-${dateRange.end}`);
    toast.success("Wallet statement exported");
  };

  return (
    <AppLayout title="Wallet">
      <div className={`space-y-6 transition-opacity duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Wallet</h1>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#f46a00_0%,#ff8611_60%,#ffb11e_100%)] p-6 text-white shadow-[0_20px_50px_rgba(244,106,0,0.2)] md:col-span-2">
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-white/10" />
            <div className="absolute -bottom-24 -left-20 h-60 w-60 rounded-full bg-white/5" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-md">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-sm font-semibold uppercase tracking-wider text-white/90">Monthly Budget & Spending</span>
                  <span className="ml-auto rounded-full bg-white/20 px-3 py-1 text-xs font-bold backdrop-blur-md">
                    {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                </div>
                <h2 className="mt-6 text-sm font-medium text-white/80">Total Spent This Month</h2>
                <p className="mt-1 text-4xl font-black sm:text-5xl tracking-tight">{formatINR(monthlySpending)}</p>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/20 pt-4 text-xs text-white/80">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  Cycle: 1st to last of month
                </div>
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" />
                  Auto-resets on next 1st
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-4">
            <div className="group rounded-[24px] border border-[#eadfce] bg-[linear-gradient(180deg,#fffdf9_0%,#fff8ef_100%)] p-5 shadow-[0_12px_30px_rgba(44,25,7,0.04)] transition-all duration-300 hover:shadow-lg hover:shadow-black/5 dark:border-[#4a2f1e] dark:bg-[linear-gradient(180deg,#241710_0%,#17100b_100%)]">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">Active</span>
              </div>
              <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Orders Placed</p>
              <p className="text-2xl font-bold mt-1">{ordersCountThisMonth} orders</p>
              <p className="mt-1 text-xs text-muted-foreground">Successful orders this month</p>
            </div>

            <div className="group rounded-[24px] border border-[#eadfce] bg-[linear-gradient(180deg,#fffdf9_0%,#fff8ef_100%)] p-5 shadow-[0_12px_30px_rgba(44,25,7,0.04)] transition-all duration-300 hover:shadow-lg hover:shadow-black/5 dark:border-[#4a2f1e] dark:bg-[linear-gradient(180deg,#241710_0%,#17100b_100%)]">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <Sparkles className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-[#c67828] bg-[#c67828]/10 px-2 py-0.5 rounded-full">AOV</span>
              </div>
              <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Avg. Spent / Order</p>
              <p className="text-2xl font-bold mt-1">{formatINR(avgOrderValue)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Max single: {formatINR(highestSingleSpend)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold">Transaction History</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{filteredTransactions.length} transactions found</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <span className="text-sm font-medium text-muted-foreground">to</span>
                <input
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedTransactions.map((transaction) => {
                const isOrder = Boolean(transaction.orderId);
                return (
                  <TableRow
                    key={transaction.id}
                    onClick={() => {
                      if (transaction.orderId) {
                        const order = customerOrders.find((item) => item.id === transaction.orderId);
                        if (order) {
                          setSelectedOrderRef(order.orderNumber ?? order.id);
                        }
                      }
                    }}
                    className={isOrder ? "cursor-pointer" : undefined}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(transaction.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                          transaction.type === "credit" ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        {transaction.type === "credit" ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                        {transaction.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{transaction.description ?? transaction.reason}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <span className={isOrder ? "font-medium text-primary" : "text-muted-foreground"}>
                        {transaction.reference ?? transaction.orderId ?? "-"}
                      </span>
                    </TableCell>
                    <TableCell className={`whitespace-nowrap text-right font-bold ${transaction.type === "credit" ? "text-emerald-600" : "text-foreground"}`}>
                      {transaction.type === "credit" ? "+" : "-"}
                      {formatINR(transaction.amount)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={filteredTransactions.length}
            pageSize={PAGE_SIZE}
          />
        </div>
      </div>


      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedOrderRef(null);
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl">
            <div className="relative bg-[#EA580C] p-6 text-white">
              <button
                onClick={() => setSelectedOrderRef(null)}
                className="absolute right-4 top-4 rounded-full border-2 border-white/30 p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="text-xs font-bold uppercase tracking-wider text-white/90">Order Details</div>
              <h2 className="mt-1 text-3xl font-extrabold">{selectedOrder.orderNumber}</h2>
              <div className="mt-4 flex items-center gap-3 text-sm font-medium">
                <span className="rounded-full bg-white/20 px-3 py-1 backdrop-blur-md">{selectedOrder.status}</span>
                <span className="text-white/90">{formatDateTime(selectedOrder.createdAt)}</span>
              </div>
            </div>

            <div className="p-6">
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Order Items</div>
              <div className="mt-4 space-y-4">
                {selectedOrder.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {item.quantity}x
                      </span>
                      <span className="font-medium">{item.name}</span>
                    </div>
                    <span className="font-bold">{formatINR((item.unitPrice ?? item.price ?? 0) * item.quantity)}</span>
                  </div>
                ))}
              </div>

              <div className="my-6 border-t border-border" />

              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">Total Amount</span>
                <span className="text-2xl font-bold text-[#EA580C]">{formatINR(selectedOrder.total ?? 0)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function formatDateTime(dateString: string) {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
