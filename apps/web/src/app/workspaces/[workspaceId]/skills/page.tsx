"use client";

import { useState, useMemo } from "react";
import { api } from "@/lib/api";
import type { InstalledSkill, ManagedSkill, CommandResult } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { useWorkspace } from "@/lib/workspace-context";
import { useToast } from "@/components/toast";
import {
  ExternalLink, Download, RefreshCw, Puzzle, Loader2,
  ChevronDown, ChevronRight, AlertTriangle, Globe, Users,
} from "lucide-react";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

// ─── Filter types ──────────────────────────────────────────────

type StatusFilter = "all" | "ready" | "needs-setup" | "disabled";
type SourceFilter = "all" | "workspace" | "builtin";

function matchesStatus(skill: InstalledSkill, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "ready") return skill.eligible && !skill.disabled;
  if (f === "needs-setup") return !skill.eligible && !skill.disabled;
  if (f === "disabled") return skill.disabled;
  return true;
}

function matchesSource(skill: InstalledSkill, f: SourceFilter): boolean {
  if (f === "all") return true;
  if (f === "workspace") return !skill.bundled;
  if (f === "builtin") return skill.bundled;
  return true;
}

// ─── Toggle switch ─────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        checked ? "bg-emerald-600" : "bg-zinc-700"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

// ─── Filter chips ──────────────────────────────────────────────

function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === opt.key
              ? "bg-zinc-800 text-white"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Missing requirements badge ────────────────────────────────

function MissingBadges({ missing }: { missing: InstalledSkill["missing"] }) {
  if (!missing) return null;
  const items: string[] = [
    ...missing.bins.map((b) => `bin: ${b}`),
    ...missing.env.map((e) => `env: ${e}`),
    ...missing.config.map((c) => `config: ${c}`),
    ...missing.os.map((o) => `os: ${o}`),
  ];
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400"
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {item}
        </span>
      ))}
    </div>
  );
}

// ─── Skill card ────────────────────────────────────────────────

function SkillCard({
  skill,
  workspaceId,
  onToggle,
  onRefresh,
}: {
  skill: InstalledSkill;
  workspaceId: string;
  onToggle: (name: string, enabled: boolean) => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 transition-colors hover:border-zinc-700">
      {/* Card header — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left"
      >
        {skill.emoji && (
          <span className="text-base">{skill.emoji}</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">{skill.name}</span>
            <span className={`text-[10px] font-medium ${statusColor}`}>{statusLabel}</span>
          </div>
          {skill.description && !expanded && (
            <p className="mt-0.5 truncate text-xs text-zinc-500">{skill.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {skill.source && (
            <span className="hidden rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 sm:inline">
              {skill.source.replace("openclaw-", "")}
            </span>
          )}
          <Toggle
            checked={isEnabled}
            onChange={(v) => onToggle(skill.name, v)}
          />
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-600" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-600" />
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3 space-y-3">
          {skill.description && (
            <p className="text-xs text-zinc-400">{skill.description}</p>
          )}

          {skill.homepage && (
            <a
              href={skill.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
            >
              <Globe className="h-3 w-3" />
              {skill.homepage.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          )}

          <MissingBadges missing={skill.missing} />

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {!skill.bundled && (
              <>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const result = await api.openclaw.installSkill(workspaceId, skill.slug);
                    if (result.success) {
                      toast(`Skill "${skill.slug}" updated`, "success");
                      onRefresh();
                    } else {
                      toast(`Failed to update: ${result.stderr}`, "error");
                    }
                  }}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-all hover:border-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 active:scale-95"
                >
                  Update
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Uninstall "${skill.name}" from all agents?`)) return;
                    const result = await api.openclaw.uninstallSkill(workspaceId, skill.slug);
                    if (result.success) {
                      toast(`Skill "${skill.slug}" uninstalled`, "success");
                      onRefresh();
                    } else {
                      toast(`Failed to uninstall: ${result.stderr}`, "error");
                    }
                  }}
                  className="rounded-md border border-red-900/50 bg-zinc-800 px-2.5 py-1 text-xs text-red-400 transition-all hover:border-red-700 hover:bg-red-950/30 hover:text-red-300 active:scale-95"
                >
                  Uninstall
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Managed skill card ───────────────────────────────────────
//
// All UI metadata (label, emoji, description) comes from the API response,
// which sources it from each templates/skills/<slug>/_meta.json `managed`
// block. No hardcoded list here.

function ManagedSkillCard({
  skill,
  workspaceId,
  onAction,
}: {
  skill: ManagedSkill;
  workspaceId: string;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      await api.openclaw.toggleSkill(workspaceId, skill.slug, !skill.installed);
      toast(
        `${skill.name} ${skill.installed ? "disabled" : "enabled"}`,
        "success",
      );
      onAction();
    } catch (err) {
      toast(`Error: ${(err as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl">{skill.emoji ?? "\u{1F4E6}"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-200">{skill.name}</span>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
              v{skill.version}
            </span>
            {skill.category && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {skill.category}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
            {skill.description}
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={loading}
          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-all active:scale-95 disabled:opacity-50 ${
            skill.installed
              ? "border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              : "bg-emerald-600 text-white hover:bg-emerald-500"
          }`}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : skill.installed ? (
            "Disable"
          ) : (
            "Enable"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Collapsible section ───────────────────────────────────────

function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="mb-3 flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
        )}
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          {title}
        </h2>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
          {count}
        </span>
      </button>
      {open && children}
    </section>
  );
}

// ─── Main page ─────────────────────────────────────────────────

export default function SkillsPage() {
  const { toast } = useToast();
  const { workspaceId } = useWorkspace();

  const {
    data: capabilities,
    loading: isLoading,
    refetch: refetchAll,
  } = useApi(() => api.openclaw.listCapabilities(workspaceId), [workspaceId]);

  const { data: agents } = useApi(() => api.agents.list(workspaceId), [workspaceId]);

  const {
    data: managedSkillsData,
    refetch: refetchManaged,
  } = useApi(() => api.openclaw.listManagedSkills(workspaceId), [workspaceId]);
  const managedSkills: ManagedSkill[] = managedSkillsData?.skills ?? [];

  const [skillSlug, setSkillSlug] = useState("");
  const [targetAgentIds, setTargetAgentIds] = useState<string[]>([]); // empty = all agents (global)
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [lastResult, setLastResult] = useState<CommandResult | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const skills: InstalledSkill[] = useMemo(
    () => capabilities?.skills ?? [],
    [capabilities?.skills],
  );

  // Filtered skills
  const filteredSkills = useMemo(
    () => skills.filter((s) => matchesStatus(s, statusFilter) && matchesSource(s, sourceFilter)),
    [skills, statusFilter, sourceFilter],
  );

  const workspaceSkills = useMemo(() => filteredSkills.filter((s) => !s.bundled), [filteredSkills]);
  const builtinSkills = useMemo(() => filteredSkills.filter((s) => s.bundled), [filteredSkills]);

  // Counts for filter badges
  const counts = useMemo(() => ({
    all: skills.length,
    ready: skills.filter((s) => s.eligible && !s.disabled).length,
    needsSetup: skills.filter((s) => !s.eligible && !s.disabled).length,
    disabled: skills.filter((s) => s.disabled).length,
  }), [skills]);

  // ─── Handlers ────────────────────────────────────────────

  const handleInstallSkill = async () => {
    let input = skillSlug.trim();
    if (!input) return;

    // Handle URLs: extract slug from ClawHub, reject other domains
    if (input.startsWith("http://") || input.startsWith("https://")) {
      try {
        const url = new URL(input);
        if (url.hostname !== "clawhub.ai" && url.hostname !== "www.clawhub.ai") {
          toast("Only ClawHub URLs are supported. Enter a skill slug or a ClawHub URL.", "warning");
          return;
        }
        const segments = url.pathname.split("/").filter(Boolean);
        if (segments.length >= 2) {
          input = segments[segments.length - 1];
        } else {
          toast("Could not extract skill name from URL. Use the format: https://clawhub.ai/owner/skill-name", "warning");
          return;
        }
      } catch {
        toast("Invalid URL. Enter a skill slug or a ClawHub URL.", "warning");
        return;
      }
    }

    setInstalling(true);
    try {
      const result = await api.openclaw.installSkill(workspaceId, input, targetAgentIds.length > 0 ? targetAgentIds : undefined);
      setLastResult(result);
      if (result.success) {
        const target = targetAgentIds.length > 0
          ? targetAgentIds.map((id) => agents?.find((a) => a.id === id)?.name ?? id).join(", ")
          : "all agents";
        toast(`Skill "${input}" installed for ${target}`, "success");
        setSkillSlug("");
        refetchAll();
      } else {
        const stderr = result.stderr || "";
        if (/422|not found|no such skill/i.test(stderr) || /HTTP 422/.test((result as { command?: string }).command || "")) {
          toast(`Skill "${input}" not found. Check the skill name on ClawHub.`, "error");
        } else if (/502|gateway|connection refused/i.test(stderr)) {
          toast("Gateway not reachable. Make sure the workspace is running.", "error");
        } else {
          toast(`Failed to install "${input}": ${stderr || "Unknown error"}`, "error");
        }
      }
    } catch (err) {
      const msg = (err as Error).message || "";
      if (/422/.test(msg)) {
        toast(`Skill "${input}" not found. Check the skill name on ClawHub.`, "error");
      } else if (/502/.test(msg)) {
        toast("Gateway not reachable. Make sure the workspace is running.", "error");
      } else {
        toast(`Failed to install: ${msg}`, "error");
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleUpdateAllSkills = async () => {
    setUpdating(true);
    try {
      const result = await api.openclaw.updateAllSkills(workspaceId);
      setLastResult(result);
      if (result.success) {
        toast("All skills updated", "success");
        refetchAll();
      } else {
        toast(`Failed to update skills: ${result.stderr || "Unknown error"}`, "error");
      }
    } catch (err) {
      toast(`Error: ${(err as Error).message}`, "error");
    } finally {
      setUpdating(false);
    }
  };

  const handleToggleSkill = async (skillName: string, enabled: boolean) => {
    try {
      await api.openclaw.toggleSkill(workspaceId, skillName, enabled);
      toast(`Skill "${skillName}" ${enabled ? "enabled" : "disabled"}`, "success");
      refetchAll();
    } catch (err) {
      toast(`Error: ${(err as Error).message}`, "error");
    }
  };

  // ─── Render ──────────────────────────────────────────────

  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage OpenClaw capabilities for this workspace
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUpdateAllSkills}
            disabled={updating}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-750 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            {updating ? "Updating..." : "Update All"}
          </button>
          <button
            onClick={refetchAll}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-750 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <a
            href="https://clawhub.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-600"
          >
            ClawHub
            <ExternalLink className="h-3 w-3" />
          </a>
          <div className="hidden md:block"><UserProfileDropdown /></div>
        </div>
      </div>

      {/* Quick Install Panel */}
      <div className="mt-5">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Puzzle className="h-3.5 w-3.5 text-zinc-400" />
            <span className="text-xs font-medium text-zinc-300">Install Skill</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={skillSlug}
              onChange={(e) => setSkillSlug(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInstallSkill()}
              placeholder="skill-slug or ClawHub URL"
              disabled={installing}
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 disabled:opacity-50"
            />
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAgentPicker(!showAgentPicker)}
                disabled={installing}
                className="flex h-full items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 outline-none hover:border-zinc-600 focus:border-zinc-500 disabled:opacity-50"
              >
                <Users className="h-3 w-3 text-zinc-500" />
                {targetAgentIds.length === 0
                  ? "All Agents"
                  : targetAgentIds.length === 1
                    ? agents?.find((a) => a.id === targetAgentIds[0])?.name ?? "1 agent"
                    : `${targetAgentIds.length} agents`}
                <ChevronDown className="h-3 w-3 text-zinc-500" />
              </button>
              {showAgentPicker && (
                <div className="absolute right-0 top-full z-10 mt-1 min-w-[180px] rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl">
                  <button
                    type="button"
                    onClick={() => { setTargetAgentIds([]); setShowAgentPicker(false); }}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-700 ${
                      targetAgentIds.length === 0 ? "text-emerald-400" : "text-zinc-300"
                    }`}
                  >
                    {targetAgentIds.length === 0 && <span className="text-emerald-400">✓</span>}
                    All Agents
                  </button>
                  <div className="mx-2 my-1 border-t border-zinc-700" />
                  {agents?.map((a) => {
                    const selected = targetAgentIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setTargetAgentIds((prev) =>
                            selected ? prev.filter((id) => id !== a.id) : [...prev, a.id],
                          );
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-700 ${
                          selected ? "text-emerald-400" : "text-zinc-300"
                        }`}
                      >
                        <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${
                          selected ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-zinc-600"
                        }`}>
                          {selected && "✓"}
                        </span>
                        {a.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              onClick={handleInstallSkill}
              disabled={!skillSlug.trim() || installing}
              className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {installing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Installing...
                </>
              ) : (
                "Install"
              )}
            </button>
          </div>
          {installing && (
            <p className="mt-2 text-xs text-zinc-500">
              Installing skill, this may take a moment...
            </p>
          )}
        </div>
      </div>

      {/* Opcify Managed Skills */}
      {managedSkills.length > 0 && (
        <Section title="Opcify Skills" count={managedSkills.length} defaultOpen={true}>
          <div className="grid gap-2 sm:grid-cols-2">
            {managedSkills.map((skill) => (
              <ManagedSkillCard
                key={skill.slug}
                skill={skill}
                workspaceId={workspaceId}
                onAction={() => {
                  refetchManaged();
                  refetchAll();
                }}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <FilterChips<StatusFilter>
          options={[
            { key: "all", label: `All (${counts.all})` },
            { key: "ready", label: `Ready (${counts.ready})` },
            { key: "needs-setup", label: `Needs Setup (${counts.needsSetup})` },
            { key: "disabled", label: `Disabled (${counts.disabled})` },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
        />
        <FilterChips<SourceFilter>
          options={[
            { key: "all", label: "All" },
            { key: "workspace", label: "Workspace" },
            { key: "builtin", label: "Built-in" },
          ]}
          value={sourceFilter}
          onChange={setSourceFilter}
        />
      </div>

      {/* Skills: Workspace */}
      {isLoading && !skills.length ? (
        <div className="mt-6 animate-pulse space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-zinc-900" />
          ))}
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <Puzzle className="mx-auto h-8 w-8 text-zinc-700" />
          <p className="mt-2 text-sm text-zinc-500">No skills match the current filter</p>
        </div>
      ) : (
        <>
          {/* Workspace skills — always open */}
          {workspaceSkills.length > 0 && (
            <Section title="Workspace Skills" count={workspaceSkills.length} defaultOpen={true}>
              <div className="space-y-1.5">
                {workspaceSkills.map((skill) => (
                  <SkillCard
                    key={skill.slug}
                    skill={skill}
                    workspaceId={workspaceId}
                    onToggle={handleToggleSkill}
                    onRefresh={refetchAll}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Built-in skills — collapsed by default */}
          {builtinSkills.length > 0 && (
            <Section title="Built-in Skills" count={builtinSkills.length} defaultOpen={false}>
              <div className="space-y-1.5">
                {builtinSkills.map((skill) => (
                  <SkillCard
                    key={skill.slug}
                    skill={skill}
                    workspaceId={workspaceId}
                    onToggle={handleToggleSkill}
                    onRefresh={refetchAll}
                  />
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {/* Last Command Output */}
      {lastResult && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900">
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="flex w-full items-center justify-between px-4 py-2 text-left text-xs text-zinc-500 hover:text-zinc-400"
          >
            <span>
              <span className="font-mono">{lastResult.command}</span>
              {" "}
              <span className={lastResult.success ? "text-emerald-500" : "text-red-400"}>
                ({lastResult.success ? "ok" : `exit ${lastResult.exitCode}`})
              </span>
            </span>
            {showOutput ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {showOutput && (
            <div className="border-t border-zinc-800 px-4 py-3">
              {lastResult.stdout && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-zinc-400">
                  {lastResult.stdout}
                </pre>
              )}
              {lastResult.stderr && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-red-400/80">
                  {lastResult.stderr}
                </pre>
              )}
              {!lastResult.stdout && !lastResult.stderr && (
                <p className="text-xs text-zinc-600">No output</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
