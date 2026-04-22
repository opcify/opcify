"use client";

import { Suspense, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace-context";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useApi } from "@/lib/use-api";
import { api } from "@/lib/api";
import { ClientFormModal, ClientStatusBadge } from "@/components/clients";
import { formatDate } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";
import type { CreateClientInput } from "@opcify/core";
import {
  ArrowLeft,
  Pencil,
  Mail,
  Phone,
  Globe,
  MapPin,
  ListTodo,
  Archive,
} from "lucide-react";

export default function ClientDetailPage() {
  return (
    <Suspense fallback={<ClientDetailSkeleton />}>
      <ClientDetailContent />
    </Suspense>
  );
}

function ClientDetailContent() {
  const params = useParams();
  const clientId = params.clientId as string;
  const { workspaceId } = useWorkspace();
  const timezone = useTimezone();
  const router = useWorkspaceRouter();

  const [showEdit, setShowEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: client, loading, error, refetch } = useApi(
    () => api.clients.get(workspaceId, clientId),
    [workspaceId, clientId],
  );

  async function handleUpdate(data: CreateClientInput) {
    setSubmitting(true);
    try {
      await api.clients.update(workspaceId, clientId, data);
      setShowEdit(false);
      refetch();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleArchive() {
    if (!confirm("Archive this client? You can restore them later.")) return;
    await api.clients.archive(workspaceId, clientId);
    router.push("/clients");
  }

  if (loading) return <ClientDetailSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-red-400">Failed to load client</p>
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

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-muted">Client not found</p>
        <button
          onClick={() => router.push("/clients")}
          className="mt-3 rounded-lg border border-border-muted px-4 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay"
        >
          Back to Clients
        </button>
      </div>
    );
  }

  const hasContact = client.email || client.phone || client.website || client.address;

  return (
    <>
      {/* Back link */}
      <button
        onClick={() => router.push("/clients")}
        className="mb-4 flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-secondary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Clients
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
            <ClientStatusBadge status={client.status} />
          </div>
          {client.company && (
            <p className="mt-1 text-sm text-muted">{client.company}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {client.status !== "archived" && (
            <button
              onClick={handleArchive}
              className="flex items-center gap-1.5 rounded-lg border border-border-muted px-3 py-2 text-sm text-secondary transition-colors hover:bg-surface-overlay hover:text-red-400"
            >
              <Archive className="h-4 w-4" />
              Archive
            </button>
          )}
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Left column — Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact Information */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Contact Information
            </h2>
            {!hasContact ? (
              <p className="mt-3 text-sm text-muted">No contact info added yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {client.email && (
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted" />
                    <a
                      href={`mailto:${client.email}`}
                      className="text-sm text-secondary hover:text-primary"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {client.email}
                    </a>
                  </div>
                )}
                {client.phone && (
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-muted" />
                    <a
                      href={`tel:${client.phone}`}
                      className="text-sm text-secondary hover:text-primary"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {client.phone}
                    </a>
                  </div>
                )}
                {client.website && (
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-muted" />
                    <a
                      href={
                        client.website.startsWith("http")
                          ? client.website
                          : `https://${client.website}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-secondary hover:text-primary"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {client.website}
                    </a>
                  </div>
                )}
                {client.address && (
                  <div className="flex items-center gap-3">
                    <MapPin className="h-4 w-4 text-muted" />
                    <span className="text-sm text-secondary">
                      {client.address}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Notes */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Notes
            </h2>
            {client.notes ? (
              <p className="mt-3 whitespace-pre-wrap text-sm text-secondary leading-relaxed">
                {client.notes}
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted">
                No notes yet. Click Edit to add notes about this client.
              </p>
            )}
          </section>
        </div>

        {/* Right column — Related work */}
        <div className="space-y-6">
          {/* Related Tasks */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Related Tasks
              </h2>
              <span className="flex items-center gap-1 text-sm text-muted">
                <ListTodo className="h-3.5 w-3.5" />
                {client._count.tasks}
              </span>
            </div>

            {client.recentTasks.length === 0 ? (
              <p className="mt-3 text-sm text-muted">
                No tasks linked to this client yet.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {client.recentTasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/workspaces/${workspaceId}/tasks/${task.id}`}
                    className="block rounded-lg border border-border-muted p-3 transition-colors hover:bg-surface-overlay"
                  >
                    <p className="text-sm font-medium text-primary">
                      {task.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <TaskStatusDot status={task.status} />
                      <span className="text-xs text-muted capitalize">
                        {task.status}
                      </span>
                      <span className="text-xs text-muted">·</span>
                      <span className="text-xs text-muted capitalize">
                        {task.priority}
                      </span>
                    </div>
                  </Link>
                ))}
                {client._count.tasks > 5 && (
                  <p className="pt-1 text-center text-xs text-muted">
                    + {client._count.tasks - 5} more tasks
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Meta info */}
          <section className="rounded-xl border border-border-muted bg-surface-raised p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Details
            </h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Created</span>
                <span className="text-secondary">
                  {formatDate(client.createdAt, timezone)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Updated</span>
                <span className="text-secondary">
                  {formatDate(client.updatedAt, timezone)}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Edit Modal */}
      {showEdit && (
        <ClientFormModal
          client={client}
          onClose={() => setShowEdit(false)}
          onSubmit={handleUpdate}
          submitting={submitting}
        />
      )}
    </>
  );
}

function TaskStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: "bg-zinc-400",
    running: "bg-blue-400",
    waiting: "bg-amber-400",
    done: "bg-emerald-400",
    failed: "bg-red-400",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[status] ?? "bg-zinc-400"}`}
    />
  );
}

function ClientDetailSkeleton() {
  return (
    <div>
      <div className="h-4 w-28 animate-pulse rounded bg-surface-overlay" />
      <div className="mt-4 flex items-start justify-between">
        <div>
          <div className="h-7 w-48 animate-pulse rounded bg-surface-overlay" />
          <div className="mt-2 h-4 w-32 animate-pulse rounded bg-surface-overlay" />
        </div>
        <div className="h-9 w-20 animate-pulse rounded-lg bg-surface-overlay" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-40 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
          <div className="h-32 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
        </div>
        <div>
          <div className="h-48 animate-pulse rounded-xl border border-border-muted bg-surface-raised" />
        </div>
      </div>
    </div>
  );
}
