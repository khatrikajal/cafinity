import api from "@/api/client";
import type { Order } from "@/lib/store";

export type KitchenOrderStatus = "preparing" | "ready" | "delivered";

export type KitchenStats = {
  pending: number;
  preparing: number;
  ready: number;
  delivered: number;
  cancelled: number;
  total: number;
  live: number;
};

type OrderListResponse = {
  results: Order[];
};

export async function fetchKitchenOrders(): Promise<Order[]> {
  const response = await api.get<OrderListResponse>("/cms/kitchen/orders/");
  return response.data.results;
}

export async function fetchKitchenHistory(date?: string): Promise<Order[]> {
  const params = date ? { date } : undefined;
  const response = await api.get<OrderListResponse>("/cms/kitchen/orders/history/", { params });
  return response.data.results;
}

export async function updateKitchenOrderStatus(
  orderId: string,
  newStatus: KitchenOrderStatus,
  note?: string,
): Promise<Order> {
  const response = await api.post<Order>(`/cms/kitchen/orders/${orderId}/status/`, {
    status: newStatus,
    note: note ?? "",
  });
  return response.data;
}

export async function fetchKitchenStats(): Promise<KitchenStats> {
  const response = await api.get<KitchenStats>("/cms/kitchen/stats/");
  return response.data;
}
