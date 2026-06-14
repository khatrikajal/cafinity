// Cafinity rebrand — logo + favicon update
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, UtensilsCrossed, CheckCircle2 } from "lucide-react";
import { confirmPasswordReset } from "@/lib/auth";
import { PasswordInput } from "@/components/PasswordInput";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
    uid: typeof search.uid === "string" ? search.uid : "",
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token, uid } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !uid) {
      setError("This link is invalid or has expired. Request a new one.");
      return;
    }

    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(token, uid, password);
      setDone(true);
      setTimeout(() => navigate({ to: "/login" }), 3000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "This link is invalid or has expired. Request a new one.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0e1730] via-[#13203f] to-[#0a1226] p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#f3ece1] p-8 shadow-2xl">
        <Link to="/login" className="mb-4 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-primary">
          <ArrowLeft className="h-3 w-3" /> Back to Login
        </Link>

        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">Create new password</div>
            <div className="text-xs text-slate-500">Choose a strong password with at least 8 characters</div>
          </div>
        </div>

        {done ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
            <div className="text-sm font-semibold text-emerald-800">Password updated successfully</div>
            <div className="mt-1 text-xs text-emerald-700">Redirecting to login in 3 seconds…</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">New Password</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Confirm Password</label>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm your password"
                className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-primary"
                required
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
                <div className="mt-2">
                  <Link to="/forgot-password" className="underline">
                    Request a new reset link
                  </Link>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow hover:opacity-90"
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
