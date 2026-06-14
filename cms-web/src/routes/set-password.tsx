// Cafinity Fix — First Login / Password Reset Flow — June 2026
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PasswordInput } from "@/components/PasswordInput";
import { initiateSetPassword } from "@/lib/auth";
import { evaluatePasswordStrength, isStrongEnoughPassword } from "@/lib/passwordStrength";
import { getTempPasswordToken, hasPendingPasswordChange } from "@/lib/tempPasswordStore";
import { redirectToLogin } from "@/lib/navigation";

export const Route = createFileRoute("/set-password")({
  component: SetPasswordPage,
});

function SetPasswordPage() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const strength = useMemo(() => evaluatePasswordStrength(newPassword), [newPassword]);

  useEffect(() => {
    if (!getTempPasswordToken() && !hasPendingPasswordChange()) {
      redirectToLogin();
    }
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!isStrongEnoughPassword(newPassword)) {
      setError("Password must be at least 8 characters with uppercase, lowercase, number, and special character.");
      return;
    }

    setLoading(true);
    try {
      const result = await initiateSetPassword(newPassword);
      navigate({
        to: "/verify-otp",
        search: { context: "set_password", debug_otp: result.debug_otp },
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to start password verification.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbf8f2] p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl border border-[#e4d9c7] bg-white p-6 shadow-lg"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-[#df734f]/10 p-2 text-[#df734f]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Set Your Password</h1>
            <p className="text-xs text-slate-500">Required before you can access your dashboard.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">New Password</label>
            <PasswordInput
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="Create a strong password"
              className="w-full rounded-xl border border-[#e4d9c7] bg-[#fcfaf4] px-3 py-2 text-sm outline-none focus:border-[#df734f]"
              required
            />
            {newPassword ? (
              <p className={`mt-1 text-xs font-medium ${
                strength === "strong" ? "text-emerald-600" : strength === "medium" ? "text-amber-600" : "text-rose-600"
              }`}>
                Strength: {strength}
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Confirm Password</label>
            <PasswordInput
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              className="w-full rounded-xl border border-[#e4d9c7] bg-[#fcfaf4] px-3 py-2 text-sm outline-none focus:border-[#df734f]"
              required
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-rose-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded-xl bg-[#df734f] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? "Sending OTP..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
