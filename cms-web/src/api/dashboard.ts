// Cafinity — Live Slot Dashboard Widget + Slot Order Summary
import api from "@/api/client";

export interface LiveSlotCard {
  slot_id: string;
  slot_name: string;
  start_time: string;
  end_time: string;
  total_orders: number;
  delivered_orders: number;
  pending_orders: number;
  canteen_name: string;
}

export interface LiveSlotsResponse {
  active_slots: LiveSlotCard[];
  next_slot: { slot_name: string; start_time: string } | null;
}

export interface SlotOrderSummaryItem {
  item_id: string;
  item_name: string;
  category: string;
  total_ordered: number;
  delivered: number;
  pending: number;
}

export interface SlotOrderSummaryResponse {
  slot_name: string;
  date: string;
  canteen_name: string;
  items: SlotOrderSummaryItem[];
  totals: {
    total_ordered: number;
    delivered: number;
    pending: number;
    order_count?: number;
  };
}

export async function fetchLiveSlots(): Promise<LiveSlotsResponse> {
  const response = await api.get<LiveSlotsResponse>("/cms/dashboard/live-slots/");
  return response.data;
}

export async function fetchSlotOrderSummary(params: {
  slot_id: string;
  date?: string;
  canteen_id?: string;
}): Promise<SlotOrderSummaryResponse> {
  const query = new URLSearchParams({ slot_id: params.slot_id });
  if (params.date) query.set("date", params.date);
  if (params.canteen_id) query.set("canteen_id", params.canteen_id);
  const response = await api.get<SlotOrderSummaryResponse>(
    `/cms/dashboard/slot-order-summary/?${query.toString()}`,
  );
  return response.data;
}

export async function sendSlotSummaryEmail(slotId: string): Promise<void> {
  await api.post(`/cms/slots/${slotId}/send-summary-email/`, {});
}
