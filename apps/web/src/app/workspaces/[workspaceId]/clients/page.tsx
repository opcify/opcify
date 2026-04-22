"use client";

import { Suspense, useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "@/lib/workspace-context";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useApi } from "@/lib/use-api";
import { api } from "@/lib/api";
import { ClientFormModal, ClientStatusBadge } from "@/components/clients";
import { formatDate } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import type { CreateClientInput, ClientWithTaskCount } from "@opcify/core";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Archive,
  Users,
  ListTodo,
} from "lucide-react";

export default function ClientsPage() {
  return (
    <Suspense fallback={<ClientsPageSkeleton />}>
      <ClientsPageContent />
    </Suspense>
  );
}

function ClientsPageContent() {
  const { workspaceId } = useWorkspace();
  const timezone = useTimezone();
  const router = useWorkspaceRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") ?? "",
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientWithTaskCount | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      workspaceId,
      q: search || undefined,
      status: statusFilter || undefined,
    }),
    [workspaceId, search, statusFilter],
  );

  const { data: clients, loading, error, refetch } = useApi(
    () => api.clients.list(params),
    [workspaceId, search, statusFilter],
  );

  const updateUrl = useCallback(
    (updates: Record<string, string>) => {
      const p = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(updates)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      const qs = p.toString();
      router.replace(`/clients${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router],
  );

  function handleSearchChange(v: string) {
    setSearch(v);
    updateUrl({ q: v });
  }

  function handleStatusChange(v: string) {
    setStatusFilter(v);
    updateUrl({ status: v });
  }

  async function handleCreate(data: CreateClientInput) {
    setSubmitting(true);
    try {
      await api.clients.create(workspaceId, data);
      setShowCreateModal(false);
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(data: CreateClientInput) {
    if (!editingClient) return;
    setSubmitting(true);
    try {
      await api.clients.update(workspaceId, editingClient.id, data);
      setEditingClient(null);
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive(id: string) {
    if (!confirm("Archive this client? You can restore them later.")) return;
    await api.clients.archive(workspaceId, id);
    setActionMenuId(null);
    refetch();
  }

  const isEmpty = !loading && !error && clients && clients.length === 0;
  const hasFilters = search || statusFilter;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="mt-1 text-sm text-muted">
            Manage the people and businesses you work with
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Plus className="h-4 w-4" />
            Add Client
          </button>
          <div className="hidden md:block"><UserProfileDropdown /></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search clients..."
            className="w-full rounded-lg border border-border-muted bg-surface-overlay py-2 pl-10 pr-3 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Content */}
      <div className="mt-4">
        {/* Loading */}
        {loading && <ClientsPageSkeleton inline />}

        {/* Error */}
        {error && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-red-400">Failed to load clients</p>
            <p className="mt-1 text-xs text-muted">{error}</p>
            <button
              onClick={refetch}
              className="mt-3 rounded-lg border border-border-muted px-4 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty — no clients at all */}
        {isEmpty && !hasFilters && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-border-muted bg-surface-raised py-20">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-overlay">
              <Users className="h-7 w-7 text-muted" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-primary">
              No clients yet
            </h3>
            <p className="mt-1 max-w-sm text-center text-sm text-muted">
              Add your first client to keep your work organized.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-5 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              <Plus className="h-4 w-4" />
              Add Client
            </button>
          </div>
        )}

        {/* Empty — filters active */}
        {isEmpty && hasFilters && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-muted">No clients match your filters</p>
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                updateUrl({ q: "", status: "" });
              }}
              className="mt-3 rounded-lg border border-border-muted px-4 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-primary"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Client table */}
        {!loading && !error && clients && clients.length > 0 && (
          <div className="rounded-xl border border-border-muted bg-surface-raised overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-muted text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Tasks</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-muted">
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => router.push(`/clients/${client.id}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-overlay/50"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-primary">
                        {client.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-secondary">
                        {client.company || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-secondary">
                        {client.email || client.phone || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ClientStatusBadge status={client.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-sm text-secondary">
                        <ListTodo className="h-3.5 w-3.5" />
                        {client._count.tasks}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-muted">
                        {formatDate(client.updatedAt, timezone)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionMenuId(
                              actionMenuId === client.id ? null : client.id,
                            );
                          }}
                          className="rounded-md p-1 text-muted transition-colors hover:bg-surface-overlay hover:text-secondary"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {actionMenuId === client.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionMenuId(null);
                              }}
                            />
                            <div className="absolute right-0 top-8 z-50 w-36 rounded-lg border border-border-muted bg-surface-raised py-1 shadow-lg">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingClient(client);
                                  setActionMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-secondary transition-colors hover:bg-surface-overlay"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              {client.status !== "archived" && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleArchive(client.id);
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-surface-overlay"
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                  Archive
                                </button>
                              )}
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
      {showCreateModal && (
        <ClientFormModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreate}
          submitting={submitting}
        />
      )}

      {/* Edit Modal */}
      {editingClient && (
        <ClientFormModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSubmit={handleUpdate}
          submitting={submitting}
        />
      )}
    </>
  );
}

function ClientsPageSkeleton({ inline }: { inline?: boolean }) {
  const rows = Array.from({ length: 5 });
  const content = (
    <div className="rounded-xl border border-border-muted bg-surface-raised overflow-hidden">
      <div className="divide-y divide-border-muted">
        {rows.map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <div className="h-4 w-32 animate-pulse rounded bg-surface-overlay" />
            <div className="h-4 w-24 animate-pulse rounded bg-surface-overlay" />
            <div className="h-4 w-40 animate-pulse rounded bg-surface-overlay" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-surface-overlay" />
            <div className="ml-auto h-4 w-20 animate-pulse rounded bg-surface-overlay" />
          </div>
        ))}
      </div>
    </div>
  );

  if (inline) return content;

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <div className="h-7 w-32 animate-pulse rounded bg-surface-overlay" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-surface-overlay" />
        </div>
        <div className="h-9 w-28 animate-pulse rounded-lg bg-surface-overlay" />
      </div>
      <div className="mt-6 flex gap-3">
        <div className="h-9 flex-1 animate-pulse rounded-lg bg-surface-overlay" />
        <div className="h-9 w-36 animate-pulse rounded-lg bg-surface-overlay" />
      </div>
      <div className="mt-4">{content}</div>
    </div>
  );
}
