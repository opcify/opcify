"use client";

import { useState, useEffect } from "react";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import type { TelegramAccountInput, CommandResult } from "@/lib/api";

type WizardStep = "intro" | "accounts" | "review" | "pairing" | "binding";

const STEPS: WizardStep[] = ["intro", "accounts", "review", "pairing", "binding"];
const STEP_LABELS: Record<WizardStep, string> = {
  intro: "Getting Started",
  accounts: "Add Accounts",
  review: "Review & Save",
  pairing: "Pairing",
  binding: "Agent Binding",
};

interface Props {
  workspaceId: string;
  onClose: () => void;
}

export function TelegramWizard({ workspaceId, onClose }: Props) {
  const [step, setStep] = useState<WizardStep>("intro");
  const [accounts, setAccounts] = useState<TelegramAccountInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingApproveResult, setPairingApproveResult] = useState<CommandResult | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [bindingSaving, setBindingSaving] = useState(false);
  const [bindingDone, setBindingDone] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [existingCount, setExistingCount] = useState(0);

  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);

  // ── Load existing config on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.openclaw.telegramConfig(workspaceId);
        if (cancelled) return;

        if (data.telegram && Object.keys(data.telegram.accounts || {}).length > 0) {
          // Convert existing config into editable account inputs
          const existingAccounts: TelegramAccountInput[] = Object.entries(data.telegram.accounts).map(
            ([accountId, acc]) => ({
              accountId,
              botToken: acc.botToken,
              enabled: acc.enabled,
              requireMention: acc.groups?.["*"]?.requireMention ?? true,
              dmPolicy: acc.dmPolicy || "pairing",
              groupPolicy: acc.groupPolicy || "allowlist",
              streaming: acc.streaming || "partial",
            }),
          );
          setAccounts(existingAccounts);
          setExistingCount(existingAccounts.length);

          // Pre-populate bindings from existing data
          if (data.bindings && data.bindings.length > 0) {
            const existingBindings: Record<string, string> = {};
            for (const b of data.bindings) {
              existingBindings[b.match.accountId] = b.agentId;
            }
            setBindings(existingBindings);
          }

          // Skip intro and go directly to accounts step in edit mode
          setStep("accounts");
          setIsEditMode(true);
        }
      } catch {
        // No existing config — stay on intro step (fresh setup)
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]);

  const stepIndex = STEPS.indexOf(step);

  function goNext() {
    if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1]);
  }
  function goBack() {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
  }

  // ── Account management ──
  function addAccount() {
    setAccounts([...accounts, { accountId: "", botToken: "", enabled: true, requireMention: true, dmPolicy: "pairing", groupPolicy: "allowlist", streaming: "partial" }]);
  }
  function removeAccount(i: number) {
    setAccounts(accounts.filter((_, idx) => idx !== i));
  }
  function updateAccount(i: number, field: keyof TelegramAccountInput, value: string | boolean) {
    setAccounts(accounts.map((a, idx) => idx === i ? { ...a, [field]: value } : a));
  }

  const newAccounts = accounts.slice(existingCount);
  const accountsValid = accounts.length > 0 && newAccounts.every(a => a.accountId.trim() && a.botToken.trim());

  // ── Save config ──
  async function handleSaveConfig() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.openclaw.saveTelegramConfig(workspaceId, { accounts });

      // Start gateway (fire-and-forget — step 4 will poll for readiness)
      api.openclaw.startGateway(workspaceId).catch(() => {});

      goNext();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  }

  // ── Approve pairing ──
  async function handleApprovePairing() {
    if (!pairingCode.trim()) return;
    setSaving(true);
    try {
      const result = await api.openclaw.approvePairing(workspaceId, pairingCode.trim());
      setPairingApproveResult(result);
    } catch (err) {
      setPairingApproveResult({
        success: false,
        command: "openclaw pairing approve telegram " + pairingCode,
        stdout: "",
        stderr: err instanceof Error ? err.message : "Unknown error",
        exitCode: 1,
      });
    } finally {
      setSaving(false);
    }
  }

  // ── Save bindings ──
  async function handleSaveBindings() {
    const bindingList = Object.entries(bindings)
      .filter(([_, agentId]) => agentId)
      .map(([accountId, agentId]) => ({ accountId, agentId }));
    if (bindingList.length === 0) return;

    setBindingSaving(true);
    try {
      await api.openclaw.saveBindings(workspaceId, bindingList);
      setBindingDone(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save bindings");
    } finally {
      setBindingSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex w-full max-w-2xl flex-col rounded-xl border border-border-muted bg-surface-raised shadow-2xl" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-muted px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-primary">
              {isEditMode ? "Manage Telegram" : "Telegram Setup"}
            </h2>
            <p className="text-xs text-muted">Step {stepIndex + 1} of {STEPS.length} — {STEP_LABELS[step]}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-tertiary transition-colors hover:bg-surface-overlay hover:text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step progress bar */}
        <div className="flex gap-1 px-6 pt-4">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIndex ? "bg-blue-500" : "bg-surface-overlay"}`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loadingExisting && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <p className="mt-3 text-sm text-muted">Loading existing configuration...</p>
            </div>
          )}
          {!loadingExisting && step === "intro" && <StepIntro />}
          {!loadingExisting && step === "accounts" && (
            <StepAccounts
              accounts={accounts}
              onAdd={addAccount}
              onRemove={removeAccount}
              onUpdate={updateAccount}
              isEditMode={isEditMode}
              existingCount={existingCount}
            />
          )}
          {!loadingExisting && step === "review" && (
            <StepReview
              accounts={accounts}
              saving={saving}
              error={saveError}
              onSave={handleSaveConfig}
              isEditMode={isEditMode}
            />
          )}
          {!loadingExisting && step === "pairing" && (
            <StepPairing
              workspaceId={workspaceId}
              pairingCode={pairingCode}
              onCodeChange={setPairingCode}
              onApprove={handleApprovePairing}
              approveResult={pairingApproveResult}
              saving={saving}
            />
          )}
          {!loadingExisting && step === "binding" && (
            <StepBinding
              accounts={accounts}
              agents={agents || []}
              bindings={bindings}
              onChange={setBindings}
              onSave={handleSaveBindings}
              saving={bindingSaving}
              done={bindingDone}
              error={saveError}
            />
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t border-border-muted px-6 py-4">
          <button
            onClick={goBack}
            disabled={stepIndex === 0}
            className="flex items-center gap-1.5 rounded-md border border-border-muted px-4 py-2 text-sm font-medium text-tertiary transition-colors hover:bg-surface-overlay hover:text-primary disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <div className="flex gap-2">
            {step === "intro" && (
              <button onClick={goNext} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500">
                Get Started <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === "accounts" && (
              <button
                onClick={goNext}
                disabled={!accountsValid}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                Review <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === "pairing" && (
              <button onClick={goNext} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500">
                Continue to Binding <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === "binding" && bindingDone && (
              <button onClick={onClose} className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500">
                <Check className="h-4 w-4" /> Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step: Intro ────────────────────────────────────────────────────

function StepIntro() {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-primary">Connect Telegram to OpenClaw</h3>
        <p className="mt-1.5 text-sm text-tertiary">
          This wizard will guide you through connecting one or more Telegram bots to your OpenClaw agents.
        </p>
      </div>

      <div className="space-y-3">
        <InfoBlock
          title="1. Create a Telegram Bot"
          content="Open Telegram, search for @BotFather, and send /newbot. Follow the prompts to create your bot and receive a bot token."
        />
        <InfoBlock
          title="2. Get the Bot Token"
          content='BotFather will give you a token like 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11. Copy it — you will paste it in the next step.'
        />
        <InfoBlock
          title="3. Account IDs"
          content='Each bot needs an internal label (account ID) in OpenClaw, like "coder-bot" or "support-bot". These are just identifiers you choose — they do not need to match the Telegram bot username.'
        />
        <InfoBlock
          title="4. Pairing"
          content='When dmPolicy is set to "pairing", users must send a DM to the bot and get a pairing code approved before they can use it. You will approve pairing codes in step 4.'
        />
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3.5">
        <p className="text-sm text-blue-300">
          Make sure OpenClaw is installed before proceeding. The gateway command and pairing flow require a working OpenClaw installation.
        </p>
      </div>
    </div>
  );
}

function InfoBlock({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-lg border border-border-muted bg-surface-overlay/50 p-3.5">
      <h4 className="text-sm font-medium text-primary">{title}</h4>
      <p className="mt-1 text-sm text-tertiary">{content}</p>
    </div>
  );
}

// ─── Step: Accounts ─────────────────────────────────────────────────

function StepAccounts({
  accounts,
  onAdd,
  onRemove: _onRemove,
  onUpdate,
  isEditMode,
  existingCount = 0,
}: {
  accounts: TelegramAccountInput[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, field: keyof TelegramAccountInput, value: string | boolean) => void;
  isEditMode?: boolean;
  existingCount?: number;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-primary">
          {isEditMode ? "Edit Telegram Bot Accounts" : "Add Telegram Bot Accounts"}
        </h3>
        <p className="mt-1 text-sm text-tertiary">
          {isEditMode
            ? "Edit your existing bot accounts or add new ones. Each account needs a unique ID and a bot token from BotFather."
            : "Add one or more Telegram bot accounts. Each account needs a unique ID and a bot token from BotFather."
          }
        </p>
      </div>

      {/* Existing accounts (read-only) */}
      {accounts.slice(0, existingCount).map((account, i) => (
        <AccountForm
          key={account.accountId || i}
          index={i}
          account={account}
          readOnly
          onUpdate={(field, value) => onUpdate(i, field, value)}
        />
      ))}

      {/* New account form (one at a time) */}
      {accounts.length > existingCount ? (
        <AccountForm
          key={existingCount}
          index={existingCount}
          account={accounts[existingCount]}
          onUpdate={(field, value) => onUpdate(existingCount, field, value)}
        />
      ) : (
        <button
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-muted py-2.5 text-sm text-tertiary transition-colors hover:border-blue-500/50 hover:text-blue-400"
        >
          <Plus className="h-4 w-4" /> Add New Account
        </button>
      )}
    </div>
  );
}

function AccountForm({
  index: _index,
  account,
  readOnly,
  onRemove,
  onUpdate,
}: {
  index: number;
  account: TelegramAccountInput;
  readOnly?: boolean;
  onRemove?: () => void;
  onUpdate: (field: keyof TelegramAccountInput, value: string | boolean) => void;
}) {
  const [showToken, setShowToken] = useState(false);

  if (readOnly) {
    return (
      <div className="rounded-lg border border-border-muted bg-surface-overlay/20 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-primary">{account.accountId}</h4>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${account.enabled !== false ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-500/10 text-zinc-400"}`}>
            {account.enabled !== false ? "Enabled" : "Disabled"}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Token: {account.botToken.slice(0, 8)}...
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-muted bg-surface-overlay/30 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-primary">New Account</h4>
        {onRemove && (
          <button onClick={onRemove} className="rounded p-1 text-tertiary transition-colors hover:text-red-400">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-tertiary">Account ID</label>
          <input
            type="text"
            value={account.accountId}
            onChange={(e) => onUpdate("accountId", e.target.value)}
            placeholder="e.g. coder-bot"
            className="w-full rounded-md border border-border-muted bg-surface-base px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-blue-500"
          />
          <p className="mt-0.5 text-xs text-muted">Internal label for this bot</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-tertiary">Bot Token</label>
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={account.botToken}
              onChange={(e) => onUpdate("botToken", e.target.value)}
              placeholder="123456:ABC-DEF1234..."
              className="w-full rounded-md border border-border-muted bg-surface-base px-3 py-2 pr-9 text-sm text-primary placeholder-muted outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-tertiary"
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-0.5 text-xs text-muted">From @BotFather</p>
        </div>
      </div>

      {/* Advanced options */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-muted hover:text-tertiary">
          Advanced Options
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-xs text-tertiary">
            <input
              type="checkbox"
              checked={account.enabled !== false}
              onChange={(e) => onUpdate("enabled", e.target.checked)}
              className="rounded border-border-muted"
            />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-xs text-tertiary">
            <input
              type="checkbox"
              checked={account.requireMention !== false}
              onChange={(e) => onUpdate("requireMention", e.target.checked)}
              className="rounded border-border-muted"
            />
            Require @mention
          </label>
          <div>
            <label className="block text-xs text-muted">DM Policy</label>
            <select
              value={account.dmPolicy || "pairing"}
              onChange={(e) => onUpdate("dmPolicy", e.target.value)}
              className="mt-0.5 w-full rounded border border-border-muted bg-surface-base px-2 py-1 text-xs text-primary"
            >
              <option value="pairing">Pairing</option>
              <option value="open">Open</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted">Group Policy</label>
            <select
              value={account.groupPolicy || "allowlist"}
              onChange={(e) => onUpdate("groupPolicy", e.target.value)}
              className="mt-0.5 w-full rounded border border-border-muted bg-surface-base px-2 py-1 text-xs text-primary"
            >
              <option value="allowlist">Allowlist</option>
              <option value="open">Open</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted">Streaming</label>
            <select
              value={account.streaming || "partial"}
              onChange={(e) => onUpdate("streaming", e.target.value)}
              className="mt-0.5 w-full rounded border border-border-muted bg-surface-base px-2 py-1 text-xs text-primary"
            >
              <option value="partial">Partial</option>
              <option value="full">Full</option>
              <option value="off">Off</option>
            </select>
          </div>
        </div>
      </details>
    </div>
  );
}

// ─── Step: Review ───────────────────────────────────────────────────

function StepReview({
  accounts,
  saving,
  error,
  onSave,
  isEditMode,
}: {
  accounts: TelegramAccountInput[];
  saving: boolean;
  error: string | null;
  onSave: () => void;
  isEditMode?: boolean;
}) {
  // Build preview JSON
  const previewAccounts: Record<string, object> = {};
  for (const acc of accounts) {
    previewAccounts[acc.accountId] = {
      enabled: acc.enabled !== false,
      dmPolicy: acc.dmPolicy || "pairing",
      botToken: acc.botToken.slice(0, 8) + "...",
      groups: { "*": { requireMention: acc.requireMention !== false } },
      groupPolicy: acc.groupPolicy || "allowlist",
      streaming: acc.streaming || "partial",
    };
  }

  const preview = {
    channels: {
      telegram: {
        enabled: true,
        dmPolicy: "pairing",
        groupPolicy: "allowlist",
        streaming: "partial",
        accounts: previewAccounts,
      },
    },
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-primary">Review Configuration</h3>
        <p className="mt-1 text-sm text-tertiary">
          Review the config below. On save, this will be merged into the workspace&apos;s <code className="rounded bg-surface-overlay px-1.5 py-0.5 text-xs">openclaw.json</code>, then the gateway and pairing commands will run.
        </p>
      </div>

      <div className="rounded-lg border border-border-muted bg-surface-base">
        <div className="flex items-center justify-between border-b border-border-muted px-3 py-2">
          <span className="text-xs font-medium text-muted">Config Preview</span>
          <button
            onClick={() => navigator.clipboard.writeText(JSON.stringify(preview, null, 2))}
            className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-tertiary"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        <pre className="max-h-64 overflow-auto p-3 text-xs text-tertiary">
          {JSON.stringify(preview, null, 2)}
        </pre>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5">
        <p className="text-sm text-amber-300">
          Saving will write to the workspace&apos;s <code className="text-xs">openclaw.json</code> and run <code className="text-xs">openclaw gateway</code> and <code className="text-xs">openclaw pairing list telegram</code>.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <button
        onClick={onSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Saving & Running Commands...
          </>
        ) : isEditMode ? (
          "Update Config & Restart Gateway"
        ) : (
          "Save Config & Start Gateway"
        )}
      </button>
    </div>
  );
}

// ─── Step: Pairing ──────────────────────────────────────────────────

function StepPairing({
  workspaceId,
  pairingCode,
  onCodeChange,
  onApprove,
  approveResult,
  saving,
}: {
  workspaceId: string;
  pairingCode: string;
  onCodeChange: (code: string) => void;
  onApprove: () => void;
  approveResult: CommandResult | null;
  saving: boolean;
}) {
  const [phase, setPhase] = useState<"gateway" | "pairing" | "ready">("gateway");
  const [attempt, setAttempt] = useState(0);
  const [gatewayResult, setGatewayResult] = useState<CommandResult | null>(null);
  const [pairingResult, setPairingResult] = useState<CommandResult | null>(null);
  const MAX_ATTEMPTS = 10;

  useEffect(() => {
    if (phase !== "gateway") return;
    let cancelled = false;

    const check = async (n: number) => {
      if (cancelled || n >= MAX_ATTEMPTS) return;
      try {
        const gw = await api.openclaw.startGateway(workspaceId);
        if (cancelled) return;
        const ok = gw.success || /already running/i.test(gw.stderr || gw.stdout || "");
        setGatewayResult(gw);
        setAttempt(n + 1);
        if (ok) {
          setPhase("pairing");
          return;
        }
      } catch {
        // ignore
      }
      if (!cancelled) {
        setAttempt(n + 1);
        setTimeout(() => check(n + 1), 5000);
      }
    };

    check(0);
    return () => { cancelled = true; };
  }, [phase, workspaceId]);

  useEffect(() => {
    if (phase !== "pairing") return;
    let cancelled = false;
    (async () => {
      try {
        const pl = await api.openclaw.pairingList(workspaceId);
        if (!cancelled) {
          setPairingResult(pl);
          setPhase("ready");
        }
      } catch {
        if (!cancelled) setPhase("ready");
      }
    })();
    return () => { cancelled = true; };
  }, [phase, workspaceId]);

  const checking = phase !== "ready";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-primary">Pairing</h3>
        <p className="mt-1 text-sm text-tertiary">
          Send a DM to your bot on Telegram. The bot will reply with a pairing code. Enter that code below to approve.
        </p>
      </div>

      {/* Gateway check */}
      {phase === "gateway" && (
        <div className="flex items-center gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span className="text-sm text-blue-300">
            Waiting for gateway to start... ({attempt}/{MAX_ATTEMPTS})
          </span>
        </div>
      )}

      {phase !== "gateway" && gatewayResult && (
        <GatewayResultBlock result={gatewayResult} />
      )}

      {/* Pairing list check */}
      {phase === "pairing" && (
        <div className="flex items-center gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span className="text-sm text-blue-300">Checking pairing list...</span>
        </div>
      )}

      {phase === "ready" && pairingResult && (
        <CommandResultBlock label="Pairing List" result={pairingResult} />
      )}

      {/* Pairing code input */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-tertiary">Pairing Code</label>
        <p className="mb-2 text-xs text-muted">Send a message &quot;Hello&quot; to your new bot, then you will receive the pairing code.</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={pairingCode}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="Enter pairing code from Telegram DM"
            disabled={checking}
            className="flex-1 rounded-md border border-border-muted bg-surface-base px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            onClick={onApprove}
            disabled={!pairingCode.trim() || saving || checking}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve
          </button>
        </div>
      </div>

      {/* Approve result */}
      {approveResult && (
        <CommandResultBlock label="Pairing Approve" result={approveResult} />
      )}

      <div className="rounded-lg border border-border-muted bg-surface-overlay/30 p-3.5">
        <p className="text-sm text-tertiary">
          You can skip pairing for now and come back later. Continue to agent binding when ready.
        </p>
      </div>
    </div>
  );
}

function GatewayResultBlock({ result }: { result: CommandResult }) {
  const alreadyRunning =
    !result.success &&
    /already running/i.test(result.stderr || result.stdout || "");

  if (result.success || alreadyRunning) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-medium text-tertiary">Gateway</span>
          <span className="ml-auto text-xs text-emerald-400">
            {alreadyRunning
              ? "OpenClaw gateway is already running"
              : "Gateway started"}
          </span>
        </div>
      </div>
    );
  }

  return <CommandResultBlock label="Gateway" result={result} />;
}

function CommandResultBlock({ label, result }: { label: string; result: CommandResult }) {
  return (
    <div className={`rounded-lg border p-3 ${result.success ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
      <div className="flex items-center gap-2">
        {result.success ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : (
          <AlertCircle className="h-4 w-4 text-red-400" />
        )}
        <span className="text-xs font-medium text-tertiary">{label}</span>
        <code className="ml-auto text-xs text-muted">{result.command}</code>
      </div>
      {result.stdout && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-surface-base/50 p-2 text-xs text-tertiary">{result.stdout}</pre>
      )}
      {result.stderr && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-surface-base/50 p-2 text-xs text-red-300">{result.stderr}</pre>
      )}
    </div>
  );
}

// ─── Step: Binding ──────────────────────────────────────────────────

function StepBinding({
  accounts,
  agents,
  bindings,
  onChange,
  onSave,
  saving,
  done,
  error,
}: {
  accounts: TelegramAccountInput[];
  agents: { id: string; name: string }[];
  bindings: Record<string, string>;
  onChange: (b: Record<string, string>) => void;
  onSave: () => void;
  saving: boolean;
  done: boolean;
  error: string | null;
}) {
  function setBinding(accountId: string, agentId: string) {
    onChange({ ...bindings, [accountId]: agentId });
  }

  const hasBindings = Object.values(bindings).some(v => v);

  // Resolve Prisma agent IDs to openclaw slugs for preview
  const agentSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const slugById = new Map(agents.map(a => [a.id, agentSlug(a.name)]));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-primary">Agent Binding</h3>
        <p className="mt-1 text-sm text-tertiary">
          Map each Telegram bot account to an OpenClaw agent. When a message arrives on a Telegram account, it will be routed to the bound agent.
        </p>
      </div>

      <div className="space-y-3">
        {accounts.map((acc) => (
          <div key={acc.accountId} className="flex items-center gap-4 rounded-lg border border-border-muted bg-surface-overlay/30 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-primary">{acc.accountId}</p>
              <p className="truncate text-xs text-muted">Telegram bot account</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            <select
              value={bindings[acc.accountId] || ""}
              onChange={(e) => setBinding(acc.accountId, e.target.value)}
              className="w-48 rounded-md border border-border-muted bg-surface-base px-3 py-2 text-sm text-primary outline-none focus:border-blue-500"
            >
              <option value="">— Select Agent —</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {done ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3.5">
          <Check className="h-4 w-4 text-emerald-400" />
          <p className="text-sm text-emerald-300">Bindings saved successfully! Your Telegram bots are now connected to agents.</p>
        </div>
      ) : (
        <button
          onClick={onSave}
          disabled={!hasBindings || saving}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving Bindings...
            </>
          ) : (
            "Save Bindings"
          )}
        </button>
      )}

      {/* Preview */}
      {hasBindings && !done && (
        <div className="rounded-lg border border-border-muted bg-surface-base">
          <div className="border-b border-border-muted px-3 py-2">
            <span className="text-xs font-medium text-muted">Bindings Preview</span>
          </div>
          <pre className="max-h-40 overflow-auto p-3 text-xs text-tertiary">
            {JSON.stringify(
              {
                bindings: Object.entries(bindings)
                  .filter(([_, agentId]) => agentId)
                  .map(([accountId, agentId]) => ({
                    agentId: slugById.get(agentId) ?? agentId,
                    match: { channel: "telegram", accountId },
                  })),
              },
              null,
              2,
            )}
          </pre>
        </div>
      )}
    </div>
  );
}
