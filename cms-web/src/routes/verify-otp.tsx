// Cafinity Fix — First Login / Password Reset Flow — June 2026
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { OtpDigitInput, formatOtpCountdown } from "@/components/OtpDigitInput";
import { homeRouteFor, verifySetPasswordOtp } from "@/lib/auth";
import { getTempPasswordToken } from "@/lib/tempPasswordStore";
import { redirectToLogin } from "@/lib/navigation";
import { useUIStore } from "@/store/uiStore";

type VerifyOtpSearch = {
  context?: string;
  debug_otp?: string;
};

export const Route = createFileRoute("/verify-otp")({
  validateSearch: (search: Record<string, unknown>): VerifyOtpSearch => ({
    context: typeof search.context === "string" ? search.context : undefined,
    debug_otp: typeof search.debug_otp === "string" ? search.debug_otp : undefined,
  }),
  component: VerifyOtpPage,
});

function VerifyOtpPage() {
  const navigate = useNavigate();
  const { context, debug_otp: debugOtp } = Route.useSearch();
  const syncAuthFromStorage = useUIStore((s) => s.syncAuthFromStorage);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [cooldown, setCooldown] = useState(45);

  useEffect(() => {
    if (context !== "set_password" || !getTempPasswordToken()) {
      redirectToLogin();
    }
    if (debugOtp) {
      setInfo(`Development mode: OTP = ${debugOtp}`);
    }
  }, [context, debugOtp]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const verifyNow = async (value: string) => {
    if (loading || value.length !== 6) return;
    setLoading(true);
    setError("");
    try {
      const user = await verifySetPasswordOtp(value);
      syncAuthFromStorage();
      navigate({ to: homeRouteFor(user.role), replace: true });
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : "OTP verification failed.";
      if (message.toLowerCase().includes("expired")) {
        setError("OTP expired. Please log in again.");
        setTimeout(() => redirectToLogin(), 1200);
        return;
      }
      setError(message);
      setOtp("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[#e4d9c7] bg-white p-6 shadow-lg">
        <h1 className="text-lg font-bold text-slate-900">Verify OTP</h1>
        <p className="mt-1 text-xs text-slate-500">
          Enter the 6-digit code sent to your registered email.
        </p>

        <div className="mt-6">
          <OtpDigitInput
            value={otp}
            onChange={setOtp}
            onComplete={verifyNow}
            disabled={loading}
          />
        </div>

        {cooldown > 0 ? (
          <p className="mt-3 text-center text-xs text-slate-500">
            Resend OTP in {formatOtpCountdown(cooldown)}
          </p>
        ) : null}

        {info ? <p className="mt-3 text-xs text-emerald-600">{info}</p> : null}
        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}
      </div>
    </div>
  );
}
