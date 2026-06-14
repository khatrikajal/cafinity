import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Route as AdminBillingRoute } from '@/routes/admin-billing';

const reportMocks = vi.hoisted(() => ({
  fetchReportOrders: vi.fn(),
  fetchRevenueReport: vi.fn(),
  fetchEmployeeActivityReport: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => ({ options }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: reportMocks.toastError,
    success: vi.fn(),
  },
}));

vi.mock('@/api/admin', () => ({
  fetchReportOrders: reportMocks.fetchReportOrders,
  fetchRevenueReport: reportMocks.fetchRevenueReport,
  fetchEmployeeActivityReport: reportMocks.fetchEmployeeActivityReport,
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: any) => selector({ customers: [] }),
  addToCustomerWallet: vi.fn(),
  downloadCSV: vi.fn(),
  formatINR: (value: number) => `INR ${value}`,
}));

vi.mock('@/components/DataTableToolbar', () => ({
  DataTableToolbar: () => <div data-testid="toolbar" />,
  formatShortDateInput: () => '2026-01-01',
}));

vi.mock('@/components/Pagination', () => ({
  Pagination: () => <div data-testid="pagination" />,
}));

vi.mock('@/components/TablePanel', () => ({
  TablePanel: ({ title, children }: any) => (
    <section>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  ),
}));

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
  TableCell: ({ children }: any) => <td>{children}</td>,
}));

vi.mock('@/routes/admin-orders', () => ({
  AdminLayout: ({ children }: any) => <div>{children}</div>,
}));

describe('Admin billing reports', () => {
  const AdminBillingComponent = AdminBillingRoute.options.component as React.ComponentType;

  beforeEach(() => {
    vi.clearAllMocks();
    reportMocks.fetchReportOrders.mockResolvedValue({ results: [], count: 0 });
    reportMocks.fetchRevenueReport
      .mockResolvedValueOnce({ results: [{ slot: 'Lunch', item: 'Veg Thali', quantity: 4, revenue: 400 }], totalRevenue: 400 })
      .mockResolvedValueOnce({ results: [{ slot: 'Lunch', item: 'Veg Thali', quantity: 4, revenue: 400 }], totalRevenue: 900 });
    reportMocks.fetchEmployeeActivityReport.mockResolvedValue({
      results: [{ id: 'c1', name: 'Emp User', empId: 'EMP-001', department: 'Ops', orderCount: 2, meals: 2, total: 200 }],
      totalRevenue: 200,
    });
  });

  it('clears loading state after reports load', async () => {
    render(<AdminBillingComponent />);
    await waitForElementToBeRemoved(() => screen.queryByText(/loading live reports/i));
    expect(screen.queryByText(/loading live reports/i)).not.toBeInTheDocument();
  });

  it('renders sales and customer rows from API reports', async () => {
    render(<AdminBillingComponent />);

    await waitFor(() => expect(reportMocks.fetchReportOrders).toHaveBeenCalled());
    expect(await screen.findByText('Veg Thali')).toBeInTheDocument();
    expect(await screen.findByText('Emp User')).toBeInTheDocument();
  });

  it('surfaces report fetch errors through toast', async () => {
    reportMocks.fetchReportOrders.mockRejectedValueOnce(new Error('reports down'));
    render(<AdminBillingComponent />);

    await waitFor(() => expect(reportMocks.toastError).toHaveBeenCalledWith('reports down'));
  });
});
