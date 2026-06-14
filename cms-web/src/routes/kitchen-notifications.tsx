import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, CheckCircle2, Megaphone, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { NotificationCenter, formatRelativeTime, type NotificationCenterItem } from "@/components/NotificationCenter";
import { useEntities, type Announcement } from "@/lib/store";
import type { Order } from "@/lib/store";
import { fetchKitchenOrders } from "@/api/kitchenApi";
import { KitchenLayout } from "./kitchen";

export const Route = createFileRoute("/kitchen-notifications")({ component: KitchenNotifications });

type NotificationFilter = "all" | "read" | "unread";

function KitchenNotifications() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const announcements = useEntities<Announcement>("announcements");

  useEffect(() => {
    fetchKitchenOrders().then(setOrders).catch(() => {});
  }, []);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  const notifications = useMemo<NotificationCenterItem[]>(() => {
    const items: Array<NotificationCenterItem & { time: Date }> = [];

    orders
      .filter((order) => ["placed", "preparing", "ready"].includes(order.status))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6)
      .forEach((order) => {
        const isDelayed = order.status === "preparing" && getAgeMinutes(order.createdAt) >= 20;
        const isReady = order.status === "ready";

        items.push({
          id: `order-${order.id}`,
          title: isDelayed
            ? `Prep delay warning for ${order.orderNumber}`
            : isReady
              ? `Order ready for pickup ${order.orderNumber}`
              : `New kitchen order ${order.orderNumber}`,
          body: `${order.customerName} | ${order.slotName} | ${order.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}`,
          time: new Date(order.updatedAt),
          timeLabel: "",
          read: false,
          icon: isDelayed ? AlertTriangle : isReady ? CheckCircle2 : ShoppingBag,
          iconClassName: isDelayed
            ? "bg-amber-500/15 text-amber-600"
            : isReady
              ? "bg-emerald-500/15 text-emerald-600"
              : "bg-primary/15 text-primary",
          actionLabel: "Open live board",
          onAction: () => navigate({ to: "/kitchen" }),
          dismissLabel: "Dismiss",
          onDismiss: () => dismissNotification(`order-${order.id}`, setDismissedIds),
          meta: (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              isDelayed
                ? "bg-amber-500/15 text-amber-600"
                : isReady
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-muted text-muted-foreground"
            }`}>
              {isDelayed ? "DELAY" : order.status.toUpperCase()}
            </span>
          ),
        });
      });

    announcements
      .filter((announcement) => announcement.active)
      .slice(0, 2)
      .forEach((announcement) => {
        items.push({
          id: `announcement-${announcement.id}`,
          title: announcement.title,
          body: announcement.message,
          time: new Date(announcement.createdAt),
          timeLabel: "",
          read: announcement.priority === "low",
          icon: Megaphone,
          iconClassName: "bg-fuchsia-500/15 text-fuchsia-600",
          actionLabel: "Review update",
          onAction: () => navigate({ to: "/kitchen-history" }),
          dismissLabel: "Dismiss",
          onDismiss: () => dismissNotification(`announcement-${announcement.id}`, setDismissedIds),
        });
      });

    return items
      .filter((item) => !dismissedIds.has(item.id))
      .map((item) => ({
        ...item,
        timeLabel: formatRelativeTime(item.time),
        read: item.read || readIds.has(item.id),
      }))
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [announcements, dismissedIds, navigate, orders, readIds]);

  const filteredNotifications = notifications.filter((notification) => {
    if (filter === "read") return notification.read;
    if (filter === "unread") return !notification.read;
    return true;
  });

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  const filters = [
    { value: "all" as const, label: "All", count: notifications.length },
    { value: "read" as const, label: "Read", count: notifications.filter((notification) => notification.read).length },
    { value: "unread" as const, label: "Unread", count: notifications.filter((notification) => !notification.read).length },
  ];

  const markAllAsRead = () => {
    setReadIds(new Set(notifications.map((notification) => notification.id)));
    toast.success("All alerts marked as read");
  };

  const clearAll = () => {
    setDismissedIds(new Set(notifications.map((notification) => notification.id)));
    toast.success("All alerts removed");
  };

  return (
    <KitchenLayout title="Notifications">
      <NotificationCenter
        title="Notifications Center"
        description="Managing real-time updates from kitchen operations."
        unreadCount={unreadCount}
        filter={filter}
        filters={filters}
        items={filteredNotifications}
        onFilterChange={setFilter}
        onMarkAllRead={markAllAsRead}
        onClearAll={clearAll}
        clearAllLabel="Remove all"
      />
    </KitchenLayout>
  );
}

function dismissNotification(id: string, setDismissedIds: Dispatch<SetStateAction<Set<string>>>) {
  setDismissedIds((prev) => new Set(prev).add(id));
  toast.success("Alert removed");
}

function getAgeMinutes(createdAt: string) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
}
