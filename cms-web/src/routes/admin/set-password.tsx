// Cafinity Fix — First Login / Password Reset Flow — June 2026
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/admin/set-password")({
  component: AdminSetPasswordRedirect,
});

function AdminSetPasswordRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/set-password", replace: true });
  }, [navigate]);

  return null;
}
