// Cafinity rebrand — logo + favicon update
import { useState } from 'react';
import { useUIStore } from '@store/uiStore';
import type { Portal } from '@store/uiStore';
import CanteenPanel from '@components/modules/canteen/CanteenPanel';

export default function App() {
  const { isAuthenticated, role, portal, setPortal } = useUIStore();

  if (!isAuthenticated) return <LoginScreen />;
  if (role === 'admin' && !portal) return <PortalSelector onSelect={setPortal} />
  if (role === 'super_admin' && !portal) return <PortalSelector onSelect={setPortal} />;

  return (
    <div className="min-h-screen bg-gray-50">
      <CanteenPanel />
    </div>
  );
}

// ─── Shared warm background wrapper ──────────────────────────────────────────
function WarmBg({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 flex items-center justify-center">
      {/* Floating orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-yellow-300/50 blur-[100px]" />
        <div className="absolute top-1/3 -right-40 w-[480px] h-[480px] rounded-full bg-rose-400/40 blur-[120px]" />
        <div className="absolute -bottom-24 left-1/3 w-[400px] h-[400px] rounded-full bg-amber-300/50 blur-[90px]" />
        <div className="absolute top-0 right-1/4 w-[200px] h-[200px] rounded-full bg-orange-200/40 blur-[60px]" />
      </div>
      {/* Subtle grid */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}

// ─── Portal Selector ──────────────────────────────────────────────────────────
function PortalSelector({ onSelect }: { onSelect: (p: Portal) => void }) {
  const { username, logout } = useUIStore();
  return (
    <WarmBg>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-2xl bg-white/30 backdrop-blur-md border border-white/50 flex items-center justify-center shadow-lg">
            <span className="text-white font-black text-xl">C</span>
          </div>
            <img src="/assets/cafinity-logo.png" alt="Cafinity" className="h-10 w-auto rounded-lg bg-white p-1" />
        </div>

        {/* User badge */}
        <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md border border-white/30 rounded-full px-4 py-1.5 mb-6 shadow">
          <div className="w-2 h-2 rounded-full bg-green-300 animate-pulse" />
          <span className="text-white/80 text-sm">Signed in as</span>
          <span className="text-white font-bold text-sm">{username}</span>
        </div>

        <h1 className="text-4xl font-black text-white drop-shadow-md mb-2">Choose your portal</h1>
        <p className="text-white/70 mb-10 text-base">Where would you like to go today?</p>

        {/* Portal cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 w-full max-w-xl">
          {/* ESS */}
          <button
            onClick={() => onSelect('ess')}
            className="group relative text-left rounded-3xl p-7 bg-white/20 backdrop-blur-2xl border border-white/30 hover:bg-white/30 hover:-translate-y-2 hover:shadow-2xl transition-all duration-300 shadow-lg overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-3xl pointer-events-none" />
            <div className="w-14 h-14 rounded-2xl bg-white/25 border border-white/40 flex items-center justify-center text-3xl mb-5 shadow-inner">🧑‍💼</div>
            <h2 className="text-xl font-bold text-white mb-1">Employee Portal</h2>
            <p className="text-white/65 text-sm mb-5">Order meals · Track orders · View history</p>
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              Open ESS
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Admin */}
          <button
            onClick={() => onSelect('cms')}
            className="group relative text-left rounded-3xl p-7 bg-white/20 backdrop-blur-2xl border border-white/30 hover:bg-white/30 hover:-translate-y-2 hover:shadow-2xl transition-all duration-300 shadow-lg overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-3xl pointer-events-none" />
            <div className="w-14 h-14 rounded-2xl bg-white/25 border border-white/40 flex items-center justify-center text-3xl mb-5 shadow-inner">⚙️</div>
            <h2 className="text-xl font-bold text-white mb-1">Admin Portal</h2>
            <p className="text-white/65 text-sm mb-5">Manage menu · Billing · Kitchen ops</p>
            <div className="flex items-center gap-2 text-white font-semibold text-sm">
              Open Admin
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>

        <button onClick={logout} className="mt-8 text-white/50 hover:text-white/80 text-sm transition-colors">
          Sign out
        </button>
      </div>
    </WarmBg>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen() {
  const { login } = useUIStore();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const form = e.currentTarget;
    const username = (form.elements.namedItem('username') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    try {
      await login(username, password);
    } catch {
      setError('Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <WarmBg>
      <div className="flex items-center justify-center min-h-screen px-4 py-12">
        <div className="w-full max-w-5xl flex flex-col lg:flex-row gap-6 items-center">

          {/* ── Left: hero ── */}
          <div className="flex-1 text-white px-4 lg:px-8 text-center lg:text-left">
            {/* Logo */}
            <div className="flex items-center gap-3 mb-10 justify-center lg:justify-start">
              <div className="w-12 h-12 rounded-2xl bg-white/25 backdrop-blur-md border border-white/50 flex items-center justify-center shadow-xl">
                <span className="text-white font-black text-2xl">C</span>
              </div>
              <img src="/assets/cafinity-logo.png" alt="Cafinity" className="h-10 w-auto rounded-lg bg-white p-1" />
            </div>

            <h1 className="text-4xl lg:text-5xl font-black leading-tight drop-shadow-md mb-5">
              Smart canteen<br />
              <span className="text-white/90">management,</span><br />
              <span className="italic text-white/80">simplified.</span>
            </h1>
            <p className="text-white/70 text-base leading-relaxed mb-10 max-w-md mx-auto lg:mx-0">
              Manage your entire canteen operation — menu planning, order tracking, kitchen workflow, billing, and employee self-service — in one place.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
              {[
                { icon: '🏢', label: '3 Portals', sub: 'ESS · Admin · Kitchen' },
                { icon: '⚡', label: 'Real-time', sub: 'Live order tracking' },
                { icon: '💳', label: 'Digital Billing', sub: 'Auto deductions' },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-3 bg-white/15 backdrop-blur-md border border-white/25 rounded-2xl px-4 py-3 shadow">
                  <span className="text-2xl">{f.icon}</span>
                  <div>
                    <div className="text-white font-bold text-sm">{f.label}</div>
                    <div className="text-white/60 text-xs">{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-12 text-white/30 text-xs hidden lg:block">Cafinity © {new Date().getFullYear()}</p>
          </div>

          {/* ── Right: glass login card ── */}
          <div className="w-full max-w-md">
            <div className="bg-white/20 backdrop-blur-2xl border border-white/35 rounded-3xl p-8 shadow-[0_32px_64px_rgba(0,0,0,0.18)] relative overflow-hidden">
              {/* Inner shine */}
              <div className="absolute inset-0 bg-gradient-to-b from-white/20 via-transparent to-transparent rounded-3xl pointer-events-none" />

              <div className="relative z-10">
                <div className="mb-7">
                  <h2 className="text-3xl font-black text-white drop-shadow">Sign in</h2>
                  <p className="text-white/60 text-sm mt-1">Enter your credentials to continue</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Username */}
                  <div>
                    <label className="block text-xs font-bold text-white/70 uppercase tracking-widest mb-2">Username</label>
                    <input
                      name="username"
                      type="text"
                      required
                      autoFocus
                      placeholder="e.g. admin"
                      className="w-full px-4 py-3.5 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 text-white placeholder-white/40 text-sm font-medium focus:outline-none focus:border-white/70 focus:bg-white/25 transition-all duration-200 shadow-inner"
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-xs font-bold text-white/70 uppercase tracking-widest mb-2">Password</label>
                    <input
                      name="password"
                      type="password"
                      required
                      placeholder="••••••••"
                      className="w-full px-4 py-3.5 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 text-white placeholder-white/40 text-sm font-medium focus:outline-none focus:border-white/70 focus:bg-white/25 transition-all duration-200 shadow-inner"
                    />
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="flex items-center gap-2.5 bg-red-500/20 backdrop-blur-sm border border-red-300/30 text-white text-sm px-4 py-3 rounded-2xl">
                      <svg className="w-4 h-4 shrink-0 text-red-200" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      {error}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 px-4 rounded-2xl font-black text-base text-orange-600 bg-white hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-xl hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 mt-2"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Signing in…
                      </span>
                    ) : 'Sign in →'}
                  </button>
                </form>


              </div>
            </div>

            <p className="text-center text-white/30 text-xs mt-4 lg:hidden">Cafinity © {new Date().getFullYear()}</p>
          </div>

        </div>
      </div>
    </WarmBg>
  );
}
