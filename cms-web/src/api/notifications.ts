import api from "@/api/client";

export type NotificationDto = {
  id: string;
  type?: string;
  kind?: string;
  title?: string;
  message?: string;
  body?: string;
  created_at?: string;
  is_read?: boolean;
  read?: boolean;
  actionable?: boolean;
  action_text?: string;
  action_route?: string;
};

export async function fetchNotifications() {
  const response = await api.get<NotificationDto[]>('/notifications/');
  return response.data ?? [];
}

export async function markNotificationRead(id: string) {
  await api.patch(`/notifications/${id}/read/`, {});
}

export async function markAllNotificationsRead() {
  await api.post(`/notifications/mark-all-read/`, {});
}

export async function deleteNotification(id: string) {
  await api.delete(`/notifications/${id}/`);
}
