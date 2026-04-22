"use client";

import { Suspense, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-context";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useApi } from "@/lib/use-api";
import { api } from "@/lib/api";
import { LedgerEntryModal } from "@/components/ledger";
import { formatDate } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import type { CreateLedgerEntryInput } from "@opcify/core";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Calendar,
  DollarSign,
  Tag,
  FileText,
  Receipt,
  User,
  TrendingUp,
  TrendingDown,
  ExternalLink,
} from "lucide-react";

export default function LedgerDetailPage() {
  return (
    <Suspense fallback={<LedgerDetailSkeleton />}>
      <LedgerDetailContent />
    </Suspense>
  );
}

function formatCurrency(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function LedgerDetailContent() {
  const params = useParams();
  const entryId = params.entryId as string;
  const { workspaceId } = useWorkspace();
  const timezone = useTimezone();
  const router = useWorkspaceRouter();

  const [showEdit, setShowEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: entry, loading, error, refetch } = useApi(
    () => api.ledger.get(workspaceId, entryId),
    [workspaceId, entryId],
  );

  const { data: clients } = useApi(
    () => api.clients.list({ workspaceId, status: "active" }),
    [workspaceId],
  );

  const clientOptions = (clients ?? []).map((c) => ({ id: c.id, name: c.name }));

  async function handleUpdate(data: CreateLedgerEntryInput) {
    setSubmitting(true);
    try {
      await api.ledger.update(workspaceId, entryId, data);
      setShowEdit(false);
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this ledger entry? This cannot be undone.")) return;
    await api.ledger.delete(workspaceId, entryId);
    router.push("/ledger");
  }

  if (loading) return <LedgerDetailSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-red-400">Failed to load entry</p>
        <p className="mt-1 text-xs text-muted">{error}</p>
        <button
          onClick={refetch}
          className="mt-3 rounded-lg border border-border-muted px-4 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-muted">Ledger entry not found</p>
        <button
          onClick={() => router.push("/ledger")}
          className="mt-3 rounded-lg border border-border-muted px-4 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay"
        >
          Back to Ledger
        </button>
      </div>
    );
  }

  const isIncome = entry.type === "income";

  return (
    <>
      {/* Back link */}
      <button
        onClick={() => router.push("/ledger")}
        className="mb-4 flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-secondary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Ledger
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                isIncome
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {isIncome ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {entry.description}
              </h1>
              <div className="mt-0.5 flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                    isIncome
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                      : "border-red-500/20 bg-red-500/10 text-red-400"
                  }`}
                >
                  {isIncome ? "Income" : "Expense"}
                </span>
                <span className="text-sm text-muted">
                  {formatDate(entry.entryDate, timezone)}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 rounded-lg border border-border-muted px-3 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        </div>
      </div>

      {/* Amount highlight */}
      <div className="mt-6 rounded-xl border border-border-muted bg-surface-raised p-6">
        <p className="text-sm text-muted">Amount</p>
        <p
          className={`mt-1 text-3xl font-bold ${
            isIncome ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {isIncome ? "+ " : "- "}
          {formatCurrency(entry.amount, entry.currency)}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Left column — Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Details
            </h2>
            <div className="mt-4 space-y-3">
              <DetailRow
                icon={<Calendar className="h-4 w-4 text-muted" />}
                label="Date"
                value={formatDate(entry.entryDate, timezone)}
              />
              <DetailRow
                icon={<DollarSign className="h-4 w-4 text-muted" />}
                label="Currency"
                value={entry.currency}
              />
              {entry.category && (
                <DetailRow
                  icon={<Tag className="h-4 w-4 text-muted" />}
                  label="Category"
                  value={entry.category}
                />
              )}
            </div>
          </section>

          {/* Notes */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Notes
            </h2>
            {entry.notes ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-secondary leading-relaxed">
                {entry.notes}
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted">
                No notes. Click Edit to add notes.
              </p>
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Client */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Client
            </h2>
            {entry.client ? (
              <div className="mt-3">
                <Link
                  href={`/workspaces/${workspaceId}/clients/${entry.client.id}`}
                  className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors"
                >
                  <User className="h-4 w-4 text-muted" />
                  <span className="font-medium">{entry.client.name}</span>
                </Link>
                {entry.client.company && (
                  <p className="mt-1 ml-6 text-xs text-muted">
                    {entry.client.company}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No client linked.</p>
            )}
          </section>

          {/* Attachment */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Attachment
            </h2>
            {entry.attachmentType ? (
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  {entry.attachmentType === "invoice" ? (
                    <FileText className="h-4 w-4 text-blue-400" />
                  ) : (
                    <Receipt className="h-4 w-4 text-blue-400" />
                  )}
                  <span className="text-sm font-medium text-secondary capitalize">
                    {entry.attachmentType}
                  </span>
                </div>
                {entry.attachmentUrl && (
                  <a
                    href={entry.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View attachment
                  </a>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No attachment.</p>
            )}
          </section>

          {/* Meta */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Record Info
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Created</span>
                <span className="text-secondary">
                  {formatDate(entry.createdAt, timezone)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Updated</span>
                <span className="text-secondary">
                  {formatDate(entry.updatedAt, timezone)}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Edit Modal */}
      {showEdit && (
        <LedgerEntryModal
          entry={entry}
          clients={clientOptions}
          onClose={() => setShowEdit(false)}
          onSubmit={handleUpdate}
          submitting={submitting}
        />
      )}
    </>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <span className="text-sm text-muted w-20">{label}</span>
      <span className="text-sm text-secondary">{value}</span>
    </div>
  );
}

function LedgerDetailSkeleton() {
  return (
    <div>
      <div className="h-4 w-28 animate-pulse rounded bg-surface-overlay" />
      <div className="mt-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-lg bg-surface-overlay" />
          <div>
            <div className="h-7 w-56 animate-pulse rounded bg-surface-overlay" />
            <div className="mt-2 h-4 w-32 animate-pulse rounded bg-surface-overlay" />
          </div>
        </div>
        <div className="h-9 w-20 animate-pulse rounded-lg bg-surface-overlay" />
      </div>
      <div className="mt-6 h-24 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-40 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
          <div className="h-28 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
        </div>
        <div className="space-y-6">
          <div className="h-24 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
          <div className="h-24 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
        </div>
      </div>
    </div>
  );
}
