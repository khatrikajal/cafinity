import api from "@/api/client";
import type { Order } from "@/lib/store";

type KitchenOrdersResponse = {
  results: Order[];
};

export async function fetchKitchenOrders() {
  const response = await api.get<KitchenOrdersResponse>("/cms/kitchen/orders/");
  return response.data.results;
}

export async function fetchKitchenOrderHistory(params?: {
  date?: string;
  date_from?: string;
  date_to?: string;
  all?: boolean;
  status?: "delivered" | "cancelled" | "expired";
}) {
  const response = await api.get<KitchenOrdersResponse>("/cms/kitchen/orders/history/", {
    params,
  });
  return response.data.results;
}

export async function updateKitchenOrderStatus(orderId: string, status: Order["status"]) {
  const response = await api.post<Order>(`/cms/kitchen/orders/${orderId}/status/`, { status });
  return response.data;
}
