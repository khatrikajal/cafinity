// Cafinity rebrand — logo + favicon update
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  AlertCircle,
  User,
  Lock,
  Pizza,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  login,
  homeRouteFor,
  requestEmployeeOtp,
  verifyEmployeeOtp,
  confirmPasswordReset,
  type AuthActionResponse,
  type Role
} from "@/lib/auth";
import { useUIStore } from "@/store/uiStore";
import { PasswordInput } from "@/components/PasswordInput";
import { OtpDigitInput, formatOtpCountdown } from "@/components/OtpDigitInput";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    reason: typeof search.reason === "string" ? search.reason : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: Login,
});

const assetBase = import.meta.env.BASE_URL || "/";
const holdingCharacter = `${assetBase}login-card-holder.png`;

const heroCharacter = `${assetBase}food-character-3.png`;
const cafinityLogo = `${assetBase}assets/cafinity-logo.png`;

function LoginBrand() {
  return (
    <div className="absolute left-4 top-4 z-50 sm:left-6 sm:top-5 md:left-8 md:top-6">
      <img src={cafinityLogo} alt="Cafinity" className="h-20 w-auto select-none" />
    </div>
  );
}

function Login() {
  const navigate = useNavigate();
  const { reason, next } = Route.useSearch();
  const { syncAuthFromStorage } = useUIStore();
  const [tab, setTab] = useState<Role>("employee");
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [rememberMe, setRememberMe] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // New state for action_required flows
  const [authAction, setAuthAction] = useState<"password_reset" | "otp_verification" | null>(null);
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [otpReference, setOtpReference] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const verifyOtpNow = async (otpValue = pin.trim()) => {
    setError("");
    if (!/^\d{6}$/.test(otpValue)) {
      setError("OTP must be 6 digits");
      return;
    }

    setLoading(true);
    try {
      const result = await verifyEmployeeOtp(username || id.trim(), otpValue, otpReference);
      syncAuthFromStorage();
      await new Promise((resolve) => setTimeout(resolve, 400));
      navigate({ to: homeRouteFor(result.role) });
    } catch (err) {
      setPin("");
      const errorMsg = err instanceof Error ? err.message : "OTP verification failed";
      if (errorMsg.toLowerCase().includes("network") || errorMsg.toLowerCase().includes("fetch")) {
        setError("Connection issue. Please check your internet and retry.");
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (reason === "session_expired") {
      setInfo("Your session expired. Please log in again.");
    } else if (reason === "inactivity") {
      setInfo("You were logged out due to inactivity.");
    }
  }, [reason]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = setInterval(() => {
      setOtpCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCooldown]);

  const handleTabChange = (nextTab: Role) => {
    setTab(nextTab);
    setInfo("");
    setError("");
    setOtpRequested(false);
    setPin("");
    setAuthAction(null);
    setOtpReference("");
  };

  const handleRequestOtp = async () => {
    setInfo("");
    setError("");
    if (!id.trim()) {
      setError("Employee ID is required");
      return;
    }

    try {
      const loginId = (authAction ? username : id).trim();
      if (!loginId) {
        setError("Employee ID is required");
        return;
      }

      setOtpLoading(true);
      const result = await requestEmployeeOtp(loginId, otpReference);
      if (result.otp_reference) {
        setOtpReference(result.otp_reference);
      }
      setOtpRequested(true);
      setOtpCooldown(30);
      setPin("");
      if (result.debug_otp) {
        setInfo("Development mode: OTP = " + result.debug_otp + ". Valid for 10 minutes.");
      } else {
        setInfo("OTP has been sent to your registered email address.");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to send OTP";
      // Provide more specific error guidance for first-time users
      if (errorMsg.toLowerCase().includes("not found")) {
        setError("Employee ID not found. Please check and try again.");
      } else if (errorMsg.toLowerCase().includes("inactive")) {
        setError("Your account is inactive. Please contact your administrator.");
      } else if (errorMsg.toLowerCase().includes("first-login")) {
        setError("Please log in with your password first to use OTP.");
      } else {
        setError(errorMsg);
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!newPassword || !confirmPassword) {
      setError("Please enter and confirm your new password");
      setLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      setLoading(false);
      return;
    }

    try {
      await confirmPasswordReset(resetToken, userId, newPassword);
      setInfo("Password reset successful. Please log in again.");
      setAuthAction(null);
      setResetToken("");
      setNewPassword("");
      setConfirmPassword("");
      setPin("");
      setOtpRequested(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (authAction === "otp_verification") {
      setLoading(false);
      setError("Click VERIFY OTP button to submit the OTP you entered.");
      return;
    }

    // Validation
    if (tab === "employee") {
      if (pin.length < 8) {
        setError("Password must be at least 8 characters");
        setLoading(false);
        return;
      }
    } else if (tab === "kitchen") {
      if (!/^\d{4,6}$/.test(pin)) {
        setError("PIN must be 4 to 6 digits");
        setLoading(false);
        return;
      }
    } else {
      if (pin.length < 6) {
        setError("Password must be at least 6 characters");
        setLoading(false);
        return;
      }
    }

    try {
      // For employee, try password-based login first (may require password reset or OTP)
      let result;
      if (tab === "employee") {
        result = await login(tab, id.trim(), pin.trim());

        if ("mustChangePassword" in result && result.mustChangePassword) {
          navigate({ to: "/set-password", replace: true });
          setLoading(false);
          return;
        }

        // Check if action is required
        if ((result as AuthActionResponse).action_required === "otp_verification") {
          const actionResult = result as AuthActionResponse;
          setAuthAction("otp_verification");
          setUserId(actionResult.user_id);
          setUsername(actionResult.username);
          setOtpReference(actionResult.otp_reference ?? "");
          setInfo(actionResult.detail);
          setPin("");
          setOtpRequested(true);
          setLoading(false);
          return;
        }
      } else {
        result = await login(tab, id.trim(), pin.trim());
      }

      // Successful login (auth.login returns a user session object with role)
      if (result && "role" in result) {
        syncAuthFromStorage();
        await new Promise((resolve) => setTimeout(resolve, 400));
        navigate({ to: next || homeRouteFor(result.role) });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Login failed";
      // Provide more specific error guidance for first-time users
      if (errorMsg.toLowerCase().includes("invalid credentials")) {
        setError("Invalid " + (tab === "employee" ? "Employee ID or Password" : tab === "kitchen" ? "Kitchen ID or PIN" : "Admin ID or Password") + ". Please try again.");
      } else if (errorMsg.toLowerCase().includes("temporarily locked")) {
        setError("This account is temporarily locked after too many failed attempts. Please wait 15 minutes and try again.");
      } else if (errorMsg.toLowerCase().includes("not an admin")) {
        setError("This account is not an admin. Switch to the Employee tab or use the correct admin credentials.");
      } else if (errorMsg.toLowerCase().includes("not an employee")) {
        setError("This account is not an employee. Switch to the Admin tab if you are logging in as an administrator.");
      } else if (errorMsg.toLowerCase().includes("inactive")) {
        setError("Your account is inactive. Please contact your administrator.");
      } else if (errorMsg.toLowerCase().includes("disabled")) {
        setError("Your account has been disabled. Please contact your administrator.");
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = authAction === "password_reset" ? handlePasswordReset : handleLoginSubmit;

  return (
    <div className="relative min-h-screen overflow-x-hidden overflow-y-auto bg-[#fbf8f2] md:fixed md:inset-0 md:overflow-hidden">
      <div className="absolute inset-0">
        <svg
          className="desktop-only absolute right-0 top-0 h-full"
          style={{ width: "63%" }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="loginBgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffefb9" />
              <stop offset="55%" stopColor="#fde7a7" />
              <stop offset="100%" stopColor="#f8dd94" />
            </linearGradient>
          </defs>
          <path
            d="M28,0
               C18,8 16,24 18,36
               C20,46 28,52 36,55
               C46,59 51,68 49,80
               C47,93 55,100 71,100
               L100,100 L100,0 Z"
            fill="url(#loginBgGradient)"
          />
        </svg>

        <div className="desktop-only absolute right-[10%] top-[18%]">
          <div className="flex h-10 w-10 rotate-[16deg] items-center justify-center rounded-full bg-white/70 text-[23px] shadow-md">
            <Pizza className="h-5 w-5 text-[#df734f]" />
          </div>
        </div>
      </div>

      <LoginBrand />

      <div className="absolute left-0 top-0 flex min-h-screen w-full items-start md:h-full">
        <div
          className="relative z-20 w-full px-4 pb-10 pt-24 sm:px-6 md:w-[50%] md:px-10 md:pt-40 lg:w-[46%] lg:px-12 lg:pt-36 xl:pl-24"
        >
          <div className="relative max-w-[470px] md:ml-20 lg:ml-28">
            <div
              className="desktop-only pointer-events-none absolute left-0 top-1/2 z-30 -translate-x-[78%] -translate-y-[43%]"
              style={{ width: "300px" }}
            >
              <img
                src={holdingCharacter}
                alt="Mascot holding the login card"
                className="w-full"
              />
            </div>

            <div className="relative z-20 rounded-[28px] border border-[#f1e5d0] bg-white p-4 shadow-[0_20px_48px_-28px_rgba(90,69,36,0.25)] sm:p-6 md:p-7 lg:p-8">
              <h3 className="mb-5 text-center text-sm font-semibold uppercase tracking-[0.24em] text-[#df734f]">
                {authAction === "password_reset" ? "Reset Your Password" : authAction === "otp_verification" ? "Verify with OTP" : "Please Login to Continue"}
              </h3>

              {!authAction && (
                <div className="mb-5 flex rounded-2xl bg-[#f7f1e4] p-1 text-[11px] font-semibold sm:text-xs">
                  {(["employee", "kitchen", "admin"] as const).map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleTabChange(role)}
                      className={`flex-1 rounded-xl py-2.5 capitalize transition-all duration-300 ${tab === role
                          ? "bg-[#df734f] text-white shadow-lg shadow-[#df734f]/30"
                          : "text-slate-500 hover:text-slate-700"
                        }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" onKeyDown={(e) => {
                // Ensure arrow keys and tab work in inputs
                if (e.key === "Tab" || e.key.startsWith("Arrow")) {
                  e.target?.dispatchEvent?.(new Event("input", { bubbles: true }));
                }
              }}>
                {/* Password Reset Form */}
                {authAction === "password_reset" && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">
                        Employee ID
                      </label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          value={id}
                          disabled
                          className="w-full rounded-2xl border-2 border-[#e4d9c7] bg-[#f0ebe2] py-3 pl-11 pr-4 text-sm text-slate-600 outline-none disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">
                        New Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <PasswordInput
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="At least 8 characters"
                          className="w-full rounded-2xl border-2 border-[#e4d9c7] bg-[#fcfaf4] py-3 pl-11 pr-12 text-sm text-slate-900 outline-none transition-all focus:border-[#df734f] focus:bg-white focus:shadow-lg focus:shadow-[#df734f]/10"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <PasswordInput
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm your password"
                          className="w-full rounded-2xl border-2 border-[#e4d9c7] bg-[#fcfaf4] py-3 pl-11 pr-12 text-sm text-slate-900 outline-none transition-all focus:border-[#df734f] focus:bg-white focus:shadow-lg focus:shadow-[#df734f]/10"
                          required
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* OTP Verification Form */}
                {authAction === "otp_verification" && (
                  <div>
                    <label className="mb-3 block text-center text-xs font-medium text-slate-500">
                      Enter 6-digit OTP
                    </label>
                    <OtpDigitInput
                      value={pin}
                      onChange={setPin}
                      onComplete={(value) => verifyOtpNow(value)}
                      disabled={loading}
                    />
                    {otpCooldown > 0 ? (
                      <p className="mt-3 text-center text-xs text-slate-500">
                        Resend OTP in {formatOtpCountdown(otpCooldown)}
                      </p>
                    ) : null}
                  </div>
                )}

                {/* Normal Login Form */}
                {!authAction && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">
                        {tab === "employee"
                          ? "Employee ID"
                          : tab === "kitchen"
                            ? "Chef ID"
                            : "Admin ID"}
                      </label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          value={id}
                          onChange={(e) => setId(e.target.value)}
                          placeholder={tab === "employee" ? "Employee ID" : tab === "kitchen" ? "Kitchen ID" : "Admin ID"}
                          className="w-full rounded-2xl border-2 border-[#e4d9c7] bg-[#fcfaf4] py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition-all focus:border-[#df734f] focus:bg-white focus:shadow-lg focus:shadow-[#df734f]/10"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-500">
                        {tab === "employee" ? "Password" : "Password / PIN"}
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        <PasswordInput
                          value={pin}
                          onChange={(e) => setPin(e.target.value)}
                          placeholder={tab === "employee" ? "Enter your password" : "****"}
                          maxLength={tab === "kitchen" ? 6 : undefined}
                          className="w-full rounded-2xl border-2 border-[#e4d9c7] bg-[#fcfaf4] py-3 pl-11 pr-12 text-sm text-slate-900 outline-none transition-all focus:border-[#df734f] focus:bg-white focus:shadow-lg focus:shadow-[#df734f]/10"
                          required
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex cursor-pointer items-center gap-2 text-slate-600">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-primary accent-primary"
                        />
                        <span className="text-xs">Remember me</span>
                      </label>
                      <Link
                        to="/forgot-password"
                        className="text-xs font-medium text-slate-500 transition-colors hover:text-[#df734f] sm:text-right"
                      >
                        Forgot Password
                      </Link>
                    </div>
                  </>
                )}

                {error && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-600">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {info && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                    {info}
                  </div>
                )}

                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                  {authAction === "otp_verification" && (
                    <button
                      type="button"
                      onClick={handleRequestOtp}
                      disabled={otpLoading || otpCooldown > 0}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[#df734f] bg-white py-3.5 text-sm font-bold text-[#df734f] transition-all hover:bg-[#fff5ef] disabled:opacity-60"
                    >
                      {otpLoading
                        ? "Sending OTP..."
                        : otpRequested
                          ? "Resend OTP"
                          : "Send OTP"}
                    </button>
                  )}
                  <button
                    type={authAction === "otp_verification" ? "button" : "submit"}
                    onClick={authAction === "otp_verification" ? () => verifyOtpNow() : undefined}
                    disabled={loading || authAction === "otp_verification"}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#df734f] to-[#ef9b5b] py-3.5 text-sm font-bold text-white shadow-xl shadow-[#df734f]/35 transition-all hover:shadow-2xl hover:shadow-[#df734f]/40 disabled:opacity-60 ${authAction === "otp_verification" ? "hidden" : ""}`}
                  >
                    {loading ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : authAction === "password_reset" ? (
                      <>
                        <ArrowRight className="h-4 w-4" />
                        RESET PASSWORD
                      </>
                    ) : authAction === "otp_verification" ? (
                      <>
                        <ArrowRight className="h-4 w-4" />
                        VERIFY OTP
                      </>
                    ) : (
                      <>
                        <ArrowRight className="h-4 w-4" />
                        LOGIN
                      </>
                    )}
                  </button>
                  {authAction && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthAction(null);
                        setNewPassword("");
                        setConfirmPassword("");
                        setResetToken("");
                        setPin("");
                        setError("");
                        setInfo("");
                      }}
                      className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white py-3.5 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50"
                    >
                      Back to Login
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      <div className="desktop-only pointer-events-none absolute right-[15%] top-[18%] z-10 lg:right-[11%] lg:top-[8%]">
        <img
          src={heroCharacter}
          alt="Food character on yellow background"
          className="h-auto w-[320px] object-contain lg:w-[410px] xl:w-[460px]"
          style={{ filter: "drop-shadow(0 32px 48px rgba(111, 84, 28, 0.22))" }}
        />
      </div>

      <div className="desktop-only absolute bottom-10 right-10 z-20 text-right">
        <p className="text-xl font-black tracking-tight text-[#df734f] lg:text-[34px]">
          A TASTE BEYOND
        </p>
        <p className="text-xl font-black tracking-tight text-[#df734f] lg:text-[34px]">
          YOUR IMAGINATION
        </p>
      </div>

      <style>{`
        @keyframes brandFloat {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-4px);
          }
        }

        @keyframes brandSteam {
          0% {
            opacity: 0;
            transform: translateY(8px) scale(0.92);
          }
          35% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translateY(-18px) scale(1.08);
          }
        }

        @keyframes brandShine {
          0% {
            transform: translateX(-120%) skewX(-18deg);
          }
          60%, 100% {
            transform: translateX(220%) skewX(-18deg);
          }
        }

        .desktop-only {
          display: none;
        }

        .login-brand-mark {
          animation: brandFloat 4.4s ease-in-out infinite;
        }

        .login-brand-steam {
          animation: brandSteam 2.8s ease-in-out infinite;
        }

        .login-brand-steam-delay {
          animation-delay: 0.42s;
        }

        .login-brand-shine {
          animation: brandShine 3.8s ease-in-out infinite;
        }

        @media (min-width: 768px) {
          .desktop-only {
            display: block;
          }
        }

        @media (max-width: 767px) {
          .fixed > div:first-child svg {
            display: none;
          }
        }

        /* Ensure form inputs always remain interactive */
        form input,
        form button,
        form label {
          pointer-events: auto;
        }

        /* Prevent accidental event blocking on parent containers */
        form > div {
          pointer-events: auto;
        }
      `}</style>
    </div>
  );
}

