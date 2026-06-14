import api from "@/api/client";
import type { WalletTransaction } from "@/lib/store/index";

export type EmployeeWallet = {
  id: string;
  employee: string;
  balance: number;
  monthlySpent: number;
  monthlyLimit: number | null;
  monthlyRemaining: number | null;
  billingCycleStart: string | null;
  lastRechargedAt: string | null;
  transactions: WalletTransaction[];
};

export async function fetchEmployeeWallet(params?: { start?: string; end?: string }) {
  const response = await api.get<EmployeeWallet>("/cms/employee/wallet/", { params });
  return response.data;
}

export async function rechargeEmployeeWallet(amount: number) {
  const response = await api.post<EmployeeWallet>("/cms/employee/wallet/recharge/", { amount });
  return response.data;
}

export async function downloadEmployeeWalletStatement(params?: { start?: string; end?: string }) {
  return api.download(
    `/cms/employee/wallet/export/${params?.start || params?.end ? `?start=${params?.start ?? ""}&end=${params?.end ?? ""}` : ""}`,
  );
}
