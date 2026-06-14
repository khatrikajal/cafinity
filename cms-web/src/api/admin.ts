import api from "@/api/client";
import type { Order } from "@/lib/store";

export interface AdminDashboardStats {
  todayOrders: number;
  todayRevenue: number;
  slotCounts: Array<{
    slotId: string;
    slot: string;
    orders: number;
  }>;
  statusCounts: {
    placed: number;
    preparing: number;
    ready: number;
    delivered: number;
    expired?: number;
  };
  activeUsers: number;
  avgProcessingTime: number;
}

export interface AdminOrdersParams {
  status?: "placed" | "preparing" | "ready" | "delivered" | "cancelled" | "expired";
  canteen_id?: string;
  slot_id?: string;
  range?: "today" | "7d" | "30d" | "all";
  date_from?: string;
  date_to?: string;
  search?: string;
  live_only?: boolean;
  page?: number;
  page_size?: number;
}

export interface AdminOrdersResponse {
  results: Order[];
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReportResponse<T> {
  results: T[];
  count: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  totalRevenue?: number;
  totalUnits?: number;
  totalOrders?: number;
  averageOrderValue?: number;
  averageProcessingMinutes?: number;
}

export interface RevenueReportRow {
  slot: string;
  item: string;
  quantity: number;
  revenue: number;
}

export interface EmployeeActivityReportRow {
  id: string;
  name: string;
  empId: string;
  department: string;
  orderCount: number;
  meals: number;
  total: number;
}

export interface CancelledOrderReportRow {
  id: string;
  orderNumber: string;
  customerName: string;
  slotName: string;
  cancelledAt?: string | null;
  reason: string;
}

export interface OrderReportRow extends Order {
  customerName?: string;
  empId?: string;
  department?: string;
  slotName?: string;
}

export interface SlotUtilizationReportRow {
  slotId: string;
  slot: string;
  date: string;
  capacity: number;
  orders: number;
  items: number;
  utilization: number;
}

export interface ItemSalesReportRow {
  menuItemId: string;
  item: string;
  quantity: number;
  revenue: number;
}

export interface DeviceUser {
  id: string;
  username: string;
  display_name: string;
  role: "KITCHEN" | "COUNTER";
  canteen_id: string;
  company_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

interface DeviceUsersResponse {
  results: DeviceUser[];
}

export interface CanteenOption {
  id: string;
  name: string;
  company_id: string;
  company_name: string;
  is_active?: boolean;
}

interface CanteensResponse {
  results: CanteenOption[];
}

export interface CompanyOption {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface CompaniesResponse {
  results?: CompanyOption[];
}

export interface CompanyInput {
  name: string;
  code: string;
}

export interface CanteenInput {
  name: string;
  company_id: string;
}

export interface CreateDeviceUserInput {
  username: string;
  display_name: string;
  role: "KITCHEN" | "COUNTER";
  pin: string;
  canteen_id: string;
  company_id: string;
}

export interface UpdateDeviceUserInput {
  username?: string;
  display_name?: string;
  role?: "KITCHEN" | "COUNTER";
  canteen_id?: string;
  company_id?: string;
  is_active?: boolean;
}

// Cafinity rebrand — logo + favicon update
export interface AuditLogEntry {
  id: string;
  actor: string | null;
  actor_name: string;
  actor_type: string;
  actor_email: string;
  actor_role: string;
  action_category: string;
  action: string;
  target_model: string;
  target_id: string | null;
  target_display: string;
  previous_state: Record<string, unknown> | string | null;
  new_state: Record<string, unknown> | string | null;
  changed_fields: string[] | string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | string | null;
  timestamp: string;
  is_sensitive: boolean;
}

export interface AuditLogListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: AuditLogEntry[];
}

export interface AuditSummaryResponse {
  total_today: number;
  by_category: Record<string, number>;
  recent_actors: Array<{ email: string; role: string; action_count: number }>;
  last_password_change: { actor_email: string; timestamp: string } | null;
}

export interface AuditLogFilters {
  actor_id?: string;
  actor_email?: string;
  action_category?: string;
  action?: string;
  target_model?: string;
  target_id?: string;
  from_date?: string;
  to_date?: string;
  is_sensitive?: boolean;
  search?: string;
  page?: number;
  page_size?: number;
}

export async function fetchAdminDashboard(params: { canteen_id?: string } = {}) {
  const response = await api.get<AdminDashboardStats>("/cms/admin/dashboard/", { params });
  return response.data;
}

export async function fetchAdminOrders(params: AdminOrdersParams = {}) {
  const response = await api.get<AdminOrdersResponse>("/cms/admin/orders/", {
    params: params as Record<string, unknown>,
  });
  return response.data;
}

export async function fetchReportOrders(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<OrderReportRow>>("/cms/reports/orders/", {
    params,
  });
  return response.data;
}

export async function fetchRevenueReport(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<RevenueReportRow>>("/cms/reports/revenue/", {
    params,
  });
  return response.data;
}

export async function fetchSlotUtilizationReport(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<SlotUtilizationReportRow>>("/cms/reports/slot-utilization/", {
    params,
  });
  return response.data;
}

export async function fetchKitchenPerformanceReport(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<{ label: string; count: number }>>("/cms/reports/kitchen-performance/", {
    params,
  });
  return response.data;
}

export async function fetchItemSalesReport(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<ItemSalesReportRow>>("/cms/reports/item-sales/", {
    params,
  });
  return response.data;
}

export async function fetchCancelledOrdersReport(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<CancelledOrderReportRow>>("/cms/reports/cancelled-orders/", {
    params,
  });
  return response.data;
}

export async function fetchEmployeeActivityReport(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<EmployeeActivityReportRow>>("/cms/reports/employee-activity/", {
    params,
  });
  return response.data;
}

export async function fetchPeriodReport(params: Record<string, unknown> = {}) {
  const response = await api.get<ReportResponse<{ period: string; orderCount: number; totalRevenue: number }>>("/cms/reports/period/", {
    params,
  });
  return response.data;
}

export async function fetchDeviceUsers(params: Record<string, unknown> = {}) {
  const response = await api.get<DeviceUsersResponse>("/cms/devices/", { params });
  return response.data.results;
}

export async function createDeviceUser(payload: CreateDeviceUserInput) {
  const response = await api.post<{ device_user: DeviceUser }>("/cms/devices/", payload);
  return response.data.device_user;
}

export async function updateDeviceUser(deviceUserId: string, payload: UpdateDeviceUserInput) {
  const response = await api.patch<DeviceUser>(`/cms/devices/${encodeURIComponent(deviceUserId)}/`, payload);
  return response.data;
}

export async function setDeviceUserActive(deviceUserId: string, isActive: boolean) {
  const response = await api.patch<DeviceUser>(`/cms/devices/${encodeURIComponent(deviceUserId)}/`, {
    is_active: isActive,
  });
  return response.data;
}

export async function deactivateDeviceUser(deviceUserId: string) {
  await api.delete(`/cms/devices/${encodeURIComponent(deviceUserId)}/`);
}

export async function resetDeviceUserPin(deviceUserId: string, pin: string) {
  await api.post(`/cms/devices/${encodeURIComponent(deviceUserId)}/reset-pin/`, { pin });
}

export async function fetchCanteens() {
  const response = await api.get<CanteensResponse>("/cms/canteens/");
  return response.data.results;
}

export async function createCanteen(payload: CanteenInput) {
  const response = await api.post<CanteenOption>("/cms/canteens/", payload);
  return response.data;
}

export async function updateCanteen(canteenId: string, payload: Partial<CanteenInput>) {
  const response = await api.patch<CanteenOption>(`/cms/canteens/${encodeURIComponent(canteenId)}/`, payload);
  return response.data;
}

export async function deleteCanteen(canteenId: string) {
  await api.delete(`/cms/canteens/${encodeURIComponent(canteenId)}/`);
}

export async function fetchCompanies() {
  const response = await api.get<CompanyOption[] | CompaniesResponse>("/auth/companies/");
  return Array.isArray(response.data) ? response.data : response.data.results ?? [];
}

export async function createCompany(payload: CompanyInput) {
  const response = await api.post<CompanyOption>("/auth/companies/", payload);
  return response.data;
}

export async function updateCompany(companyId: string, payload: Partial<CompanyInput>) {
  const response = await api.patch<CompanyOption>(`/auth/companies/${encodeURIComponent(companyId)}/`, payload);
  return response.data;
}

export async function deleteCompany(companyId: string) {
  await api.delete(`/auth/companies/${encodeURIComponent(companyId)}/`);
}

export async function fetchAuditLogs(params: AuditLogFilters = {}) {
  const response = await api.get<AuditLogListResponse>("/audit/logs/", {
    params: params as Record<string, unknown>,
  });
  return response.data;
}

export async function fetchAuditLogDetail(id: string) {
  const response = await api.get<AuditLogEntry>(`/audit/logs/${encodeURIComponent(id)}/`);
  return response.data;
}

export async function fetchAuditSummary(params: Omit<AuditLogFilters, "page" | "page_size"> = {}) {
  const response = await api.get<AuditSummaryResponse>("/audit/logs/summary/", {
    params: params as Record<string, unknown>,
  });
  return response.data;
}

export async function exportAuditLogsCsv(params: Omit<AuditLogFilters, "page" | "page_size"> = {}) {
  const query = new URLSearchParams();
  query.set("format", "csv");
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  return api.download(`/audit/logs/export/?${query.toString()}`);
}
