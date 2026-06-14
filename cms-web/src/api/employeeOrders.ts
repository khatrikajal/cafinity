import api from "@/api/client";
import type { MenuItem, Order, Slot } from "@/lib/store/index";

type EmployeeMenuResponse = {
  canteen: {
    id: string;
    name: string;
  };
  slots: Slot[];
  items: MenuItem[];
};

type OrderListResponse = {
  results: Order[];
};

type EmployeeOrdersApiResponse = OrderListResponse | Order[];

export async function fetchEmployeeMenu() {
  const response = await api.get<EmployeeMenuResponse>("/cms/employee/menu/");
  const data = response.data;

  return {
    ...data,
    slots: Array.isArray(data.slots) ? data.slots.map(mapEmployeeSlot) : [],
  };
}

export async function fetchEmployeeOrders() {
  const response = await api.get<EmployeeOrdersApiResponse>("/cms/employee/orders/");
  const data = response.data;

  if (Array.isArray(data)) {
    return data.map(mapEmployeeOrder);
  }

  if (Array.isArray(data.results)) {
    return data.results.map(mapEmployeeOrder);
  }

  return [];
}

export async function checkoutEmployeeOrder(input: {
  slotId: string;
  items: Array<{ menuItemId: string; quantity: number }>;
}) {
  const response = await api.post<Order>("/cms/employee/orders/", {
    slot_id: input.slotId,
    items: input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
    })),
  });
  return response.data;
}

export async function cancelEmployeeOrder(orderId: string, reason: string) {
  const response = await api.post<Order>(`/cms/employee/orders/${orderId}/cancel/`, { reason });
  return mapEmployeeOrder(response.data);
}

function mapEmployeeSlot(slot: any): Slot {
  const normalizedDate = normalizeRecurringSlotDate(
    slot.date ?? slot.slot_date ?? "",
    (slot.active ?? slot.is_active ?? true) !== false,
  );
  const isOrderingOpen = slot.isOrderingOpen ?? slot.is_ordering_open;

  return {
    ...slot,
    id: String(slot.id),
    name: slot.name ?? slot.slot_name ?? "Slot",
    startTime: slot.startTime ?? slot.start_time ?? "",
    endTime: slot.endTime ?? slot.end_time ?? "",
    status: slot.status ?? "upcoming",
    date: normalizedDate,
    bufferMinutes: Number(slot.bufferMinutes ?? slot.buffer_minutes ?? 0),
    orderingDeadlineTime: slot.orderingDeadlineTime ?? slot.ordering_deadline_time ?? undefined,
    orderingDeadlineAt: slot.orderingDeadlineAt ?? slot.ordering_deadline_at ?? undefined,
    closedAt: slot.closedAt ?? slot.closed_at ?? slot.orderingDeadlineAt ?? slot.ordering_deadline_at ?? undefined,
    isOrderingOpen: typeof isOrderingOpen === "boolean" ? isOrderingOpen : slot.status !== "expired",
    displayStatus: slot.displayStatus ?? slot.display_status ?? (slot.status === "expired" ? "Closed" : "Open"),
    displayTime: slot.displayTime ?? slot.display_time ?? slot.time_range ?? undefined,
    type: slot.type ?? slot.slot_type ?? undefined,
  };
}

function mapEmployeeOrder(order: any): Order {
  const items = Array.isArray(order.items)
    ? order.items
    : Array.isArray(order.order_items)
      ? order.order_items
      : [];

  return {
    id: String(order.id),
    customerId: order.customerId ?? order.customer_id ?? order.employee ?? "",
    customerName: order.customerName ?? order.customer_name ?? order.employee_name ?? undefined,
    department: order.department ?? order.employee_department ?? undefined,
    items: items.map((item: any, index: number) => ({
      id: item.id ?? `${order.id}-item-${index}`,
      orderId: item.orderId ?? item.order_id ?? order.id,
      menuItemId: item.menuItemId ?? item.menu_item_id ?? item.menu_item ?? "",
      quantity: Number(item.quantity ?? 0),
      price: Number(item.price ?? item.unit_price ?? 0),
      unitPrice: Number(item.unitPrice ?? item.unit_price ?? item.price ?? 0),
      totalPrice: Number(item.totalPrice ?? item.line_total ?? 0),
      slotId: item.slotId ?? item.slot_id ?? order.slotId ?? order.slot_id ?? undefined,
      name: item.name ?? item.item_name_snapshot ?? item.item_name ?? undefined,
      image: item.image ?? item.image_url ?? null,
    })),
    status: order.status,
    createdAt: order.createdAt ?? order.created_at ?? order.placed_at ?? new Date().toISOString(),
    updatedAt: order.updatedAt ?? order.updated_at ?? order.created_at ?? new Date().toISOString(),
    slotId: order.slotId ?? order.slot_id ?? order.break_slot ?? undefined,
    slotName: order.slotName ?? order.slot_name ?? order.break_slot_name ?? undefined,
    notes: order.notes ?? order.special_instructions ?? undefined,
    orderNumber: order.orderNumber ?? order.order_number ?? order.order_code ?? undefined,
    subtotal: Number(order.subtotal ?? 0),
    tax: Number(order.tax ?? 0),
    total: Number(order.total ?? order.totalAmount ?? order.total_amount ?? order.employee_payable ?? 0),
    totalAmount: Number(order.totalAmount ?? order.total_amount ?? order.total ?? order.employee_payable ?? 0),
    paymentMethod: order.paymentMethod ?? order.payment_mode ?? undefined,
    statusLogs: Array.isArray(order.statusLogs ?? order.status_logs)
      ? (order.statusLogs ?? order.status_logs).map((entry: any, index: number) => ({
          id: entry.id ?? `${order.id}-status-${index}`,
          fromStatus: entry.fromStatus ?? entry.from_status ?? undefined,
          toStatus: entry.toStatus ?? entry.to_status ?? order.status,
          changedAt: entry.changedAt ?? entry.changed_at ?? entry.created_at ?? order.updatedAt ?? order.updated_at ?? order.created_at,
          changedByRole: entry.changedByRole ?? entry.changed_by_role ?? undefined,
          note: entry.note ?? undefined,
        }))
      : undefined,
  };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRecurringSlotDate(dateValue: string, isActive: boolean): string {
  if (!isActive) return dateValue;

  const [year, month, day] = String(dateValue ?? "").split("-").map(Number);
  if (!year || !month || !day) {
    return formatLocalDate(new Date());
  }

  const slotDate = new Date(year, month - 1, day);
  slotDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (slotDate < today) {
    return formatLocalDate(today);
  }

  return dateValue;
}
