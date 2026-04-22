"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useWorkspace } from "@/lib/workspace-context";
import {
  MessageCircle,
  Hash,
  Clock,
  Trash2,
  Bot,
  Loader2,
} from "lucide-react";
import { TelegramWizard } from "@/components/channels/telegram-wizard";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

export default function ChannelsPage() {
  const { workspaceId } = useWorkspace();
  const [showWizard, setShowWizard] = useState(false);
  const { data: status, refetch: refetchStatus } = useApi(
    () => api.openclaw.status(workspaceId),
    [workspaceId],
  );
  const { data: telegramData, refetch: refetchTelegram } = useApi(
    () => api.openclaw.telegramConfig(workspaceId),
    [workspaceId],
  );

  const refetchAll = () => {
    refetchStatus();
    refetchTelegram();
  };

  const accounts = telegramData?.telegram?.accounts
    ? Object.entries(telegramData.telegram.accounts)
    : [];
  const bindings = telegramData?.bindings || [];

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
          <p className="mt-1 text-sm text-muted">
            Connect messaging channels to OpenClaw agents
          </p>
        </div>
        <div className="hidden md:block"><UserProfileDropdown /></div>
      </div>

      {/* Status summary */}
      {status && status.configured && (
        <div className="mt-6 rounded-xl border border-border-muted bg-surface-raised p-5">
          <h3 className="text-sm font-semibold text-primary">Telegram Status</h3>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatusItem label="Configured" value={status.configured} />
            <StatusItem label="Enabled" value={status.telegramEnabled} />
            <StatusItem label="Accounts" value={`${status.accountCount}`} />
            <StatusItem label="Bindings" value={`${status.bindingCount}`} />
          </div>
        </div>
      )}

      {/* Existing accounts list */}
      {accounts.length > 0 && (
        <div className="mt-6 rounded-xl border border-border-muted bg-surface-raised p-5">
          <h3 className="text-sm font-semibold text-primary">Telegram Accounts</h3>
          <div className="mt-3 space-y-2">
            {accounts.map(([accountId, acc]) => {
              const binding = bindings.find(
                (b) => b.match.accountId === accountId,
              );
              return (
                <TelegramAccountRow
                  key={accountId}
                  accountId={accountId}
                  enabled={acc.enabled}
                  boundAgent={binding?.agentId}
                  workspaceId={workspaceId}
                  onDeleted={refetchAll}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Provider cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Telegram card */}
        <div className="rounded-xl border border-border-muted bg-surface-raised p-5 transition-colors hover:border-blue-500/30">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">Telegram</h3>
                <p className="text-xs text-muted">Bot messaging & groups</p>
              </div>
            </div>
            {status?.configured && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                Active
              </span>
            )}
          </div>
          <p className="mt-3 text-sm text-tertiary">
            Connect Telegram bots to OpenClaw agents. Support for DMs with pairing and group messaging.
          </p>
          <button
            onClick={() => setShowWizard(true)}
            className="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            {status?.configured ? "Manage Telegram" : "Set Up Telegram"}
          </button>
        </div>

        {/* Discord - coming soon */}
        <div className="rounded-xl border border-border-muted bg-surface-raised/50 p-5 opacity-60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
              <Hash className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-primary">Discord</h3>
              <p className="text-xs text-muted">Coming soon</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-tertiary">
            Connect Discord bots for server and DM messaging.
          </p>
        </div>

        {/* WhatsApp - coming soon */}
        <div className="rounded-xl border border-border-muted bg-surface-raised/50 p-5 opacity-60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-400">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-primary">WhatsApp</h3>
              <p className="text-xs text-muted">Coming soon</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-tertiary">
            Connect WhatsApp Business API for customer messaging.
          </p>
        </div>
      </div>

      {/* Telegram wizard modal */}
      {showWizard && (
        <TelegramWizard
          workspaceId={workspaceId}
          onClose={() => {
            setShowWizard(false);
            refetchAll();
          }}
        />
      )}
    </>
  );
}

// ─── Telegram Account Row ──────────────────────────────────────────

function TelegramAccountRow({
  accountId,
  enabled,
  boundAgent,
  workspaceId,
  onDeleted,
}: {
  accountId: string;
  enabled: boolean;
  boundAgent?: string;
  workspaceId: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.openclaw.deleteTelegramAccount(workspaceId, accountId);
      onDeleted();
    } catch {
      // best effort
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-muted bg-surface-overlay/30 px-4 py-3">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${enabled ? "bg-emerald-400" : "bg-zinc-500"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-primary">{accountId}</p>
        {boundAgent && (
          <p className="flex items-center gap-1 text-xs text-muted">
            <Bot className="h-3 w-3" /> {boundAgent}
          </p>
        )}
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : (
            <>
              <span className="text-xs text-red-400">Delete?</span>
              <button
                onClick={handleDelete}
                className="rounded px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded px-2 py-1 text-xs text-tertiary transition-colors hover:bg-surface-overlay"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="rounded p-1.5 text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-400"
          title={`Delete ${accountId}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: boolean | string }) {
  const isBoolean = typeof value === "boolean";
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      {isBoolean ? (
        <p className={`mt-0.5 text-sm font-medium ${value ? "text-emerald-400" : "text-tertiary"}`}>
          {value ? "Yes" : "No"}
        </p>
      ) : (
        <p className="mt-0.5 text-sm font-medium text-primary">{value}</p>
      )}
    </div>
  );
}
