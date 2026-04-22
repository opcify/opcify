"use client";

import { use, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { WsLink as Link } from "@/lib/workspace-link";
import { api } from "@/lib/api";
import type { InstalledSkill } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { StatusBadge } from "@/components/status-badge";
import { AgentModelSettings } from "@/components/agents/agent-model-settings";
import { AgentTokenUsagePanel } from "@/components/agents/agent-token-usage-panel";
import { AgentTaskHistory } from "@/components/agents/agent-task-history";
import { TaskProgress } from "@/components/tasks/task-progress";
import { MarkdownEditor } from "@/components/markdown-editor";
import { timeAgo } from "@/lib/time";
import { getModelLabel, type AgentDetail } from "@opcify/core";

function SkillToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        checked ? "bg-emerald-600" : "bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

type TabState = { value: string; saving: boolean; saved: boolean; error: string | null };

const CONFIG_TABS = [
  {
    key: "soul" as const,
    title: "SOUL.md",
    description: "Personality & principles",
    placeholder: "You are not a chatbot. You are a specialized operator.\n\n## Core Principles\n- Be concise and action-oriented",
  },
  {
    key: "agentConfig" as const,
    title: "AGENTS.md",
    description: "Operational logic & rules",
    placeholder: "## What This Agent Does\n- Describe operational logic\n\n## What This Agent Does NOT Do\n- Define boundaries",
  },
  {
    key: "identity" as const,
    title: "IDENTITY.md",
    description: "Display identity",
    placeholder: "Name: Agent Name\nRole: Specialist role\nTone: professional, structured",
  },
  {
    key: "tools" as const,
    title: "TOOLS.md",
    description: "Tool configuration",
    placeholder: "## Available Tools\n- Tool name: usage guidance\n\n## Tool Preferences\n- When to prefer one tool over another",
  },
  {
    key: "user" as const,
    title: "USER.md",
    description: "User context",
    placeholder: "## About the User\n- Who they are, their goals, preferences\n\n## Working Style\n- Communication preferences, tone",
  },
  {
    key: "bootstrap" as const,
    title: "BOOTSTRAP.md",
    description: "Bootstrap instructions",
    placeholder: "## Session Startup\n- What to do at the start of each session\n\n## Initialization Checklist\n- Steps to run before taking tasks",
  },
  {
    key: "heartbeat" as const,
    title: "HEARTBEAT.md",
    description: "Periodic check-in",
    placeholder: "## Heartbeat Cadence\n- How often to check in\n\n## Status Reporting\n- What to report on each heartbeat",
  },
];
type ConfigTabKey = (typeof CONFIG_TABS)[number]["key"];

function AgentConfigPanel({
  agent,
  workspaceId,
  onSaved,
}: {
  agent: AgentDetail;
  workspaceId: string;
  onSaved: () => void;
}) {
  // Initialized from `agent` at mount; parent remounts this component with a
  // fresh `key` whenever the underlying agent changes, so no useEffect sync.
  const [activeTab, setActiveTab] = useState<ConfigTabKey>("soul");
  const [tabStates, setTabStates] = useState<Record<ConfigTabKey, TabState>>(() => ({
    soul: { value: agent.soul ?? "", saving: false, saved: false, error: null },
    agentConfig: { value: agent.agentConfig ?? "", saving: false, saved: false, error: null },
    identity: { value: agent.identity ?? "", saving: false, saved: false, error: null },
    tools: { value: agent.tools ?? "", saving: false, saved: false, error: null },
    user: { value: agent.user ?? "", saving: false, saved: false, error: null },
    bootstrap: { value: agent.bootstrap ?? "", saving: false, saved: false, error: null },
    heartbeat: { value: agent.heartbeat ?? "", saving: false, saved: false, error: null },
  }));

  const patchTab = useCallback(
    (key: ConfigTabKey, patch: Partial<TabState>) => {
      setTabStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    },
    [],
  );

  const handleTabSave = useCallback(
    async (key: ConfigTabKey, value: string) => {
      patchTab(key, { saving: true, error: null });
      try {
        await api.agents.update(workspaceId, agent.id, {
          [key]: value.trim() || null,
        });
        patchTab(key, { saving: false, saved: true });
        setTimeout(() => patchTab(key, { saved: false }), 2000);
        onSaved();
      } catch (err) {
        patchTab(key, {
          saving: false,
          error: err instanceof Error ? err.message : "Failed to save",
        });
      }
    },
    [agent.id, workspaceId, onSaved, patchTab],
  );

  const isTabDirty = (key: ConfigTabKey): boolean => {
    const saved = (agent[key] ?? "") as string;
    return saved !== tabStates[key].value;
  };

  const activeMeta = CONFIG_TABS.find((t) => t.key === activeTab)!;
  const activeState = tabStates[activeTab];
  const activeDirty = isTabDirty(activeTab);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-800 px-3 py-2">
        {CONFIG_TABS.map((t) => {
          const isActive = activeTab === t.key;
          const dirty = isTabDirty(t.key);
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span>{t.title}</span>
              {dirty && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          );
        })}
      </div>
      {/* Editor panel */}
      <div className="flex flex-col p-4" style={{ minHeight: 600 }}>
        <p className="mb-2 shrink-0 text-[11px] text-zinc-600">
          {activeMeta.description}
        </p>
        <div className="flex min-h-0 flex-1 flex-col">
          <MarkdownEditor
            key={activeTab}
            value={activeState.value}
            onChange={(v) => patchTab(activeTab, { value: v })}
            placeholder={activeMeta.placeholder}
            fill
          />
        </div>
        {/* Save row */}
        <div className="mt-3 flex shrink-0 items-center gap-3">
          <button
            onClick={() => handleTabSave(activeTab, activeState.value)}
            disabled={!activeDirty || activeState.saving}
            className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-40 disabled:hover:bg-zinc-100"
          >
            {activeState.saving ? "Saving…" : `Save ${activeMeta.title}`}
          </button>
          {activeState.saved && (
            <span className="text-xs text-emerald-400">Saved</span>
          )}
          {activeState.error && (
            <span className="text-xs text-red-400">{activeState.error}</span>
          )}
          {activeDirty && !activeState.saved && !activeState.error && (
            <span className="text-xs text-zinc-600">Unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string; workspaceId: string }>;
}) {
  const { id, workspaceId } = use(params);
  const {
    data: agent,
    loading,
    error,
    refetch,
  } = useApi(() => api.agents.get(workspaceId, id), [workspaceId, id]);
  const { data: tasks } = useApi(
    () => api.tasks.list(workspaceId, { agentId: id }),
    [workspaceId, id],
  );
  const { data: capabilities, refetch: refetchCapabilities } = useApi(
    () => api.openclaw.listCapabilities(workspaceId),
    [workspaceId],
  );

  // Per-agent slugs (skills assigned to specific agents, not workspace-global)
  const perAgentSlugSet = useMemo(
    () => new Set(capabilities?.perAgentSlugs ?? []),
    [capabilities?.perAgentSlugs],
  );

  // Workspace-level skills (non-bundled, excluding per-agent skills)
  const workspaceSkills: InstalledSkill[] = useMemo(
    () => (capabilities?.skills ?? []).filter(
      (s) => !s.bundled && !perAgentSlugSet.has(s.slug),
    ),
    [capabilities?.skills, perAgentSlugSet],
  );

  // Per-agent installed skills (from DB), enriched with capabilities data.
  // Intentionally not wrapped in useMemo — React Compiler handles memoization.
  const capMap = new Map((capabilities?.skills ?? []).map((s) => [s.slug, s]));
  const agentInstalledSkills = (agent?.skills ?? []).map((s) => ({
    ...s,
    rich: capMap.get(s.key) ?? null,
  }));

  async function handleToggleSkill(skillName: string, enabled: boolean) {
    try {
      await api.openclaw.toggleSkill(workspaceId, skillName, enabled);
      refetchCapabilities();
    } catch {
      // Silently fail
    }
  }

  const router = useRouter();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleToggle() {
    if (!agent) return;
    if (agent.status === "disabled") {
      await api.agents.enable(workspaceId, agent.id);
    } else {
      await api.agents.disable(workspaceId, agent.id);
    }
    refetch();
  }

  async function handleDelete() {
    if (!agent || deleting) return;
    setDeleting(true);
    try {
      await api.agents.delete(workspaceId, agent.id);
      router.push(`/workspaces/${workspaceId}/agents`);
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-20 rounded bg-zinc-800" />
        <div className="flex items-start justify-between">
          <div>
            <div className="h-7 w-48 rounded bg-zinc-800" />
            <div className="mt-2 h-4 w-32 rounded bg-zinc-800" />
          </div>
          <div className="flex gap-3">
            <div className="h-6 w-16 rounded-full bg-zinc-800" />
            <div className="h-7 w-20 rounded bg-zinc-800" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-zinc-900" />
          ))}
        </div>
        <div className="mt-6 h-40 rounded-lg bg-zinc-900" />
      </div>
    );
  }
  if (error) return <p className="text-red-400">Failed to load: {error}</p>;
  if (!agent) return <p className="text-zinc-400">Agent not found</p>;

  return (
    <>
      <Link
        href="/agents"
        className="text-sm text-zinc-500 hover:text-zinc-300"
      >
        ← Agents
      </Link>

      {/* Header */}
      <div className="mt-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
            {agent.isSystem && (
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                System
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-400">{agent.role}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={agent.status} />
          <button
            onClick={handleToggle}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800"
          >
            {agent.status === "disabled" ? "Enable" : "Disable"}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-800 hover:bg-red-900/20"
          >
            Delete
          </button>
        </div>
      </div>

      {agent.description && (
        <p className="mt-3 text-sm text-zinc-400">{agent.description}</p>
      )}

      {/* Overview section */}
      <section className="mt-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {/* Model */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Model</p>
            <p className="mt-1.5 text-sm font-semibold text-zinc-200">
              {getModelLabel(agent.model)}
            </p>
          </div>

          {/* Current task */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Current Task</p>
            {agent.currentTask ? (
              <div className="mt-1.5">
                <p className="truncate text-sm font-semibold text-zinc-200">
                  {agent.currentTask.title}
                </p>
                <div className="mt-1.5">
                  <TaskProgress value={agent.currentTask.progress} />
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-zinc-500 italic">None</p>
            )}
          </div>

          {/* Task stats */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Tasks</p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums text-zinc-200">
                {agent.taskCounts.total}
              </span>
              <span className="text-xs text-zinc-500">total</span>
            </div>
            <div className="mt-1 flex gap-3 text-xs">
              <span className="text-emerald-400 font-medium">{agent.taskCounts.done} done</span>
              <span className="text-red-400 font-medium">{agent.taskCounts.failed} failed</span>
            </div>
          </div>

          {/* Concurrency */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Concurrency</p>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={async () => {
                  const v = Math.max(1, agent.maxConcurrent - 1);
                  await api.agents.update(workspaceId, agent.id, { maxConcurrent: v });
                  refetch();
                }}
                disabled={agent.maxConcurrent <= 1}
                className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-xs font-bold text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
              >
                -
              </button>
              <span className="min-w-[24px] text-center text-xl font-bold tabular-nums text-zinc-200">
                {agent.maxConcurrent}
              </span>
              <button
                onClick={async () => {
                  const v = Math.min(10, agent.maxConcurrent + 1);
                  await api.agents.update(workspaceId, agent.id, { maxConcurrent: v });
                  refetch();
                }}
                disabled={agent.maxConcurrent >= 10}
                className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-xs font-bold text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-30"
              >
                +
              </button>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">max parallel tasks</p>
          </div>
        </div>
      </section>

      {/* Agent Configuration */}
      <section className="mt-8">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Agent Configuration
        </h2>
        <AgentConfigPanel
          key={agent.id}
          agent={agent}
          workspaceId={workspaceId}
          onSaved={refetch}
        />
      </section>

      {/* Recent Outputs */}
      {agent.recentTasks && agent.recentTasks.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Recent Outputs
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50">
            {agent.recentTasks.map((rt) => (
              <div key={rt.id} className="flex items-start gap-3 px-5 py-3.5">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    rt.status === "done" ? "bg-emerald-400" :
                    rt.status === "failed" ? "bg-red-400" :
                    rt.status === "running" ? "bg-emerald-400 animate-pulse" :
                    "bg-zinc-600"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/tasks/${rt.id}`}
                      className="truncate text-sm font-medium text-zinc-200 hover:text-white"
                    >
                      {rt.title}
                    </Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      rt.status === "done" ? "bg-emerald-500/10 text-emerald-400" :
                      rt.status === "failed" ? "bg-red-500/10 text-red-400" :
                      rt.status === "running" ? "bg-emerald-500/10 text-emerald-400" :
                      "bg-zinc-800 text-zinc-500"
                    }`}>
                      {rt.status}
                    </span>
                  </div>
                  {rt.resultSummary && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                      {rt.resultSummary}
                    </p>
                  )}
                  {rt.finishedAt && (
                    <p className="mt-1 text-[11px] text-zinc-600">
                      {timeAgo(rt.finishedAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Model Settings */}
      <section className="mt-8">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Model Settings
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <AgentModelSettings
            agentId={agent.id}
            currentModel={agent.model}
            workspaceId={workspaceId}
            onSaved={refetch}
          />
        </div>
      </section>

      {/* Token Usage */}
      <section className="mt-8">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Token Usage
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <AgentTokenUsagePanel usage={agent.tokenUsage} />
        </div>
      </section>

      {/* Task History */}
      {tasks && (
        <section className="mt-8">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Task History
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <AgentTaskHistory tasks={tasks} />
          </div>
        </section>
      )}

      {/* Skills Enabled */}
      <section className="mt-8">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Skills Enabled
        </h2>

        {/* Workspace Skills */}
        {workspaceSkills.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-medium text-zinc-500">
              Workspace Skills ({workspaceSkills.length})
            </h3>
            <div className="space-y-1.5">
              {workspaceSkills.map((skill) => {
                const isEnabled = !skill.disabled;
                const statusColor = skill.disabled
                  ? "text-zinc-500"
                  : skill.eligible
                    ? "text-emerald-400"
                    : "text-amber-400";
                const statusLabel = skill.disabled
                  ? "Disabled"
                  : skill.eligible
                    ? "Ready"
                    : "Needs Setup";
                return (
                  <div
                    key={skill.slug}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
                  >
                    {skill.emoji && (
                      <span className="text-base">{skill.emoji}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200">
                          {skill.name}
                        </span>
                        <span className={`text-[10px] font-medium ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                      {skill.description && (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {skill.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {skill.source && (
                        <span className="hidden rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 sm:inline">
                          {skill.source.replace("openclaw-", "")}
                        </span>
                      )}
                      <SkillToggle
                        checked={isEnabled}
                        onChange={(v) => handleToggleSkill(skill.name, v)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Agent-Installed Skills */}
        {agentInstalledSkills.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-zinc-500">
              Agent Skills ({agentInstalledSkills.length})
            </h3>
            <div className="space-y-1.5">
              {agentInstalledSkills.map((s) => {
                const skill = s.rich;
                if (skill) {
                  const isEnabled = !skill.disabled;
                  const statusColor = skill.disabled
                    ? "text-zinc-500"
                    : skill.eligible
                      ? "text-emerald-400"
                      : "text-amber-400";
                  const statusLabel = skill.disabled
                    ? "Disabled"
                    : skill.eligible
                      ? "Ready"
                      : "Needs Setup";
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
                    >
                      {skill.emoji && (
                        <span className="text-base">{skill.emoji}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-200">
                            {skill.name}
                          </span>
                          <span className={`text-[10px] font-medium ${statusColor}`}>
                            {statusLabel}
                          </span>
                        </div>
                        {skill.description && (
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {skill.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {skill.source && (
                          <span className="hidden rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 sm:inline">
                            {skill.source.replace("openclaw-", "")}
                          </span>
                        )}
                        <SkillToggle
                          checked={isEnabled}
                          onChange={(v) => handleToggleSkill(skill.name, v)}
                        />
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-zinc-200">
                        {s.name}
                      </span>
                      {s.description && (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {s.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {workspaceSkills.length === 0 && agentInstalledSkills.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <p className="text-sm text-zinc-500">No skills enabled</p>
          </div>
        )}
      </section>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-zinc-100">Delete Agent</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Are you sure you want to delete <span className="font-medium text-zinc-200">{agent.name}</span>? This will also remove all associated skills and task history. This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete Agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
