import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Route as LoginRoute } from '@/routes/login';

const loginMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  syncAuthFromStorage: vi.fn(),
  requestEmployeeOtp: vi.fn(),
  verifyEmployeeOtp: vi.fn(),
  login: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: any) => ({ options }),
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useNavigate: () => loginMocks.navigate,
}));

vi.mock('@/store/uiStore', () => ({
  useUIStore: () => ({ syncAuthFromStorage: loginMocks.syncAuthFromStorage }),
}));

vi.mock('@/lib/auth', () => ({
  requestEmployeeOtp: loginMocks.requestEmployeeOtp,
  verifyEmployeeOtp: loginMocks.verifyEmployeeOtp,
  login: loginMocks.login,
  homeRouteFor: vi.fn(() => '/dashboard'),
}));

describe('Login OTP behavior', () => {
  const LoginComponent = LoginRoute.options.component as React.ComponentType;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows employee OTP CTA and calls request endpoint', async () => {
    loginMocks.requestEmployeeOtp.mockResolvedValue(undefined);
    render(<LoginComponent />);

    fireEvent.change(screen.getByPlaceholderText('Employee ID'), { target: { value: 'EMP-001' } });
    fireEvent.click(screen.getByRole('button', { name: /send otp/i }));

    await waitFor(() => expect(loginMocks.requestEmployeeOtp).toHaveBeenCalledWith('EMP-001'));
    expect(screen.getByRole('button', { name: /resend otp/i })).toBeInTheDocument();
  });

  it('does not show send OTP button on admin tab', () => {
    render(<LoginComponent />);

    fireEvent.click(screen.getByRole('button', { name: /^admin$/i }));

    expect(screen.queryByRole('button', { name: /send otp/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('blocks employee submit until OTP is requested', async () => {
    render(<LoginComponent />);

    fireEvent.change(screen.getByPlaceholderText('Employee ID'), { target: { value: 'EMP-001' } });
    fireEvent.change(screen.getByPlaceholderText('Enter 6-digit OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify otp/i }));

    expect(await screen.findByText(/please request otp first/i)).toBeInTheDocument();
    expect(loginMocks.verifyEmployeeOtp).not.toHaveBeenCalled();
  });

  it('verifies OTP after request and redirects', async () => {
    loginMocks.requestEmployeeOtp.mockResolvedValue(undefined);
    loginMocks.verifyEmployeeOtp.mockResolvedValue({ role: 'employee' });

    render(<LoginComponent />);

    fireEvent.change(screen.getByPlaceholderText('Employee ID'), { target: { value: 'EMP-001' } });
    fireEvent.click(screen.getByRole('button', { name: /send otp/i }));
    await waitFor(() => expect(loginMocks.requestEmployeeOtp).toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText('Enter 6-digit OTP'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify otp/i }));

    await waitFor(() => expect(loginMocks.verifyEmployeeOtp).toHaveBeenCalledWith('EMP-001', '123456'));
    await waitFor(() => expect(loginMocks.navigate).toHaveBeenCalledWith({ to: '/dashboard' }));
    expect(loginMocks.syncAuthFromStorage).toHaveBeenCalled();
  });
});
