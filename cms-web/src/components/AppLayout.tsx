// Cafinity rebrand — logo + favicon update
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutGrid,
  Clock3,
  Bell,
  UtensilsCrossed,
  LogOut,
  Settings,
  ShoppingCart,
} from "lucide-react";
import type { ReactNode } from "react";
import { getCurrentUser, logoutAndRedirect } from "@/lib/auth";
import { BottomNav, type BottomNavItem } from "@/components/BottomNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useCart } from "@/lib/store";
import { useEmployeeNotifications } from "@/lib/employeeNotifications";
import { useState } from "react";


const nav: BottomNavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid, color: "bg-gradient-to-br from-orange-400 to-red-500" },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed, color: "bg-gradient-to-br from-emerald-400 to-teal-600" },
  { to: "/orders", label: "Orders", icon: Clock3, color: "bg-gradient-to-br from-blue-400 to-indigo-600" },
  { to: "/notifications", label: "Alerts", icon: Bell, color: "bg-gradient-to-br from-pink-400 to-rose-600" },
];

export function AppLayout({
  children,
  title,
  brand = "Cafinity Portal",
  user,
}: {
  children: ReactNode;
  title?: string;
  brand?: string;
  brandSub?: string;
  user?: { name: string; role: string };
  showQuickOrder?: boolean;
}) {
  const navigate = useNavigate();
  const session = typeof window !== "undefined" ? getCurrentUser() : null;
  const cart = useCart();
  const { unreadCount } = useEmployeeNotifications();
  const cartCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const displayUser = user ?? {
    name: session?.name ?? "Guest",
    role: (session?.department ?? "EMPLOYEE").toUpperCase(),
  };

  const displayName = displayUser.name || "Guest";
  const displayRole = displayUser.role || "EMPLOYEE";
  const avatarInitials = displayName
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("");

  const handleLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    logoutAndRedirect();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-xl">
        <div className="flex h-16 w-full items-center gap-4 px-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-lg shadow-primary/20">
              <img src="/assets/cafinity-logo.png" alt="Cafinity" className="h-full w-full object-contain" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold text-primary leading-tight">{brand}</div>
              <div className="text-[11px] tracking-wider text-muted-foreground">
                {title ?? "EMPLOYEE"}
              </div>
            </div>
          </div>

          {/* Search removed */}

          {/* Right-side controls: Actions (notification, cart) + User details */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => navigate({ to: "/notifications" })}
              className="relative rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => navigate({ to: "/cart" })}
              className="relative rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ShoppingCart className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white animate-bounce-gentle">
                  {cartCount}
                </span>
              )}
            </button>

            {/* User section with left border */}
            <div className="flex items-center gap-3 border-l border-border pl-4">
              <div className="hidden text-right sm:block">
                <div className="text-sm font-semibold leading-tight">{displayName}</div>
                <div className="text-[11px] tracking-wider text-muted-foreground">
                  {displayRole}
                </div>
              </div>
              <div className="h-10 w-10 overflow-hidden rounded-xl bg-gradient-to-br from-primary to-amber-600 ring-2 ring-primary/20">
                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-white">
                  {avatarInitials}
                </div>
              </div>
              <ThemeToggle />
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                aria-label="Logout"
              >
                {isLoggingOut ? "..." : <LogOut className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full flex-1 px-4 py-6 pb-32 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Bottom Navigation */}
      <BottomNav items={nav} />
    </div>
  );
}
