import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell,
  Info,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { NotificationCenter, formatRelativeTime, type NotificationCenterItem } from "@/components/NotificationCenter";
import { useEmployeeNotifications, type EmployeeNotificationKind } from "@/lib/employeeNotifications";

export const Route = createFileRoute("/notifications")({ component: Notifications });

type NotificationFilter = "all" | "read" | "unread";

function Notifications() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [mounted, setMounted] = useState(false);
  const {
    notifications,
    unreadCount,
    markAllAsRead,
    clearAll,
    dismissNotification,
    markAsRead,
  } = useEmployeeNotifications();

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredNotifications = notifications.filter((notification) => {
    if (filter === "read") return notification.read;
    if (filter === "unread") return !notification.read;
    return true;
  });

  const handleMarkAllAsRead = () => {
    markAllAsRead();
    toast.success("All notifications marked as read");
  };

  const handleClearAll = () => {
    clearAll();
    toast.success("All notifications cleared");
  };

  const handleDismissNotification = (id: string) => {
    dismissNotification(id);
    toast.success("Notification removed");
  };

  const filters = [
    { value: "all" as const, label: "All", count: notifications.length },
    { value: "read" as const, label: "Read", count: notifications.filter((notification) => notification.read).length },
    { value: "unread" as const, label: "Unread", count: notifications.filter((notification) => !notification.read).length },
  ];

  const notificationItems: NotificationCenterItem[] = filteredNotifications.map((notification) => {
    const Icon = getIcon(notification.type);

    return {
      id: notification.id,
      title: notification.title,
      body: notification.body,
      timeLabel: formatRelativeTime(notification.time),
      read: notification.read,
      icon: Icon,
      iconClassName: getIconColor(notification.type),
      onDoubleClick: notification.read ? undefined : () => markAsRead(notification.id),
      actionLabel: notification.actionable ? notification.actionText : undefined,
      onAction:
        notification.actionable && notification.actionRoute
          ? () => {
              try {
                markAsRead(notification.id);
              } catch {
                /* ignore */
              }
              return navigate({ to: notification.actionRoute });
            }
          : undefined,
      dismissLabel: notification.actionable ? "Dismiss" : undefined,
      onDismiss: () => handleDismissNotification(notification.id),
    };
  });

  return (
    <AppLayout title="Notifications">
      <div className={`space-y-6 transition-opacity duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}>
        <NotificationCenter
          title="Notifications"
          description="Stay updated on orders, wallet changes, and announcements."
          unreadCount={unreadCount}
          filter={filter}
          filters={filters}
          items={notificationItems}
          onFilterChange={setFilter}
          onMarkAllRead={handleMarkAllAsRead}
          onClearAll={handleClearAll}
        />
      </div>
    </AppLayout>
  );
}

function getIcon(type: EmployeeNotificationKind) {
  switch (type) {
    case "order":
      return UtensilsCrossed;
    case "wallet":
      return Wallet;
    case "system":
      return Info;
    default:
      return Bell;
  }
}

function getIconColor(type: EmployeeNotificationKind) {
  switch (type) {
    case "order":
      return "bg-primary/15 text-primary";
    case "wallet":
      return "bg-emerald-500/15 text-emerald-600";
    case "system":
      return "bg-sky-500/15 text-sky-600";
    default:
      return "bg-muted text-muted-foreground";
  }
}
