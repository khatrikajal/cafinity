// Cafinity rebrand — logo + favicon update
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  Lock,
  Search,
  ShieldAlert,
  SortAsc,
  SortDesc,
} from "lucide-react";

import {
  exportAuditLogsCsv,
  fetchAuditLogDetail,
  fetchAuditLogs,
  fetchAuditSummary,
  type AuditLogEntry,
  type AuditLogFilters,
  type AuditSummaryResponse,
} from "@/api/admin";
import { Pagination } from "@/components/Pagination";
import { TablePanel } from "@/components/TablePanel";
import { AdminLayout, getExactRoleType } from "@/routes/admin-orders";
import { getCurrentUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/admin/audit-logs")({
  component: AuditLogsPage,
});

type SortKey = "timestamp" | "actor_email" | "action_category";
type SortOrder = "asc" | "desc";

// All role_type values that are allowed to view audit logs.
// SUPER_ADMIN sees sensitive fields; other admin roles see non-sensitive entries.
const AUDIT_ALLOWED_ROLES = new Set([
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "HR_MANAGER",
  "PAYROLL_MANAGER",
  "LIMITED_ADMIN",
]);

const CATEGORY_COLORS: Record<string, string> = {
  AUTH: "bg-blue-100 text-blue-800",
  MENU: "bg-green-100 text-green-800",
  SLOT: "bg-orange-100 text-orange-800",
  CANTEEN: "bg-purple-100 text-purple-800",
  GUEST_MENU: "bg-teal-100 text-teal-800",
  ORDERS: "bg-red-100 text-red-800",
  EVENTS: "bg-yellow-100 text-yellow-800",
  SETTINGS: "bg-gray-200 text-gray-800",
  PERMISSIONS: "bg-pink-100 text-pink-800",
  USER_MGMT: "bg-indigo-100 text-indigo-800",
};

const CATEGORY_ACTIONS: Record<string, string[]> = {
  AUTH: ["login", "logout", "login_failed", "password_change", "password_reset", "first_time_password_set", "account_locked"],
  USER_MGMT: ["employee_created", "employee_updated", "employee_activated", "employee_deactivated", "employee_offboarded"],
  MENU: ["menu_item_created", "menu_item_updated", "menu_item_deleted", "menu_item_availability_toggled", "price_updated", "description_updated", "category_created", "category_deleted"],
  SLOT: ["slot_created", "slot_updated", "slot_deleted", "item_mapped_to_slot", "item_removed_from_slot", "bulk_slot_mapping_done", "slot_closed", "slot_reopened"],
  CANTEEN: ["canteen_created", "canteen_updated", "canteen_closure_created", "canteen_closure_cancelled", "canteen_mapped_to_employee"],
  GUEST_MENU: ["guest_item_created", "guest_item_updated", "guest_item_deleted", "guest_menu_published", "guest_menu_unpublished"],
  ORDERS: ["order_status_changed", "order_cancelled_by_admin", "subscription_cancelled_by_admin"],
  EVENTS: ["event_created", "event_updated", "event_deleted", "event_published", "event_unpublished"],
  SETTINGS: ["smtp_config_changed", "notification_template_updated", "system_setting_changed"],
  PERMISSIONS: ["limited_admin_created", "limited_admin_role_changed", "limited_admin_deactivated", "permission_granted", "permission_revoked"],
};

function AuditLogsPage() {
  const navigate = useNavigate();
  const [roleType, setRoleType] = useState(() => getExactRoleType(getCurrentUser()));
  const [activeTab, setActiveTab] = useState<"logs" | "summary">("logs");

  useEffect(() => {
    const role = getExactRoleType(getCurrentUser());
    setRoleType(role);
    if (role && !AUDIT_ALLOWED_ROLES.has(role)) {
      navigate({ to: "/admin", replace: true });
    }
  }, [navigate]);

  if (!roleType || !AUDIT_ALLOWED_ROLES.has(roleType)) {
    return null;
  }

  return (
    <AdminLayout crumb="Audit Logs">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "logs" | "summary")}>
        <TabsList>
          <TabsTrigger value="logs">Audit Logs</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>
        <TabsContent value="logs">
          <AuditLogList isSuperAdmin={roleType === "SUPER_ADMIN"} />
        </TabsContent>
        <TabsContent value="summary">
          <AuditSummaryTab isSuperAdmin={roleType === "SUPER_ADMIN"} />
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

function AuditLogList({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("ALL");
  const [action, setAction] = useState("ALL");
  const [actorEmail, setActorEmail] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AuditLogEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const actionOptions = useMemo(
    () => (category === "ALL" ? [] : (CATEGORY_ACTIONS[category] ?? [])),
    [category],
  );

  useEffect(() => {
    if (action !== "ALL" && !actionOptions.includes(action)) {
      setAction("ALL");
    }
  }, [action, actionOptions]);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setError("");
    const params: AuditLogFilters = {
      page,
      page_size: 50,
      actor_email: actorEmail || undefined,
      action_category: category !== "ALL" ? category : undefined,
      action: action !== "ALL" ? action : undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      is_sensitive: sensitiveOnly || undefined,
      search: search || undefined,
    };
    fetchAuditLogs(params)
      .then((data) => {
        if (ignore) return;
        setRows(data.results);
        setCount(data.count);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        setRows([]);
        setCount(0);
        setError((err as Error).message || "Failed to load audit logs.");
      })
      .finally(() => {
        if (!ignore) setIsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [page, actorEmail, category, action, fromDate, toDate, sensitiveOnly, search]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((left, right) => {
      const leftValue = String(left[sortKey] ?? "");
      const rightValue = String(right[sortKey] ?? "");
      if (sortKey === "timestamp") {
        const delta = new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
        return sortOrder === "asc" ? delta : -delta;
      }
      const delta = leftValue.localeCompare(rightValue);
      return sortOrder === "asc" ? delta : -delta;
    });
    return list;
  }, [rows, sortKey, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(count / 50));

  const openDetail = (logId: string) => {
    setSelectedLogId(logId);
    setDetailLoading(true);
    fetchAuditLogDetail(logId)
      .then((item) => setSelectedDetail(item))
      .catch(() => {
        const fallback = rows.find((row) => row.id === logId) ?? null;
        setSelectedDetail(fallback);
      })
      .finally(() => setDetailLoading(false));
  };

  const downloadFilteredCsv = async () => {
    const params: Omit<AuditLogFilters, "page" | "page_size"> = {
      actor_email: actorEmail || undefined,
      action_category: category !== "ALL" ? category : undefined,
      action: action !== "ALL" ? action : undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      is_sensitive: sensitiveOnly || undefined,
      search: search || undefined,
    };
    const { blob } = await exportAuditLogsCsv(params);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "audit_logs.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2 xl:grid-cols-7">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-sm">
          <option value="ALL">All Categories</option>
          {Object.keys(CATEGORY_COLORS).map((entry) => (
            <option key={entry} value={entry}>{entry}</option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-sm">
          <option value="ALL">All Actions</option>
          {actionOptions.map((entry) => (
            <option key={entry} value={entry}>{humanizeAction(entry)}</option>
          ))}
        </select>
        <input
          placeholder="Actor email"
          value={actorEmail}
          onChange={(e) => setActorEmail(e.target.value)}
          className="rounded border border-border bg-background px-3 py-2 text-sm"
        />
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-sm" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded border border-border bg-background px-3 py-2 text-sm" />
        <label className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2 text-sm">
          <input type="checkbox" checked={sensitiveOnly} onChange={(e) => setSensitiveOnly(e.target.checked)} />
          Sensitive only
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-border bg-background py-2 pl-8 pr-3 text-sm"
            />
          </div>
          <button onClick={downloadFilteredCsv} className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <TablePanel title="Audit Logs" description={`${count} total logs`}>
        {isLoading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading audit logs...</div>
        ) : sortedRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No audit logs found for the selected filters</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortButton label="Timestamp" active={sortKey === "timestamp"} order={sortOrder} onClick={() => toggleSort(sortKey, sortOrder, setSortKey, setSortOrder, "timestamp")} /></TableHead>
                <TableHead><SortButton label="Actor" active={sortKey === "actor_email"} order={sortOrder} onClick={() => toggleSort(sortKey, sortOrder, setSortKey, setSortOrder, "actor_email")} /></TableHead>
                <TableHead><SortButton label="Category" active={sortKey === "action_category"} order={sortOrder} onClick={() => toggleSort(sortKey, sortOrder, setSortKey, setSortOrder, "action_category")} /></TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Changed Fields</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatTimestamp(entry.timestamp)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">
                        {initials(entry.actor_name || entry.actor_email)}
                      </span>
                      <div className="space-y-0.5">
                        <div className="text-xs">{entry.actor_email || "SYSTEM"}</div>
                        <Badge variant="secondary">{entry.actor_role || entry.actor_type}</Badge>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${CATEGORY_COLORS[entry.action_category] ?? "bg-muted text-muted-foreground"}`}>
                      {entry.is_sensitive && <Lock className="h-3 w-3" />}
                      {entry.action_category}
                    </span>
                  </TableCell>
                  <TableCell>{humanizeAction(entry.action)}</TableCell>
                  <TableCell className="max-w-[240px] truncate">{`[${entry.target_model || "N/A"}] — ${entry.target_display || "N/A"}`}</TableCell>
                  <TableCell>
                    <ChangedFieldsCell entry={entry} isSuperAdmin={isSuperAdmin} />
                  </TableCell>
                  <TableCell><span className="font-mono text-xs">{entry.ip_address || "-"}</span></TableCell>
                  <TableCell>
                    <button
                      onClick={() => openDetail(entry.id)}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      <Eye className="h-3 w-3" /> View
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={count} pageSize={50} />
      </TablePanel>

      <AuditDetailDrawer
        open={Boolean(selectedLogId)}
        entry={selectedDetail}
        loading={detailLoading}
        onClose={() => {
          setSelectedLogId(null);
          setSelectedDetail(null);
        }}
        isSuperAdmin={isSuperAdmin}
      />
    </div>
  );
}

function AuditSummaryTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [summary, setSummary] = useState<AuditSummaryResponse | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditLogEntry[]>([]);
  const [passwordLogs, setPasswordLogs] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);
    const from = fromDate.toISOString().slice(0, 10);

    Promise.all([
      fetchAuditSummary(),
      fetchAuditLogs({ page: 1, page_size: 200, from_date: from }),
      fetchAuditLogs({ page: 1, page_size: 50, action_category: "AUTH", is_sensitive: true }),
    ])
      .then(([summaryData, recentData, passwordData]) => {
        if (ignore) return;
        setSummary(summaryData);
        setRecentLogs(recentData.results);
        setPasswordLogs(passwordData.results.filter((entry) =>
          ["password_change", "password_reset", "first_time_password_set"].includes(entry.action),
        ));
      })
      .catch((err: unknown) => {
        if (ignore) return;
        setError((err as Error).message || "Failed to load summary");
      });
    return () => {
      ignore = true;
    };
  }, []);

  const topActors = useMemo(() => {
    const map = new Map<string, { email: string; role: string; total: number; lastAction: string }>();
    recentLogs.forEach((entry) => {
      const key = entry.actor_email || "SYSTEM";
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          email: key,
          role: entry.actor_role || entry.actor_type,
          total: 1,
          lastAction: entry.timestamp,
        });
      } else {
        existing.total += 1;
        if (new Date(entry.timestamp).getTime() > new Date(existing.lastAction).getTime()) {
          existing.lastAction = entry.timestamp;
        }
      }
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [recentLogs]);

  const bars = useMemo(() => buildCategoryBars(recentLogs), [recentLogs]);

  return (
    <div className="mt-4 space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="Total Today" value={summary?.total_today ?? 0} />
        <SummaryCard label="Auth Events" value={summary?.by_category?.AUTH ?? 0} />
        <SummaryCard label="Menu Changes" value={summary?.by_category?.MENU ?? 0} />
        <SummaryCard label="Slot Changes" value={summary?.by_category?.SLOT ?? 0} />
      </div>

      <TablePanel title="Activity (Last 30 days)" description="Logs per day grouped by category">
        <div className="space-y-2 p-3">
          {bars.map((bar) => (
            <div key={bar.date} className="flex items-center gap-3">
              <div className="w-24 text-xs text-muted-foreground">{bar.date}</div>
              <div className="flex h-5 flex-1 overflow-hidden rounded bg-muted">
                {bar.segments.map((segment) => (
                  <div
                    key={`${bar.date}:${segment.category}`}
                    className={`h-full ${segment.className}`}
                    style={{ width: `${segment.percentage}%` }}
                    title={`${segment.category}: ${segment.count}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </TablePanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <TablePanel title="Recent Activity" description="Last 20 entries">
          <div className="space-y-2 p-3">
            {recentLogs.slice(0, 20).map((entry) => (
              <div key={entry.id} className="rounded border border-border p-2 text-sm">
                <span className="font-semibold">{entry.actor_email || "SYSTEM"}</span>{" "}
                {humanizeAction(entry.action)}{" "}
                <span className="text-muted-foreground">
                  {entry.target_display ? `(${entry.target_display})` : ""}
                </span>{" "}
                — <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}</span>
              </div>
            ))}
          </div>
        </TablePanel>

        <TablePanel title="Top Actors" description="Email, role, actions, last action">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Total Actions</TableHead>
                <TableHead>Last Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topActors.map((entry) => (
                <TableRow key={entry.email}>
                  <TableCell>{entry.email}</TableCell>
                  <TableCell>{entry.role}</TableCell>
                  <TableCell>{entry.total}</TableCell>
                  <TableCell>{formatTimestamp(entry.lastAction)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      </div>

      {isSuperAdmin && (
        <TablePanel title="Last Password Changes" description="Sensitive auth changes">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Actor email</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passwordLogs.slice(0, 20).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.actor_email || "SYSTEM"}</TableCell>
                  <TableCell>{humanizeAction(entry.action)}</TableCell>
                  <TableCell>{formatTimestamp(entry.timestamp)}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.ip_address || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
    </div>
  );
}

function AuditDetailDrawer({
  open,
  entry,
  loading,
  onClose,
  isSuperAdmin,
}: {
  open: boolean;
  entry: AuditLogEntry | null;
  loading: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
}) {
  const restricted = Boolean(entry?.is_sensitive && !isSuperAdmin);
  const previousState = entry?.previous_state;
  const newState = entry?.new_state;

  const diffRows = useMemo(() => {
    if (!entry) return [];
    if (!isObject(previousState) || !isObject(newState)) return [];
    const changedFields = Array.isArray(entry.changed_fields)
      ? entry.changed_fields
      : Object.keys({ ...previousState, ...newState });
    return changedFields.map((field) => ({
      field,
      before: stringifyValue(previousState[field]),
      after: stringifyValue(newState[field]),
    }));
  }, [entry, previousState, newState]);

  const exportSingleJson = () => {
    if (!entry) return;
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-log-${entry.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {entry ? (
              <>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${CATEGORY_COLORS[entry.action_category] ?? "bg-muted text-muted-foreground"}`}>
                  {entry.is_sensitive && <Lock className="h-3 w-3" />}
                  {entry.action_category}
                </span>
                {humanizeAction(entry.action)}
              </>
            ) : (
              "Audit Detail"
            )}
          </SheetTitle>
          {entry && (
            <p className="text-xs text-muted-foreground">
              {formatTimestamp(entry.timestamp)} • {entry.ip_address || "No IP"} • {entry.user_agent || "Unknown agent"}
            </p>
          )}
        </SheetHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
        ) : !entry ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No log selected.</div>
        ) : (
          <div className="mt-4 space-y-4">
            <section className="rounded border border-border p-3">
              <h3 className="mb-2 text-sm font-semibold">Actor</h3>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-bold">
                  {initials(entry.actor_name || entry.actor_email)}
                </span>
                <div className="text-sm">
                  <div>{entry.actor_name || "SYSTEM"}</div>
                  <div className="text-xs text-muted-foreground">{entry.actor_email || "SYSTEM"} • {entry.actor_role || entry.actor_type}</div>
                </div>
              </div>
            </section>

            <section className="rounded border border-border p-3">
              <h3 className="mb-2 text-sm font-semibold">Target</h3>
              <div className="grid gap-1 text-sm">
                <div>Model: <span className="font-medium">{entry.target_model || "N/A"}</span></div>
                <div>ID: <span className="font-mono">{entry.target_id || "-"}</span></div>
                <div>Name: <span className="font-medium">{entry.target_display || "-"}</span></div>
              </div>
            </section>

            <section className="rounded border border-border p-3">
              <h3 className="mb-2 text-sm font-semibold">Changes</h3>
              {restricted ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldAlert className="h-4 w-4" /> Restricted
                </div>
              ) : diffRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Before</TableHead>
                      <TableHead>After</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diffRows.map((row) => (
                      <TableRow key={row.field}>
                        <TableCell className="font-medium">{row.field}</TableCell>
                        <TableCell className="text-xs">{row.before}</TableCell>
                        <TableCell className="text-xs">{row.after}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-muted-foreground">No state diff available.</p>
              )}
            </section>

            <section className="rounded border border-border p-3">
              <Collapsible>
                <CollapsibleTrigger className="text-sm font-semibold">Metadata</CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                    {restricted ? "***RESTRICTED***" : JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </section>

            <button
              onClick={exportSingleJson}
              className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Download className="h-4 w-4" /> Export JSON
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function SortButton({
  label,
  active,
  order,
  onClick,
}: {
  label: string;
  active: boolean;
  order: SortOrder;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide">
      {label}
      {active ? (order === "asc" ? <SortAsc className="h-3 w-3" /> : <SortDesc className="h-3 w-3" />) : null}
    </button>
  );
}

function ChangedFieldsCell({ entry, isSuperAdmin }: { entry: AuditLogEntry; isSuperAdmin: boolean }) {
  if (entry.is_sensitive && !isSuperAdmin) {
    return <span className="text-xs text-muted-foreground">Restricted</span>;
  }
  const fields = Array.isArray(entry.changed_fields)
    ? entry.changed_fields
    : [];
  if (fields.length === 0) return <span className="text-xs text-muted-foreground">-</span>;
  const shown = fields.slice(0, 3);
  const hidden = fields.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((field) => (
        <Badge key={field} variant="secondary">{field}</Badge>
      ))}
      {hidden > 0 && <Badge variant="outline">+{hidden} more</Badge>}
    </div>
  );
}

function toggleSort(
  currentKey: SortKey,
  currentOrder: SortOrder,
  setKey: (value: SortKey) => void,
  setOrder: (value: SortOrder) => void,
  nextKey: SortKey,
) {
  if (currentKey === nextKey) {
    setOrder(currentOrder === "asc" ? "desc" : "asc");
    return;
  }
  setKey(nextKey);
  setOrder("asc");
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function humanizeAction(action: string) {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function initials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "NA";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildCategoryBars(logs: AuditLogEntry[]) {
  const byDay = new Map<string, Map<string, number>>();
  logs.forEach((entry) => {
    const day = entry.timestamp.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, new Map<string, number>());
    const dayMap = byDay.get(day)!;
    dayMap.set(entry.action_category, (dayMap.get(entry.action_category) ?? 0) + 1);
  });

  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => {
      const total = Array.from(values.values()).reduce((sum, count) => sum + count, 0) || 1;
      const segments = Array.from(values.entries()).map(([category, count]) => ({
        category,
        count,
        percentage: (count / total) * 100,
        className: categoryClassForBar(category),
      }));
      return { date, segments };
    });
}

function categoryClassForBar(category: string) {
  if (category === "AUTH") return "bg-blue-500";
  if (category === "MENU") return "bg-green-500";
  if (category === "SLOT") return "bg-orange-500";
  if (category === "CANTEEN") return "bg-purple-500";
  if (category === "GUEST_MENU") return "bg-teal-500";
  if (category === "ORDERS") return "bg-red-500";
  if (category === "EVENTS") return "bg-yellow-500";
  if (category === "SETTINGS") return "bg-gray-500";
  if (category === "PERMISSIONS") return "bg-pink-500";
  if (category === "USER_MGMT") return "bg-indigo-500";
  return "bg-slate-500";
}
