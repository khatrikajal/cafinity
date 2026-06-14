import type { ReactNode } from "react";

import { BellOff, Check, Clock, Trash2, type LucideIcon } from "lucide-react";

type NotificationFilterOption<T extends string> = {
  value: T;
  label: string;
  count: number;
};

export type NotificationCenterItem = {
  id: string;
  title: string;
  body: string;
  timeLabel: string;
  read: boolean;
  icon: LucideIcon;
  iconClassName: string;
  actionLabel?: string;
  onAction?: () => void;
  dismissLabel?: string;
  onDismiss?: () => void;
  onDoubleClick?: () => void;
  meta?: ReactNode;
};

type NotificationCenterProps<T extends string> = {
  title: string;
  description: string;
  unreadCount: number;
  filter: T;
  filters: NotificationFilterOption<T>[];
  items: NotificationCenterItem[];
  onFilterChange: (value: T) => void;
  onMarkAllRead?: () => void;
  onClearAll?: () => void;
  markAllLabel?: string;
  clearAllLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
};

export function NotificationCenter<T extends string>({
  title,
  description: _description,
  unreadCount,
  filter,
  filters,
  items,
  onFilterChange,
  onMarkAllRead,
  onClearAll,
  markAllLabel = "Mark all as read",
  clearAllLabel = "Remove all",
  emptyTitle = "No notifications",
  emptyDescription: _emptyDescription = "You're all caught up.",
}: NotificationCenterProps<T>) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{title}</h1>
            {unreadCount > 0 ? (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                {unreadCount}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {unreadCount > 0 && onMarkAllRead ? (
            <button onClick={onMarkAllRead} className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <Check className="h-4 w-4" />
              {markAllLabel}
            </button>
          ) : null}
          {items.length > 0 && onClearAll ? (
            <button onClick={onClearAll} className="flex items-center gap-2 text-sm font-medium text-destructive hover:underline">
              <Trash2 className="h-4 w-4" />
              {clearAllLabel}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
        {filters.map((item) => (
          <button
            key={item.value}
            onClick={() => onFilterChange(item.value)}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              filter === item.value
                ? "bg-primary text-white shadow-lg shadow-primary/30"
                : "border border-border bg-card hover:bg-muted"
            }`}
          >
            {item.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${filter === item.value ? "bg-white/20" : "bg-muted"}`}>
              {item.count}
            </span>
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <BellOff className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="mt-4 font-semibold">{emptyTitle}</h3>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((notification, index) => {
            const Icon = notification.icon;

            return (
              <div
                key={notification.id}
                onDoubleClick={notification.onDoubleClick}
                className={`group relative overflow-hidden rounded-2xl border bg-card p-5 transition-all duration-300 hover:shadow-lg ${
                  notification.read ? "border-border" : "border-primary/30 bg-primary/5"
                }`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {!notification.read ? (
                  <div className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                ) : null}

                <div className="flex gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${notification.iconClassName}`}>
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{notification.title}</h3>
                        {notification.meta ? <div className="mt-1">{notification.meta}</div> : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {notification.timeLabel}
                      </div>
                    </div>

                    <p className="mt-1.5 text-sm text-muted-foreground">{notification.body}</p>

                    {notification.actionLabel || notification.dismissLabel ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        {notification.actionLabel && notification.onAction ? (
                          <button
                            onClick={notification.onAction}
                            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/30 transition-all hover:shadow-primary/40"
                          >
                            {notification.actionLabel}
                          </button>
                        ) : null}
                        {notification.dismissLabel && notification.onDismiss ? (
                          <button
                            onClick={notification.onDismiss}
                            className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
                          >
                            {notification.dismissLabel}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {notification.onDismiss ? (
                    <button
                      onClick={notification.onDismiss}
                      className="shrink-0 rounded-lg p-2 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function formatRelativeTime(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
