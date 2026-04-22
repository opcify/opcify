"use client";

import { Suspense, useState, useMemo, useCallback } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useApi } from "@/lib/use-api";
import { api } from "@/lib/api";
import { LedgerEntryModal } from "@/components/ledger";
import type {
  CreateLedgerEntryInput,
  LedgerEntryWithClient,
} from "@opcify/core";
import { formatDate } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  BookOpen,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  Receipt,
  Calendar,
  X,
} from "lucide-react";

export default function LedgerPage() {
  return (
    <Suspense fallback={<LedgerPageSkeleton />}>
      <LedgerPageContent />
    </Suspense>
  );
}

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

// ── Date range helpers ──────────────────────────────────────────────

type DatePreset = "today" | "week" | "month" | "ytd" | "custom" | "";

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function getPresetRange(preset: DatePreset): { from: string; to: string } | null {
  if (!preset || preset === "custom") return null;
  const now = new Date();
  const today = toDateStr(now);

  if (preset === "today") {
    return { from: today, to: today };
  }
  if (preset === "week") {
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((day + 6) % 7)); // Monday
    return { from: toDateStr(mon), to: today };
  }
  if (preset === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toDateStr(first), to: today };
  }
  if (preset === "ytd") {
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return { from: toDateStr(jan1), to: today };
  }
  return null;
}

function presetLabel(preset: DatePreset): string {
  const map: Record<string, string> = {
    today: "Today",
    week: "This Week",
    month: "This Month",
    ytd: "Year to Date",
    custom: "Custom",
  };
  return map[preset] || "All Time";
}

// ── Main component ──────────────────────────────────────────────────

function LedgerPageContent() {
  const { workspaceId } = useWorkspace();
  const timezone = useTimezone();
  const router = useWorkspaceRouter();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntryWithClient | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  // Resolve effective date range
  const dateRange = useMemo(() => {
    if (datePreset === "custom") {
      return {
        from: customFrom || undefined,
        to: customTo || undefined,
      };
    }
    const range = getPresetRange(datePreset);
    return range
      ? { from: range.from, to: range.to }
      : { from: undefined, to: undefined };
  }, [datePreset, customFrom, customTo]);

  const listParams = useMemo(
    () => ({
      workspaceId,
      q: search || undefined,
      type: typeFilter || undefined,
      clientId: clientFilter || undefined,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    }),
    [workspaceId, search, typeFilter, clientFilter, dateRange],
  );

  const { data: entries, loading, error, refetch } = useApi(
    () => api.ledger.list(listParams),
    [workspaceId, search, typeFilter, clientFilter, dateRange.from, dateRange.to],
  );

  const { data: summary, refetch: refetchSummary } = useApi(
    () => api.ledger.summary(workspaceId, dateRange.from, dateRange.to),
    [workspaceId, dateRange.from, dateRange.to],
  );

  const { data: clients } = useApi(
    () => api.clients.list({ workspaceId, status: "active" }),
    [workspaceId],
  );

  const clientOptions = useMemo(
    () => (clients ?? []).map((c) => ({ id: c.id, name: c.name })),
    [clients],
  );

  const { data: tasks } = useApi(() => api.tasks.list(workspaceId), [workspaceId]);
  const taskOptions = useMemo(
    () => (tasks ?? []).map((t) => ({ id: t.id, title: t.title })),
    [tasks],
  );

  const selectPreset = useCallback((p: DatePreset) => {
    setDatePreset(p);
    if (p !== "custom") {
      setCustomFrom("");
      setCustomTo("");
    }
  }, []);

  async function handleCreate(data: CreateLedgerEntryInput) {
    setSubmitting(true);
    try {
      await api.ledger.create(workspaceId, data);
      setShowModal(false);
      refetch();
      refetchSummary();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(data: CreateLedgerEntryInput) {
    if (!editingEntry) return;
    setSubmitting(true);
    try {
      await api.ledger.update(workspaceId, editingEntry.id, data);
      setEditingEntry(null);
      refetch();
      refetchSummary();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this ledger entry? This cannot be undone.")) return;
    await api.ledger.delete(workspaceId, id);
    setActionMenuId(null);
    refetch();
    refetchSummary();
  }

  const isEmpty = !loading && !error && entries && entries.length === 0;
  const hasFilters = search || typeFilter || clientFilter || datePreset;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ledger</h1>
          <p className="mt-1 text-sm text-muted">
            Track income, expenses, and basic cash flow
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Add Entry
          </button>
          <div className="hidden md:block"><UserProfileDropdown /></div>
        </div>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border-muted bg-surface-raised p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              Income
            </div>
            <p className="mt-1 text-xl font-semibold text-emerald-400">
              {formatCurrency(summary.totalIncome)}
            </p>
          </div>
          <div className="rounded-xl border border-border-muted bg-surface-raised p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <TrendingDown className="h-4 w-4 text-red-400" />
              Expenses
            </div>
            <p className="mt-1 text-xl font-semibold text-red-400">
              {formatCurrency(summary.totalExpense)}
            </p>
          </div>
          <div className="rounded-xl border border-border-muted bg-surface-raised p-4">
            <div className="flex items-center gap-2 text-sm text-muted">
              <DollarSign className="h-4 w-4 text-blue-400" />
              Net
            </div>
            <p
              className={`mt-1 text-xl font-semibold ${
                summary.net >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {formatCurrency(summary.net)}
            </p>
          </div>
        </div>
      )}

      {/* Date quick-select chips */}
      <div className="mt-5 flex items-center gap-1.5">
        <Calendar className="h-4 w-4 text-muted mr-1" />
        {(["", "today", "week", "month", "ytd", "custom"] as DatePreset[]).map(
          (p) => (
            <button
              key={p || "_all"}
              onClick={() => selectPreset(p)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                datePreset === p
                  ? "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
                  : "text-muted hover:bg-surface-overlay hover:text-secondary border border-transparent"
              }`}
            >
              {presetLabel(p)}
            </button>
          ),
        )}
        {datePreset && (
          <button
            onClick={() => selectPreset("")}
            className="ml-1 rounded-md p-1 text-muted hover:text-secondary hover:bg-surface-overlay transition-colors"
            title="Clear date filter"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Custom date range inputs (only when Custom is selected) */}
      {datePreset === "custom" && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg border border-border-muted bg-surface-overlay px-2.5 py-1.5 text-xs text-primary outline-none focus:border-border-focus"
            placeholder="From"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg border border-border-muted bg-surface-overlay px-2.5 py-1.5 text-xs text-primary outline-none focus:border-border-focus"
            placeholder="To"
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="mt-3 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entries..."
            className="w-full rounded-lg border border-border-muted bg-surface-overlay py-2 pl-10 pr-3 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
        >
          <option value="">All Types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        {clientOptions.length > 0 && (
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
          >
            <option value="">All Clients</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Content */}
      <div className="mt-4">
        {loading && <LedgerPageSkeleton inline />}

        {error && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-red-400">Failed to load ledger</p>
            <p className="mt-1 text-xs text-muted">{error}</p>
            <button
              onClick={refetch}
              className="mt-3 rounded-lg border border-border-muted px-4 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay"
            >
              Retry
            </button>
          </div>
        )}

        {isEmpty && !hasFilters && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border-muted bg-surface-raised py-20">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-overlay">
              <BookOpen className="h-7 w-7 text-muted" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-primary">
              No ledger entries yet
            </h3>
            <p className="mt-1 max-w-sm text-center text-sm text-muted">
              Record your first income or expense to start tracking cash flow.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-5 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              Add Entry
            </button>
          </div>
        )}

        {isEmpty && hasFilters && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-muted">
              No entries match your filters
            </p>
            <button
              onClick={() => {
                setSearch("");
                setTypeFilter("");
                setClientFilter("");
                selectPreset("");
              }}
              className="mt-3 rounded-lg border border-border-muted px-4 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Table */}
        {!loading && !error && entries && entries.length > 0 && (
          <div className="rounded-xl border border-border-muted bg-surface-raised overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-muted text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-center">Attach.</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-muted">
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => router.push(`/ledger/${entry.id}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-overlay/50"
                  >
                    <td className="px-4 py-3 text-sm text-secondary whitespace-nowrap">
                      {formatDate(entry.entryDate, timezone)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                          entry.type === "income"
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                            : "border-red-500/20 bg-red-500/10 text-red-400"
                        }`}
                      >
                        {entry.type === "income" ? "Income" : "Expense"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span
                        className={`text-sm font-medium ${
                          entry.type === "income"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {entry.type === "expense" ? "- " : "+ "}
                        {formatCurrency(entry.amount, entry.currency)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-primary truncate max-w-[200px] block">
                        {entry.description}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {entry.client ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/clients/${entry.client!.id}`);
                          }}
                          className="text-sm text-secondary hover:text-primary transition-colors"
                        >
                          {entry.client.name}
                        </button>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {entry.task ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/tasks/${entry.task!.id}`);
                          }}
                          className="text-sm text-secondary hover:text-primary transition-colors truncate max-w-[140px] block"
                        >
                          {entry.task.title}
                        </button>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-secondary">
                        {entry.category || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {entry.attachmentType ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-blue-400"
                          title={entry.attachmentUrl || undefined}
                        >
                          {entry.attachmentType === "invoice" ? (
                            <FileText className="h-3.5 w-3.5" />
                          ) : (
                            <Receipt className="h-3.5 w-3.5" />
                          )}
                          {entry.attachmentType === "invoice"
                            ? "Inv."
                            : "Rcpt."}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuId(
                              actionMenuId === entry.id ? null : entry.id,
                            );
                          }}
                          className="rounded-md p-1 text-muted transition-colors hover:bg-surface-overlay hover:text-secondary"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {actionMenuId === entry.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={(e) => { e.stopPropagation(); setActionMenuId(null); }}
                            />
                            <div className="absolute right-0 top-8 z-50 w-32 rounded-lg border border-border-muted bg-surface-raised py-1 shadow-lg">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingEntry(entry);
                                  setActionMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-surface-overlay"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-surface-overlay"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showModal && (
        <LedgerEntryModal
          clients={clientOptions}
          tasks={taskOptions}
          onClose={() => setShowModal(false)}
          onSubmit={handleCreate}
          submitting={submitting}
        />
      )}

      {/* Edit Modal */}
      {editingEntry && (
        <LedgerEntryModal
          entry={editingEntry}
          clients={clientOptions}
          tasks={taskOptions}
          onClose={() => setEditingEntry(null)}
          onSubmit={handleUpdate}
          submitting={submitting}
        />
      )}
    </>
  );
}

function LedgerPageSkeleton({ inline }: { inline?: boolean }) {
  const rows = Array.from({ length: 5 });
  const content = (
    <div className="rounded-xl border border-border-muted bg-surface-raised overflow-hidden">
      <div className="divide-y divide-border-muted">
        {rows.map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <div className="h-4 w-20 animate-pulse rounded bg-surface-overlay" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-surface-overlay" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-overlay" />
            <div className="h-4 w-40 animate-pulse rounded bg-surface-overlay" />
            <div className="ml-auto h-4 w-20 animate-pulse rounded bg-surface-overlay" />
          </div>
        ))}
      </div>
    </div>
  );
  if (inline) return content;
  return (
    <div>
      <div className="h-7 w-32 animate-pulse rounded bg-surface-overlay" />
      <div className="mt-2 h-4 w-64 animate-pulse rounded bg-surface-overlay" />
      <div className="mt-6 grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border border-border-muted bg-surface-raised"
          />
        ))}
      </div>
      <div className="mt-6">{content}</div>
    </div>
  );
}
