import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bell, Megaphone, ShoppingBag, UserCog, Users } from "lucide-react";
import { toast } from "sonner";

import { NotificationCenter, formatRelativeTime, type NotificationCenterItem } from "@/components/NotificationCenter";
import {
  deleteNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationDto,
} from "@/api/notifications";
import { AdminLayout } from "./admin-orders";

export const Route = createFileRoute("/admin-notifications")({ component: AdminNotifications });

type NotificationFilter = "all" | "read" | "unread";

function AdminNotifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [notificationRows, setNotificationRows] = useState<NotificationDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotifications = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      setNotificationRows(await fetchNotifications());
    } catch (error) {
      toast.error((error as Error).message || "Could not load notifications.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
    const timer = window.setInterval(() => loadNotifications(true), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const notifications = useMemo<NotificationCenterItem[]>(() => {
    return notificationRows
      .map((notification) => {
        const time = new Date(notification.created_at ?? new Date().toISOString());
        const target = getNotificationTarget(notification);
        const Icon = getNotificationIcon(notification);

        return {
          id: notification.id,
          title: notification.title ?? "Notification",
          body: notification.body ?? notification.message ?? "",
          time,
          timeLabel: formatRelativeTime(time),
          read: Boolean(notification.read ?? notification.is_read),
          icon: Icon.icon,
          iconClassName: Icon.className,
          actionLabel: target.label,
          onAction: async () => {
            await markAsRead(notification.id);
            navigate({ to: target.route });
          },
          dismissLabel: "Dismiss",
          onDismiss: () => dismissNotification(notification.id),
          onDoubleClick: () => markAsRead(notification.id),
          meta: (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {(notification.type ?? notification.kind ?? "system").toUpperCase()}
            </span>
          ),
        };
      })
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [navigate, notificationRows]);

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
    markAllNotificationsRead()
      .then(() => {
        setNotificationRows((current) => current.map((notification) => ({ ...notification, read: true, is_read: true })));
        toast.success("All notifications marked as read");
      })
      .catch((error) => toast.error((error as Error).message || "Could not mark notifications as read."));
  };

  const clearAll = () => {
    Promise.all(notifications.map((notification) => deleteNotification(notification.id)))
      .then(() => {
        setNotificationRows([]);
        toast.success("All notifications removed");
      })
      .catch((error) => toast.error((error as Error).message || "Could not remove notifications."));
  };

  const markAsRead = async (id: string) => {
    await markNotificationRead(id);
    setNotificationRows((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true, is_read: true } : notification,
      ),
    );
  };

  const dismissNotification = (id: string) => {
    deleteNotification(id)
      .then(() => {
        setNotificationRows((current) => current.filter((notification) => notification.id !== id));
        toast.success("Notification removed");
      })
      .catch((error) => toast.error((error as Error).message || "Could not remove notification."));
  };

  return (
    <AdminLayout crumb="Notifications">
      <NotificationCenter
        title="Notifications"
        description={isLoading ? "Loading notifications..." : "System alerts and operational updates."}
        unreadCount={unreadCount}
        filter={filter}
        filters={filters}
        items={filteredNotifications}
        onFilterChange={setFilter}
        onMarkAllRead={markAllAsRead}
        onClearAll={clearAll}
        clearAllLabel="Remove all"
      />
    </AdminLayout>
  );
}

function getNotificationIcon(notification: NotificationDto) {
  const text = `${notification.type ?? ""} ${notification.kind ?? ""} ${notification.title ?? ""}`.toLowerCase();
  if (text.includes("announcement")) return { icon: Megaphone, className: "bg-fuchsia-500/15 text-fuchsia-600" };
  if (text.includes("guest") || text.includes("order")) return { icon: ShoppingBag, className: "bg-primary/15 text-primary" };
  if (text.includes("kitchen") || text.includes("counter") || text.includes("user")) {
    return { icon: UserCog, className: "bg-cyan-500/15 text-cyan-600" };
  }
  if (text.includes("employee")) return { icon: Users, className: "bg-amber-500/15 text-amber-600" };
  return { icon: Bell, className: "bg-muted text-muted-foreground" };
}

function getNotificationTarget(notification: NotificationDto): { label: string; route: "/admin-announcements" | "/admin-guest-orders" | "/admin-employees" | "/admin-kitchen" } {
  const text = `${notification.type ?? ""} ${notification.kind ?? ""} ${notification.title ?? ""}`.toLowerCase();
  if (text.includes("announcement")) return { label: "Open announcements", route: "/admin-announcements" };
  if (text.includes("guest") || text.includes("order")) return { label: "Open guest orders", route: "/admin-guest-orders" };
  if (text.includes("kitchen") || text.includes("counter")) return { label: "Open kitchen users", route: "/admin-kitchen" };
  if (text.includes("employee") || text.includes("user")) return { label: "Open employees", route: "/admin-employees" };
  return { label: "Open admin", route: "/admin-kitchen" };
}
