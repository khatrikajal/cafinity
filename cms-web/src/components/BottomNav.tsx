import { Link, useLocation } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

export type BottomNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  color?: string;
};

export function BottomNav({ items }: { items: BottomNavItem[] }) {
  const location = useLocation();
  const shouldStretchDesktop = items.length > 5;

  function isNavActive(pathname: string, to: string) {
    if (to === "/admin") {
      return pathname === "/admin" || pathname === "/admin/";
    }
    return pathname === to || pathname.startsWith(`${to}/`);
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40"
      aria-label="Primary navigation"
    >
      {/* Gradient backdrop */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/95 to-transparent pointer-events-none" />

      <div
        className={`relative mx-auto px-2 pb-4 pt-2 sm:pb-6 sm:pt-3 ${
          shouldStretchDesktop ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        {/* Glass container */}
        <div
          className={`rounded-2xl border border-border/50 bg-card/80 p-1.5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-2 ${
            shouldStretchDesktop ? "w-full" : "w-full sm:w-fit sm:min-w-[420px]"
          } ${shouldStretchDesktop ? "" : "sm:mx-auto"}`}
        >
          <ul
            className={`flex items-center justify-start gap-1 overflow-x-auto px-1 hide-scrollbar sm:overflow-visible sm:px-0 ${
              shouldStretchDesktop
                ? "sm:grid sm:gap-0"
                : "sm:flex sm:justify-center sm:gap-4"
            }`}
            style={shouldStretchDesktop && items.length > 0
              ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }
              : undefined}
          >
            {items.map((item) => {
              const active = isNavActive(location.pathname, item.to);

              return (
                <li
                  key={item.to}
                  className={`relative shrink-0 ${shouldStretchDesktop ? "sm:min-w-0" : ""}`}
                >
                  <Link
                    to={item.to}
                    aria-label={item.label}
                    className={`group relative flex min-w-[68px] flex-col items-center gap-1 rounded-xl px-2 py-2 transition-all duration-300 ${
                      shouldStretchDesktop ? "sm:min-w-0 sm:px-1" : "sm:min-w-[104px] sm:px-4"
                    } ${
                      active ? "bg-primary/10" : "hover:bg-muted/50"
                    }`}
                  >
                    {/* Icon container with bounce animation */}
                    <span
                      className={`relative flex h-10 w-10 items-center justify-center rounded-xl text-white transition-all duration-300 sm:h-11 sm:w-11 ${
                        item.color ?? "bg-gradient-to-br from-primary to-orange-600"
                      } ${active ? "scale-105 shadow-lg" : "scale-100 opacity-85 group-hover:opacity-100"}`}
                    >
                      <item.icon className="h-4 w-4 stroke-[2.2] sm:h-5 sm:w-5" />

                      {/* Active indicator ring */}
                      {active && (
                        <span className="absolute inset-0 rounded-xl ring-2 ring-primary/25" />
                      )}
                    </span>

                    {/* Label */}
                    <span
                      className={`text-[9px] font-semibold transition-all duration-300 sm:text-[10px] ${
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </span>

                    {/* Active dot indicator */}
                    {active && (
                      <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary shadow-lg shadow-primary/50" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
