import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TablePanelProps = {
  title: string;
  description?: string;
  summary?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function TablePanel({
  title,
  description: _description,
  summary,
  actions,
  footer,
  children,
  className,
}: TablePanelProps) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-sm", className)}>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-bold">{title}</h3>
        </div>
        {actions || summary ? (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {summary}
            {actions}
          </div>
        ) : null}
      </div>
      {children}
      {footer}
    </div>
  );
}
