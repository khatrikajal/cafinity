import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";

import appCss from "../styles.css?url";
import { ensureAuthInitialized } from "@/lib/auth";
import { authorizeRoute } from "@/lib/routeAuthorization";
import { sessionService } from "@/services/sessionService";
import { useUIStore } from "@/store/uiStore";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-muted">
          <span className="text-5xl">🍽️</span>
        </div>
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-all hover:shadow-primary/40"
          >
            Go to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    await authorizeRoute(location.pathname);
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Canteen Portal - Corporate Food Ordering" },
      { name: "description", content: "Order delicious meals from your corporate canteen. Fast, easy, and convenient food ordering system." },
      { name: "author", content: "Canteen Portal" },
      { property: "og:title", content: "Canteen Portal" },
      { property: "og:description", content: "Order delicious meals from your corporate canteen" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Canteen Portal" },
      { name: "twitter:description", content: "Order delicious meals from your corporate canteen" },
      { name: "theme-color", content: "#f97316" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}


function RootComponent() {
  const { syncAuthFromStorage } = useUIStore();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  useEffect(() => {
    void ensureAuthInitialized();
    syncAuthFromStorage();
    sessionService.bindInactivityListeners();
  }, [syncAuthFromStorage]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster
        position="top-right"
        expand={false}
        richColors
        closeButton
        toastOptions={{
          style: {
            borderRadius: "12px",
          },
          className: "font-sans",
        }}
      />
    </QueryClientProvider>
  );
}
