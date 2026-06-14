import api from "@/api/client";
import type { Order } from "@/lib/store";

type RecentCounterResponse = {
  results: Order[];
};

export async function lookupCounterOrder(orderCode: string) {
  const response = await api.get<Order>(`/cms/counter/orders/${encodeURIComponent(orderCode)}/`);
  return response.data;
}

export async function collectCounterOrder(orderId: string) {
  const response = await api.post<Order>(`/cms/counter/orders/${orderId}/collect/`, {});
  return response.data;
}

export async function printCounterReceipt(orderId: string) {
  const response = await api.post<Order>(`/cms/counter/orders/${orderId}/print-receipt/`, {});
  return response.data;
}

export async function fetchRecentCounterCollections() {
  const response = await api.get<RecentCounterResponse>("/cms/counter/recent/");
  return response.data.results;
}
