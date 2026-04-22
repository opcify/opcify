"use client";

import { Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  WorkspaceTemplateDetail,
  WorkspaceTemplateAgent,
  AIProviderConfig,
} from "@opcify/core";
import { BUILT_IN_PROVIDERS, getModelLabel } from "@opcify/core";
import { api, type ManagedSkill } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import {
  ArrowLeft,
  LayoutDashboard,
  Workflow,
  Rocket,
  Bot,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  AlertCircle,
  Plus,
  X,
  Eye,
  EyeOff,
  Server,
  Cloud,
  HardDrive,
} from "lucide-react";
import Link from "next/link";

const templateIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  workflow: Workflow,
  "layout-dashboard": LayoutDashboard,
};

// --- Wizard Steps ---

type WizardStep =
  | "template"
  | "info"
  | "ai"
  | "memory"
  | "storage"
  | "team"
  | "review";
const STEPS: { key: WizardStep; label: string }[] = [
  { key: "template", label: "Choose Template" },
  { key: "info", label: "Basic Info" },
  { key: "ai", label: "AI Setup" },
  { key: "memory", label: "Memory" },
  { key: "storage", label: "Cloud Storage" },
  { key: "team", label: "Team Setup" },
  { key: "review", label: "Review & Deploy" },
];

// --- Cloud Storage Provider Definitions ---

type CloudStorageProviderId = "none" | "gcs" | "s3" | "r2";

interface CloudStorageConfig {
  provider: CloudStorageProviderId;
  // GCS fields
  gcsBucketName?: string;
  gcsCredentialsJson?: string;
  gcsPrefix?: string;
  // S3 fields
  s3BucketName?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  s3Prefix?: string;
  // R2 fields
  r2BucketName?: string;
  r2AccountId?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2Prefix?: string;
  r2PublicDomain?: string;
}

const CLOUD_STORAGE_PROVIDERS: {
  id: CloudStorageProviderId;
  label: string;
  description: string;
  icon: string;
  skillSlug: string;
}[] = [
  { id: "none", label: "Skip for now", description: "Set up cloud storage later from the Archives page", icon: "", skillSlug: "" },
  { id: "gcs", label: "Google Cloud Storage", description: "GCP buckets with signed URL sharing", icon: "GCS", skillSlug: "google-cloud-storage" },
  { id: "s3", label: "Amazon S3", description: "AWS S3 buckets with pre-signed URL sharing", icon: "S3", skillSlug: "amazon-s3-storage" },
  { id: "r2", label: "Cloudflare R2", description: "S3-compatible with zero egress fees", icon: "R2", skillSlug: "cloudflare-r2-storage" },
];

/**
 * Models tested and recommended for use with Opcify.
 * Selecting a model outside this list triggers a quality warning.
 */
const RECOMMENDED_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.3-codex",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "gemini-3.1-pro-preview",
  "deepseek-reasoner",
  "qwen/qwen3.6-plus",
  "xiaomi/mimo-v2-pro",
  "minimax/minimax-m2.7",
  "moonshotai/kimi-k2.5",
  "deepseek/deepseek-v3.2",
  "anthropic/claude-sonnet-4.6",
  "minimax-m2.7",
  "minimax-m2.7-highspeed",
]);

// --- Memory Config ---

type MemoryMode = "local" | "remote" | "disabled";

type MemoryRemoteProvider =
  | "openai"
  | "gemini"
  | "voyage"
  | "mistral"
  | "ollama"
  | "github-copilot";

interface MemoryConfig {
  mode: MemoryMode;
  /** memory.qmd.sessions.enabled — toggles QMD session ingestion */
  sessionsEnabled: boolean;
  /** plugins.memory-core.config.dreaming.enabled — nightly dream sweep */
  dreamingEnabled: boolean;
  /** agents.defaults.memorySearch.query.hybrid.vectorWeight */
  vectorWeight: number;
  /** agents.defaults.memorySearch.query.hybrid.textWeight */
  textWeight: number;
  /** Remote-only: which embedding provider to route memorySearch through */
  remoteProvider?: MemoryRemoteProvider;
  /**
   * Remote-only: embedding model ID (e.g. "text-embedding-3-small"). Lands at
   * memorySearch.model TOP-LEVEL, not inside memorySearch.remote.
   */
  remoteModel?: string;
  /** Remote-only: override the provider's default base URL */
  remoteBaseUrl?: string;
  /** Remote-only: API key for the chosen provider */
  remoteApiKey?: string;
}

const MEMORY_REMOTE_PROVIDERS: {
  id: MemoryRemoteProvider;
  label: string;
  hint: string;
}[] = [
  { id: "openai", label: "OpenAI", hint: "text-embedding-3-small/large. Accepts any OpenAI-compatible proxy via base URL override." },
  { id: "gemini", label: "Google Gemini", hint: "text-embedding-004." },
  { id: "voyage", label: "Voyage AI", hint: "High-quality retrieval embeddings — voyage-3, voyage-large-2." },
  { id: "mistral", label: "Mistral", hint: "mistral-embed." },
  { id: "ollama", label: "Ollama", hint: "Self-hosted embeddings — set base URL to your Ollama server." },
  { id: "github-copilot", label: "GitHub Copilot", hint: "Embeddings via Copilot-compatible endpoints." },
];

interface WizardState {
  templateKey: string | null;
  templateName: string;
  name: string;
  description: string;
  /** Selected provider ID (e.g. "openai", "anthropic", "custom-xxx") */
  providerId: string;
  /** Selected model value */
  model: string;
  /** Configured provider credentials */
  aiProviders: AIProviderConfig[];
  enableSystemAgents: boolean;
  agents: WorkspaceTemplateAgent[];
  skillKeys: string[];
  /**
   * Opcify managed skills selected by the user (opcify is always included).
   * `null` = user has not customized — fall back to defaults from the catalog.
   * Becomes an explicit `string[]` once the user toggles any checkbox.
   */
  managedSkillKeys: string[] | null;
  enableDemoData: boolean;
  /** Cloud storage configuration (optional — user can skip and configure later) */
  cloudStorage: CloudStorageConfig;
  /** Memory / semantic recall config (see Memory step) */
  memory: MemoryConfig;
}

/**
 * The wizard fetches the catalog of Opcify-managed skills from
 * GET /managed-skills/catalog at runtime — there is no hardcoded list. Adding a
 * new managed skill is a matter of dropping a folder under templates/skills/<slug>/
 * with a SKILL.md and a _meta.json containing a `managed` block. See
 * apps/api/src/workspace/managed-skills-loader.ts for the schema.
 *
 * `tier === "general"` skills are shown for every template (toggleable unless
 *   `alwaysOn === true`, in which case they render as a locked checkbox).
 * `tier === "template-scoped"` skills are only shown when the selected
 *   template's key is in their `templateScopes` array. Other workspaces can
 *   still install them later via the post-creation Skills page.
 */

/** Skills that should be visible in the setup wizard for the given template. */
function visibleManagedSkills(
  catalog: ManagedSkill[],
  templateKey: string | null,
): ManagedSkill[] {
  return catalog.filter((s) => {
    if (s.tier === "general") return true;
    return templateKey != null && (s.templateScopes?.includes(templateKey) ?? false);
  });
}

/** Skill keys to default-check in `managedSkillKeys` for the given template. */
function defaultManagedSkillKeysFor(
  catalog: ManagedSkill[],
  templateKey: string | null,
): string[] {
  // Always include alwaysOn skills + every visible toggleable skill (so the
  // user starts with everything checked, same as the old behavior).
  return visibleManagedSkills(catalog, templateKey).map((s) => s.slug);
}

/**
 * Collapse the wizard's MemoryConfig into the shape the backend zod schema
 * expects (discriminated union on `mode`). Remote-only fields are only
 * included when the user picked remote mode — otherwise zod rejects the
 * entire object. Empty strings are dropped so they don't blank out
 * OpenClaw's own provider defaults on a server-side merge.
 */
function serializeMemoryForBackend(cfg: MemoryConfig): Record<string, unknown> {
  const common = {
    sessionsEnabled: cfg.sessionsEnabled,
    dreamingEnabled: cfg.dreamingEnabled,
    vectorWeight: cfg.vectorWeight,
    textWeight: cfg.textWeight,
  };
  if (cfg.mode === "remote") {
    const out: Record<string, unknown> = {
      mode: "remote",
      ...common,
      provider: cfg.remoteProvider ?? "openai",
    };
    if (cfg.remoteModel?.trim()) out.model = cfg.remoteModel.trim();
    if (cfg.remoteBaseUrl?.trim()) out.baseUrl = cfg.remoteBaseUrl.trim();
    if (cfg.remoteApiKey?.trim()) out.apiKey = cfg.remoteApiKey.trim();
    return out;
  }
  return { mode: cfg.mode, ...common };
}

function initialState(): WizardState {
  return {
    templateKey: null,
    templateName: "",
    name: "",
    description: "",
    providerId: "openai",
    model: "gpt-5.4",
    aiProviders: [],
    enableSystemAgents: true,
    agents: [],
    skillKeys: [],
    // null = user hasn't customized; CreateWorkspaceWizard derives the
    // effective list from the catalog at render time. Becomes an explicit
    // string[] on the user's first toggle.
    managedSkillKeys: null,
    enableDemoData: true,
    cloudStorage: { provider: "none" },
    // Default to Markdown File (disabled) — the safest option since it
    // doesn't run any embedding model, doesn't hit an external API, and
    // doesn't flood the logs with `qmd embed timed out` warnings on
    // CPU-only hosts. Users who actually want semantic recall can flip
    // to Remote or QMD in the wizard.
    //
    // Weights are kept at the Local-mode defaults (0.3 / 0.7) even though
    // they're unused in disabled mode — that way `pickMode` treats them as
    // the "local default marker" and auto-flips to Remote defaults
    // (0.7 / 0.3) the first time a user switches to Remote mode.
    memory: {
      mode: "disabled",
      sessionsEnabled: true,
      dreamingEnabled: true,
      vectorWeight: 0.3,
      textWeight: 0.7,
    },
  };
}

// --- Main Page ---

export default function WorkspaceCatalogPageWrapper() {
  return (
    <Suspense fallback={null}>
      <WorkspaceCatalogPage />
    </Suspense>
  );
}

function WorkspaceCatalogPage() {
  const searchParams = useSearchParams();
  const preselectedTemplate = searchParams.get("template");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardState, setWizardState] = useState<WizardState>(initialState);
  const [preselectedApplied, setPreselectedApplied] = useState(false);

  const { data: templates, loading, error } = useApi<WorkspaceTemplateDetail[]>(
    () => api.workspaceTemplates.list(),
    [],
  );

  // Workspace-agnostic catalog of Opcify-managed skills, loaded from each
  // templates/skills/<slug>/_meta.json `managed` block. The wizard uses this
  // to render the picker — there is no hardcoded list anywhere in the FE.
  const { data: managedCatalogResp } = useApi<{ skills: ManagedSkill[] }>(
    () => api.openclaw.listManagedSkillsCatalog(),
    [],
  );
  const managedCatalog = managedCatalogResp?.skills ?? [];

  // No effect needed to seed managedSkillKeys — the wizard derives the
  // effective list from `managedCatalog` + `state.templateKey` via useMemo,
  // which always reflects the latest catalog without a sync setState.

  // Auto-open wizard when templates load and a preselected template is in the URL.
  // Uses a flag state to run exactly once after templates are available.
  const applyPreselection = useCallback(() => {
    if (preselectedApplied || !preselectedTemplate || !templates?.length) return;
    const t = templates.find((tpl) => tpl.key === preselectedTemplate);
    if (!t) return;
    setPreselectedApplied(true);
    const config = t.config;
    setWizardState((prev) => ({
      ...prev,
      templateKey: t.key,
      templateName: t.name,
      name: t.key === "blank" ? "" : t.name,
      description: t.description,
      agents: config?.agents ?? [],
      skillKeys: config?.skills ?? [],
      // Don't seed managedSkillKeys here — the wizard derives the effective
      // list from the catalog + templateKey via useMemo. Leaving it as null
      // means "not user-customized; use defaults", which is correct.
      enableDemoData: config?.demoData ?? false,
    }));
    setWizardOpen(true);
  }, [preselectedApplied, preselectedTemplate, templates]);

  // Call once templates are ready — this is a no-op after the first application
  if (!preselectedApplied && templates?.length && preselectedTemplate) {
    applyPreselection();
  }

  function selectTemplate(t: WorkspaceTemplateDetail) {
    const config = t.config;
    setWizardState((prev) => ({
      ...prev,
      templateKey: t.key,
      templateName: t.name,
      name: t.key === "blank" ? "" : `${t.name}`,
      description: t.description,
      agents: config?.agents ?? [],
      skillKeys: config?.skills ?? [],
      // Don't seed managedSkillKeys here — see applyPreselection above.
      enableDemoData: config?.demoData ?? false,
    }));
    setWizardOpen(true);
  }

  if (wizardOpen) {
    return (
      <CreateWorkspaceWizard
        templates={templates ?? []}
        state={wizardState}
        setState={setWizardState}
        managedCatalog={managedCatalog}
        onBack={() => setWizardOpen(false)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex items-center gap-3">
        <Link
          href="/?home=1"
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Workspace Catalog</h1>
          <p className="text-sm text-zinc-500">
            Choose a template to create a new workspace.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-12 flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : error ? (
        <div className="mt-8 rounded-lg border border-red-900/50 bg-red-900/20 px-6 py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
          <p className="mt-3 text-sm text-red-300">Failed to load workspace templates</p>
          <p className="mt-1 text-xs text-red-400/70">{error}</p>
          <p className="mt-3 text-xs text-zinc-500">Make sure the API server is running on port 4210</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...(templates ?? [])].sort((a, b) => (a.key === "opcify_starter" ? -1 : b.key === "opcify_starter" ? 1 : 0)).map((t) => {
            const Icon = templateIcons[t.icon] || LayoutDashboard;
            const agentCount = t.config?.agents?.length ?? 0;
            const skillCount = t.config?.skills?.length ?? 0;

            return (
              <button
                key={t.key}
                onClick={() => selectTemplate(t)}
                className="group flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-5 text-left transition-all hover:border-zinc-700 hover:bg-zinc-800/80"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700 group-hover:text-zinc-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-200">{t.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                  {t.description}
                </p>
                <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-zinc-600">
                  {agentCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Bot className="h-3 w-3" /> {agentCount} agents
                    </span>
                  )}
                  {skillCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> {skillCount} skills
                    </span>
                  )}
                  {t.key === "blank" && (
                    <span className="text-zinc-600">Start from scratch</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Wizard Component ---

function CreateWorkspaceWizard({
  templates,
  state,
  setState,
  managedCatalog,
  onBack,
}: {
  templates: WorkspaceTemplateDetail[];
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  managedCatalog: ManagedSkill[];
  onBack: () => void;
}) {
  const router = useRouter();
  // When template was pre-selected from catalog, skip the "Choose Template" step entirely
  const hasPreselectedTemplate = !!state.templateKey;
  const visibleSteps = hasPreselectedTemplate
    ? STEPS.filter((s) => s.key !== "template")
    : STEPS;

  const [step, setStep] = useState<WizardStep>(
    hasPreselectedTemplate ? "info" : "template",
  );
  const [deploying, setDeploying] = useState(false);
  const [provisioningId, setProvisioningId] = useState<string | null>(null);
  const [provisionStep, setProvisionStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The effective managed-skill selection — derived at render time so it always
  // reflects the latest catalog and template, no setState-in-effect needed.
  // null = user hasn't customized → use catalog defaults for the current template.
  const effectiveManagedSkillKeys = useMemo(
    () =>
      state.managedSkillKeys ??
      defaultManagedSkillKeysFor(managedCatalog, state.templateKey),
    [state.managedSkillKeys, state.templateKey, managedCatalog],
  );

  const stepIdx = visibleSteps.findIndex((s) => s.key === step);

  function next() {
    if (stepIdx < visibleSteps.length - 1) setStep(visibleSteps[stepIdx + 1].key);
  }
  function prev() {
    if (stepIdx === 0) {
      onBack();
    } else {
      setStep(visibleSteps[stepIdx - 1].key);
    }
  }

  async function deploy() {
    setDeploying(true);
    setError(null);
    setProvisionStep(0);
    try {
      // Build settings JSON (AI providers + cloud storage config + memory)
      const aiSettings: Record<string, unknown> = {
        providers: state.aiProviders,
        defaultModel: state.model,
      };
      // Include cloud storage config if a provider was selected
      if (state.cloudStorage.provider !== "none") {
        aiSettings.cloudStorage = state.cloudStorage;
      }
      // Translate the wizard's MemoryConfig into the WorkspaceMemoryConfig
      // shape the backend expects. Remote-only fields are dropped unless the
      // user picked remote mode so the discriminated union stays valid.
      aiSettings.memory = serializeMemoryForBackend(state.memory);

      // Auto-enable the selected cloud storage managed skill
      let finalManagedSkillKeys = effectiveManagedSkillKeys;
      const csProvider = CLOUD_STORAGE_PROVIDERS.find((p) => p.id === state.cloudStorage.provider);
      if (csProvider && csProvider.skillSlug && !finalManagedSkillKeys.includes(csProvider.skillSlug)) {
        finalManagedSkillKeys = [...finalManagedSkillKeys, csProvider.skillSlug];
      }

      setProvisionStep(1); // Creating workspace
      const ws = await api.workspaces.create({
        name: state.name || "Untitled Workspace",
        description: state.description,
        type: (state.templateKey as import("@opcify/core").WorkspaceType) || "blank",
        settingsJson: JSON.stringify(aiSettings),
      });

      setProvisionStep(2); // Provisioning agents & data
      await api.workspaces.provision(ws.id, {
        templateId: state.templateKey || undefined,
        agents: state.agents.length > 0 ? state.agents : undefined,
        skillKeys: state.skillKeys.length > 0 ? state.skillKeys : undefined,
        managedSkillKeys: finalManagedSkillKeys,
        enableDemoData: state.enableDemoData,
        defaultModel: state.model || undefined,
      });

      // Provision returned — DB is ready, Docker is starting in background
      setProvisionStep(3); // Starting containers
      setProvisioningId(ws.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Deployment failed");
      setDeploying(false);
      setProvisioningId(null);
    }
  }

  // Poll Docker status until gateway is running
  useEffect(() => {
    if (!provisioningId) return;
    let cancelled = false;
    const stepTimer = setInterval(() => {
      setProvisionStep((s) => (s < 5 ? s + 1 : s));
    }, 8000);

    const poll = async () => {
      while (!cancelled) {
        try {
          const { status } = await api.workspaces.dockerStatus(provisioningId);
          if (status === "running") {
            setProvisionStep(6);
            await new Promise((r) => setTimeout(r, 6000));
            if (!cancelled) router.push(`/workspaces/${provisioningId}/kanban`);
            return;
          }
        } catch {
          // Docker not ready yet
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { cancelled = true; clearInterval(stepTimer); };
  }, [provisioningId, router]);

  const PROVISION_STEPS = [
    "Preparing workspace…",
    "Creating workspace…",
    "Provisioning agents & data…",
    "Starting containers…",
    "Installing skills…",
    "Configuring gateway…",
    "Workspace ready!",
  ];

  if (deploying && provisionStep >= 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="relative mb-8">
          {provisionStep < 6 ? (
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-zinc-800 border-t-emerald-500" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
              <Check className="h-8 w-8 text-emerald-400" />
            </div>
          )}
        </div>

        <h2 className="mb-2 text-lg font-semibold text-zinc-200">
          {provisionStep < 6 ? "Building Your Workspace" : "Workspace Ready"}
        </h2>
        <p className="mb-8 text-sm text-zinc-500">
          {PROVISION_STEPS[Math.min(provisionStep, PROVISION_STEPS.length - 1)]}
        </p>

        <div className="w-full max-w-xs space-y-2">
          {PROVISION_STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-500 ${
                i < provisionStep
                  ? "bg-emerald-500/20 text-emerald-400"
                  : i === provisionStep
                    ? "bg-zinc-700 text-zinc-200 ring-2 ring-emerald-500/50"
                    : "bg-zinc-800 text-zinc-600"
              }`}>
                {i < provisionStep ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className={`text-xs transition-colors duration-500 ${
                i < provisionStep
                  ? "text-zinc-500"
                  : i === provisionStep
                    ? "text-zinc-200 font-medium"
                    : "text-zinc-600"
              }`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold tracking-tight">Create Workspace</h1>
      </div>

      {/* Progress */}
      <div className="mt-6 flex items-center gap-1">
        {visibleSteps.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center gap-1">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                i < stepIdx
                  ? "bg-emerald-600 text-white"
                  : i === stepIdx
                    ? "bg-zinc-700 text-white"
                    : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {i < stepIdx ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </div>
            <span
              className={`hidden text-xs sm:block ${
                i === stepIdx ? "text-zinc-200" : "text-zinc-500"
              }`}
            >
              {s.label}
            </span>
            {i < visibleSteps.length - 1 && (
              <div className="mx-1 h-px flex-1 bg-zinc-800" />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        {step === "template" && (
          <StepTemplate
            templates={templates}
            selected={state.templateKey}
            onSelect={(t) => {
              const config = t.config;
              setState((s) => ({
                ...s,
                templateKey: t.key,
                templateName: t.name,
                name: t.key === "blank" ? "" : t.name,
                description: t.description,
                agents: config?.agents ?? [],
                skillKeys: config?.skills ?? [],
                enableDemoData: config?.demoData ?? false,
              }));
            }}
          />
        )}

        {step === "info" && (
          <StepInfo
            name={state.name}
            description={state.description}
            onNameChange={(v) => setState((s) => ({ ...s, name: v }))}
            onDescChange={(v) => setState((s) => ({ ...s, description: v }))}
          />
        )}

        {step === "ai" && (
          <StepAI state={state} setState={setState} />
        )}

        {step === "memory" && (
          <StepMemory state={state} setState={setState} />
        )}

        {step === "storage" && (
          <StepCloudStorage state={state} setState={setState} />
        )}

        {step === "team" && (
          <StepTeam
            templateKey={state.templateKey}
            agents={state.agents}
            skillKeys={state.skillKeys}
            managedCatalog={managedCatalog}
            managedSkillKeys={effectiveManagedSkillKeys}
            onManagedSkillToggle={(key) =>
              setState((s) => {
                // Resolve the sentinel-null against the catalog defaults so
                // the toggle always operates on a concrete array, then write
                // back an explicit string[] (the user has now customized).
                const current =
                  s.managedSkillKeys ??
                  defaultManagedSkillKeysFor(managedCatalog, s.templateKey);
                return {
                  ...s,
                  managedSkillKeys: current.includes(key)
                    ? current.filter((k) => k !== key)
                    : [...current, key],
                };
              })
            }
            enableDemoData={state.enableDemoData}
            onDemoDataChange={(v) =>
              setState((s) => ({ ...s, enableDemoData: v }))
            }
          />
        )}

        {step === "review" && (
          <StepReview
            state={state}
            effectiveManagedSkillKeys={effectiveManagedSkillKeys}
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-md bg-red-900/30 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={prev}
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <ChevronLeft className="h-4 w-4" />
          {stepIdx === 0 ? "Cancel" : "Back"}
        </button>

        {step === "review" ? (
          <button
            onClick={deploy}
            disabled={deploying || !state.name.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {deploying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4" />
                Deploy Workspace
              </>
            )}
          </button>
        ) : (
          <button
            onClick={next}
            disabled={step === "template" && !state.templateKey}
            className="inline-flex items-center gap-1.5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Step Components ---

function StepTemplate({
  templates,
  selected,
  onSelect,
}: {
  templates: WorkspaceTemplateDetail[];
  selected: string | null;
  onSelect: (t: WorkspaceTemplateDetail) => void;
}) {
  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-200">Choose a Template</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Select a workspace blueprint to get started.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[...templates].sort((a, b) => (a.key === "opcify_starter" ? -1 : b.key === "opcify_starter" ? 1 : 0)).map((t) => {
          const Icon = templateIcons[t.icon] || LayoutDashboard;
          const isSelected = selected === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onSelect(t)}
              className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-all ${
                isSelected
                  ? "border-emerald-600 bg-emerald-600/5"
                  : "border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                  isSelected
                    ? "bg-emerald-600/20 text-emerald-400"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">
                    {t.name}
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{t.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepInfo({
  name,
  description,
  onNameChange,
  onDescChange,
}: {
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescChange: (v: string) => void;
}) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-200">Basic Info</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Give your workspace a name and description.
      </p>
      <div className="mt-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300">
            Workspace Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. My Content Studio"
            className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
          />
          {slug && (
            <p className="mt-1 text-xs text-zinc-600">
              Slug: {slug}
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => onDescChange(e.target.value)}
            placeholder="What is this workspace for?"
            rows={3}
            className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
          />
        </div>
      </div>
    </div>
  );
}

// --- AI Setup Step ---

function StepAI({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  const [showCustomModelInput, setShowCustomModelInput] = useState(false);
  const [customModelValue, setCustomModelValue] = useState("");

  // Get current provider's configured API key
  const currentProviderConfig = state.aiProviders.find((p) => p.id === state.providerId);
  const [apiKeyInput, setApiKeyInput] = useState(currentProviderConfig?.apiKey ?? "");
  const [showApiKey, setShowApiKey] = useState(false);

  // Resolve models for selected provider
  const builtInProvider = BUILT_IN_PROVIDERS.find((p) => p.id === state.providerId);
  const customProviderConfig = state.aiProviders.find(
    (p) => p.id === state.providerId && p.baseUrl,
  );
  // Extra custom models added by user for this provider (stored without baseUrl)
  const providerExtraModels =
    state.aiProviders.find((p) => p.id === state.providerId && !p.baseUrl)?.models ?? [];
  const models = [
    ...(builtInProvider?.models ?? customProviderConfig?.models ?? []),
    ...providerExtraModels,
  ];

  const isCustomProvider = !builtInProvider && !!customProviderConfig;

  // Update API key for current provider
  const saveApiKey = useCallback(
    (key: string) => {
      setState((s) => {
        const existing = s.aiProviders.filter((p) => p.id !== s.providerId);
        // Merge all existing configs for this provider to preserve custom models
        const prevEntries = s.aiProviders.filter((p) => p.id === s.providerId);
        const merged: AIProviderConfig = { id: s.providerId, apiKey: key.trim() };
        for (const entry of prevEntries) {
          if (entry.label) merged.label = entry.label;
          if (entry.baseUrl) merged.baseUrl = entry.baseUrl;
          if (entry.models?.length) {
            merged.models = [
              ...(merged.models ?? []),
              ...entry.models,
            ];
          }
        }
        // If key is empty and no other properties, remove entry entirely
        if (!key.trim() && !merged.models?.length && !merged.baseUrl) {
          return { ...s, aiProviders: existing };
        }
        if (!key.trim()) merged.apiKey = "";
        return {
          ...s,
          aiProviders: [...existing, merged],
        };
      });
    },
    [setState],
  );

  // Select a provider
  function selectProvider(id: string) {
    const providerConf = state.aiProviders.find((p) => p.id === id);
    setApiKeyInput(providerConf?.apiKey ?? "");
    setShowApiKey(false);

    // Pick first model of this provider as default
    const bp = BUILT_IN_PROVIDERS.find((p) => p.id === id);
    const cp = state.aiProviders.find((p) => p.id === id && p.models);
    const defaultModel =
      id === "openrouter"
        ? bp?.models.find((m) => m.value === "qwen/qwen3.6-plus")?.value
        : undefined;
    const firstModel = defaultModel ?? bp?.models[0]?.value ?? cp?.models?.[0]?.value ?? "";

    setState((s) => ({ ...s, providerId: id, model: firstModel }));
  }

  // Add custom provider
  function addCustomProvider() {
    if (!customLabel.trim() || !customBaseUrl.trim() || !customModelName.trim()) return;

    const customId = `custom-${Date.now().toString(36)}`;
    const newProvider: AIProviderConfig = {
      id: customId,
      label: customLabel.trim(),
      baseUrl: customBaseUrl.trim(),
      apiKey: customApiKey.trim(),
      models: [{ value: customModelName.trim(), label: customModelName.trim() }],
    };

    setState((s) => ({
      ...s,
      aiProviders: [...s.aiProviders, newProvider],
      providerId: customId,
      model: customModelName.trim(),
    }));

    setApiKeyInput(customApiKey.trim());
    setCustomLabel("");
    setCustomBaseUrl("");
    setCustomApiKey("");
    setCustomModelName("");
    setShowCustomForm(false);
  }

  // Remove custom provider
  function removeCustomProvider(id: string) {
    setState((s) => {
      const filtered = s.aiProviders.filter((p) => p.id !== id);
      const wasSelected = s.providerId === id;
      return {
        ...s,
        aiProviders: filtered,
        providerId: wasSelected ? "openai" : s.providerId,
        model: wasSelected ? "gpt-5.4" : s.model,
      };
    });
  }

  // All custom providers (ones with baseUrl)
  const customProviders = state.aiProviders.filter((p) => p.baseUrl);

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-200">AI Setup</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Select an AI provider, choose a model, and add your API key.
      </p>

      <div className="mt-5 space-y-5">
        {/* 1. Provider Selection */}
        <div>
          <label className="block text-sm font-medium text-zinc-300">
            AI Provider
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUILT_IN_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProvider(p.id)}
                className={`rounded-md border px-3 py-2.5 text-left text-sm transition-all ${
                  state.providerId === p.id
                    ? "border-emerald-600 bg-emerald-600/10 text-emerald-300"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                <span className="font-medium">{p.label}</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {p.models.length} models
                </span>
              </button>
            ))}
          </div>

          {/* Custom providers */}
          {customProviders.length > 0 && (
            <div className="mt-2 space-y-2">
              {customProviders.map((cp) => (
                <div
                  key={cp.id}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2.5 transition-all ${
                    state.providerId === cp.id
                      ? "border-emerald-600 bg-emerald-600/10"
                      : "border-zinc-700"
                  }`}
                >
                  <button
                    onClick={() => selectProvider(cp.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Server className="h-4 w-4 shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${state.providerId === cp.id ? "text-emerald-300" : "text-zinc-300"}`}>
                        {cp.label}
                      </p>
                      <p className="truncate text-xs text-zinc-500">{cp.baseUrl}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => removeCustomProvider(cp.id)}
                    className="rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add custom provider */}
          {!showCustomForm ? (
            <button
              onClick={() => setShowCustomForm(true)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <Plus className="h-3 w-3" />
              Add custom provider
            </button>
          ) : (
            <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
              <p className="text-sm font-medium text-zinc-300">Custom AI Provider</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Connect your own model endpoint (OpenAI-compatible API).
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400">Provider Name</label>
                  <input
                    type="text"
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder="e.g. My Local LLM"
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400">Base URL</label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="e.g. https://api.example.com/v1"
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400">Model Name</label>
                  <input
                    type="text"
                    value={customModelName}
                    onChange={(e) => setCustomModelName(e.target.value)}
                    placeholder="e.g. llama-3-70b, mixtral-8x7b"
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400">API Key (optional)</label>
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={addCustomProvider}
                    disabled={!customLabel.trim() || !customBaseUrl.trim() || !customModelName.trim()}
                    className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-40"
                  >
                    Add Provider
                  </button>
                  <button
                    onClick={() => {
                      setShowCustomForm(false);
                      setCustomLabel("");
                      setCustomBaseUrl("");
                      setCustomApiKey("");
                      setCustomModelName("");
                    }}
                    className="rounded-md px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 2. Model Selection */}
        <div>
          <label className="block text-sm font-medium text-zinc-300">
            Model
          </label>
          {models.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {models.map((m) => (
                <button
                  key={m.value}
                  onClick={() => {
                    setState((s) => ({ ...s, model: m.value }));
                    setShowCustomModelInput(false);
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-all ${
                    state.model === m.value
                      ? "border-emerald-600 bg-emerald-600/10 text-emerald-300"
                      : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                  }`}
                >
                  <span className="font-medium">{m.label}</span>
                  {m.desc && (
                    <span className="mt-0.5 block text-xs text-zinc-500">{m.desc}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Add custom model to this provider */}
          {!showCustomModelInput ? (
            <button
              onClick={() => setShowCustomModelInput(true)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <Plus className="h-3 w-3" />
              Add custom model
            </button>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={customModelValue}
                onChange={(e) => setCustomModelValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customModelValue.trim()) {
                    const val = customModelValue.trim();
                    setState((s) => {
                      const pid = s.providerId;
                      const existingConf = s.aiProviders.find((p) => p.id === pid && !p.baseUrl);
                      const otherConfs = s.aiProviders.filter((p) => !(p.id === pid && !p.baseUrl));
                      const existingModels = existingConf?.models ?? [];
                      if (existingModels.some((m) => m.value === val)) {
                        return { ...s, model: val };
                      }
                      return {
                        ...s,
                        model: val,
                        aiProviders: [
                          ...otherConfs,
                          {
                            ...existingConf,
                            id: pid,
                            apiKey: existingConf?.apiKey ?? "",
                            models: [...existingModels, { value: val, label: val }],
                          },
                        ],
                      };
                    });
                    setCustomModelValue("");
                    setShowCustomModelInput(false);
                  }
                }}
                placeholder="e.g. gpt-4o-2024-11-20"
                autoFocus
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
              />
              <button
                onClick={() => {
                  if (customModelValue.trim()) {
                    const val = customModelValue.trim();
                    setState((s) => {
                      const pid = s.providerId;
                      const existingConf = s.aiProviders.find((p) => p.id === pid && !p.baseUrl);
                      const otherConfs = s.aiProviders.filter((p) => !(p.id === pid && !p.baseUrl));
                      const existingModels = existingConf?.models ?? [];
                      if (existingModels.some((m) => m.value === val)) {
                        return { ...s, model: val };
                      }
                      return {
                        ...s,
                        model: val,
                        aiProviders: [
                          ...otherConfs,
                          {
                            ...existingConf,
                            id: pid,
                            apiKey: existingConf?.apiKey ?? "",
                            models: [...existingModels, { value: val, label: val }],
                          },
                        ],
                      };
                    });
                    setCustomModelValue("");
                    setShowCustomModelInput(false);
                  }
                }}
                className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowCustomModelInput(false);
                  setCustomModelValue("");
                }}
                className="rounded-md px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Model quality warning */}
        {state.model && !RECOMMENDED_MODELS.has(state.model) && (
          <div className="flex items-start gap-2 rounded-md border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This model hasn&apos;t been tested with Opcify. Performance may vary — switch models if you run into issues.
            </p>
          </div>
        )}

        {/* 3. API Key */}
        {!isCustomProvider && (
          <div>
            <label className="block text-sm font-medium text-zinc-300">
              API Key
              <span className="ml-1 text-xs font-normal text-zinc-500">(optional — can be set later)</span>
            </label>
            <div className="relative mt-1.5">
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  saveApiKey(e.target.value);
                }}
                placeholder={`Enter your ${builtInProvider?.label ?? "provider"} API key`}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 pr-10 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Memory Step ──────────────────────────────────────────────────────
//
// Three modes cover the realistic deployment shapes:
//
//   • Local  — QMD runs inside the container on CPU. Free, no network dep,
//              but embeddings are slow (single ~15-doc cycle takes 5+ min on
//              a 10-core host). Nightly dreaming still runs to refresh the
//              index; the periodic interval loop is disabled at the backend.
//   • Remote — Route embedding through an external provider (OpenAI, Voyage,
//              Ollama, etc). QMD still runs locally for FTS + storage; only
//              the vector side is offloaded.
//   • Disabled — Skip vector embedding entirely. Hybrid recall falls back to
//              pure BM25 keyword search. Cheapest; useful when semantic
//              recall is not worth the CPU cost.
//
// Sub-knobs shown in every mode: sessions indexing, dreaming, hybrid weights.
// Remote mode additionally exposes provider + base URL + API key fields.
// Disabled mode force-locks weights to 0/1 (informational only — the backend
// enforces the override regardless of what the user typed).

function StepMemory({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const m = state.memory;
  const update = (patch: Partial<MemoryConfig>) =>
    setState((s) => ({ ...s, memory: { ...s.memory, ...patch } }));

  // Switch modes while quietly upgrading the mode-appropriate weight defaults
  // _only when_ the user hasn't customized them. Local embeds lag so we bias
  // toward text (0.3/0.7); remote embeds are fresh so we bias toward vectors
  // (0.7/0.3). Disabled is indifferent. If the user already edited the weights
  // away from either default, their values survive the mode switch.
  const pickMode = (newMode: MemoryMode) => {
    const LOCAL_DEFAULT = { vectorWeight: 0.3, textWeight: 0.7 };
    const REMOTE_DEFAULT = { vectorWeight: 0.7, textWeight: 0.3 };
    const atLocalDefault =
      m.vectorWeight === LOCAL_DEFAULT.vectorWeight &&
      m.textWeight === LOCAL_DEFAULT.textWeight;
    const atRemoteDefault =
      m.vectorWeight === REMOTE_DEFAULT.vectorWeight &&
      m.textWeight === REMOTE_DEFAULT.textWeight;

    if (newMode === "remote" && atLocalDefault) {
      update({ mode: newMode, ...REMOTE_DEFAULT });
    } else if (newMode === "local" && atRemoteDefault) {
      update({ mode: newMode, ...LOCAL_DEFAULT });
    } else {
      update({ mode: newMode });
    }
  };

  const MODE_OPTIONS: { id: MemoryMode; title: string; summary: string }[] = [
    {
      id: "disabled",
      title: "Memory.md (Built-in)",
      summary:
        "Shuts off cross-session memory recall entirely. Agents keep their in-session context but don't pull from prior conversations. Cheapest — no embedding cost, no API calls, no CPU load. If an OpenAI or Google API key is added, Remote Embedding will be auto-enabled.",
    },
    {
      id: "remote",
      title: "Remote Embedding Engine (Built-in)",
      summary:
        "Offload embedding to OpenAI, Voyage, Ollama, etc. OpenClaw hands every query to the remote provider and uses the builtin memory backend locally — nothing touches QMD. Fastest semantic recall if you're OK paying per request.",
    },
    {
      id: "local",
      title: "QMD Memory Engine (Local CPU)",
      summary:
        "QMD runs inside the container. Embeddings refresh nightly via the dream sweep — slow on CPU-only hosts but zero network dependencies and zero per-call cost.",
    },
  ];

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-200">Memory Setup</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Choose how agents store and recall long-term context. You can change this later from the workspace settings.
      </p>

      {/* Mode selector */}
      <div className="mt-5 space-y-2">
        {MODE_OPTIONS.map((opt) => {
          const active = m.mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => pickMode(opt.id)}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                active
                  ? "border-emerald-600/70 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-200">{opt.title}</span>
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                    active ? "border-emerald-500 bg-emerald-500" : "border-zinc-600"
                  }`}
                >
                  {active && <Check className="h-3 w-3 text-white" />}
                </div>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{opt.summary}</p>
            </button>
          );
        })}
      </div>

      {/* Remote provider sub-fields */}
      {m.mode === "remote" && (
        <div className="mt-5 space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300">
              Embedding provider
            </label>
            <select
              value={m.remoteProvider ?? "openai"}
              onChange={(e) =>
                update({ remoteProvider: e.target.value as MemoryRemoteProvider })
              }
              className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            >
              {MEMORY_REMOTE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-600">
              {MEMORY_REMOTE_PROVIDERS.find(
                (p) => p.id === (m.remoteProvider ?? "openai"),
              )?.hint}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">
              Model ID <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={m.remoteModel ?? ""}
              onChange={(e) => update({ remoteModel: e.target.value })}
              placeholder="text-embedding-3-small"
              className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
            <p className="mt-1 text-xs text-zinc-600">
              Pin a specific embedding model (e.g. <code className="font-mono">text-embedding-3-small</code>,{" "}
              <code className="font-mono">voyage-3</code>,{" "}
              <code className="font-mono">nomic-embed-text</code>). Leave blank to use the provider's default.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">
              Base URL <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="url"
              value={m.remoteBaseUrl ?? ""}
              onChange={(e) => update({ remoteBaseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
            <p className="mt-1 text-xs text-zinc-600">
              Override only if you're pointing at an OpenAI-compatible proxy
              (Together, NVIDIA NIM, local Ollama, etc).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300">
              API key <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="password"
              value={m.remoteApiKey ?? ""}
              onChange={(e) => update({ remoteApiKey: e.target.value })}
              placeholder="sk-..."
              className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
            <p className="mt-1 text-xs text-zinc-600">
              Leave blank to inherit the provider's default credentials from
              the gateway environment.
            </p>
          </div>
        </div>
      )}

      {/* Advanced sub-controls — QMD-only (sessions, dreaming, hybrid weights).
          Disabled mode swaps the backend to `builtin` AND sets
          memorySearch.enabled=true, which auto-enables embedding when an API
          key is present. */}
      {m.mode === "disabled" ? (
        <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            What this mode does
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Writes <code className="font-mono">memory.backend: &quot;builtin&quot;</code> and{" "}
            <code className="font-mono">memorySearch.enabled: true</code>. The
            embedding model will auto-enable if an OpenAI or Google API key is
            added — no manual configuration needed.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Advanced
          </div>

          {/* Sessions — QMD-only. Remote mode uses the builtin backend so
              there's no QMD session ingestion to toggle. */}
          {m.mode === "local" && (
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={m.sessionsEnabled}
                onChange={(e) => update({ sessionsEnabled: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50"
              />
              <div>
                <div className="text-sm text-zinc-200">Index chat sessions</div>
                <div className="text-xs text-zinc-600">
                  Write agent session transcripts into QMD so they become searchable. Turn off on tight-storage hosts.
                </div>
              </div>
            </label>
          )}

          {/* Dreaming */}
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={m.dreamingEnabled}
              onChange={(e) => update({ dreamingEnabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/50"
            />
            <div>
              <div className="text-sm text-zinc-200">Nightly dream sweep</div>
              <div className="text-xs text-zinc-600">
                Consolidates memories at 03:00 UTC. Keep on to let the index catch up with the day's conversations.
              </div>
            </div>
          </label>

          {/* Hybrid weights */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm text-zinc-200">Hybrid recall weights</div>
              <div className="text-xs text-zinc-500">
                vector {m.vectorWeight.toFixed(2)} / text {m.textWeight.toFixed(2)}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-zinc-500">Vector weight</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={m.vectorWeight}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                    // Keep the two weights summing to 1 for a consistent mental
                    // model — users rarely want them to drift apart.
                    update({ vectorWeight: v, textWeight: Number((1 - v).toFixed(2)) });
                  }}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500">Text (BM25) weight</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={m.textWeight}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                    update({ textWeight: v, vectorWeight: Number((1 - v).toFixed(2)) });
                  }}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-600">
              Higher vector weight trusts semantic similarity; higher text weight trusts keyword match. Defaults to 0.3 / 0.7 because local embeds lag behind live sessions.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StepTeam({
  templateKey,
  agents,
  skillKeys,
  managedCatalog,
  managedSkillKeys,
  onManagedSkillToggle,
  enableDemoData: _enableDemoData,
  onDemoDataChange: _onDemoDataChange,
}: {
  templateKey: string | null;
  agents: WorkspaceTemplateAgent[];
  skillKeys: string[];
  managedCatalog: ManagedSkill[];
  managedSkillKeys: string[];
  onManagedSkillToggle: (key: string) => void;
  enableDemoData: boolean;
  onDemoDataChange: (v: boolean) => void;
}) {
  const visibleSkills = visibleManagedSkills(managedCatalog, templateKey);
  // Always-on skills render as locked checkboxes (e.g. opcify, browser-use).
  // Note: the API hides "opcify" from the catalog response since it has no
  // user-facing toggle, so this loop only renders alwaysOn skills the user
  // can actually see — and skills like browser-use have alwaysOn === true.
  const alwaysOnSkills = visibleSkills.filter((s) => s.alwaysOn);
  const toggleableSkills = visibleSkills.filter((s) => !s.alwaysOn);
  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-200">Team Setup</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Review the agents and skills that will be installed.
      </p>
      <div className="mt-5 space-y-5">
        {agents.length > 0 ? (
          <div>
            <p className="text-sm font-medium text-zinc-300">Agents</p>
            <div className="mt-2 space-y-2">
              {agents.map((a, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-800/50 px-3 py-2"
                >
                  <Bot className="h-4 w-4 shrink-0 text-zinc-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-200">{a.name}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {a.role} · {a.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            No agents pre-configured. You can add them after creation.
          </p>
        )}

        {/* Required Skills (from template) */}
        {skillKeys.length > 0 && (
          <div>
            <p className="text-sm font-medium text-zinc-300">Required Skills</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Required by the template and cannot be removed.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {skillKeys.map((sk) => (
                <span
                  key={sk}
                  className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400"
                >
                  <Sparkles className="h-3 w-3" />
                  {sk}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Opcify Managed Skills — fully data-driven from /managed-skills/catalog */}
        <div>
          <p className="text-sm font-medium text-zinc-300">Opcify Skills</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Select the skills to install. You can enable more later from the Skills page.
          </p>
          <div className="mt-2 space-y-2">
            {/* The "opcify" skill itself is always on but hidden from the
                catalog response, so we render a static row for it here. */}
            <label className="flex cursor-not-allowed items-center gap-3 rounded-md border border-zinc-800 bg-zinc-800/50 px-3 py-2.5 opacity-70">
              <input type="checkbox" checked disabled className="accent-emerald-500" />
              <span className="text-base">{"\u2699\ufe0f"}</span>
              <div className="min-w-0 flex-1">
                <span className="text-sm text-zinc-300">Opcify</span>
                <p className="text-xs text-zinc-500">Task management &amp; API callbacks (always installed)</p>
              </div>
            </label>
            {alwaysOnSkills.map((s) => (
              <label
                key={s.slug}
                className="flex cursor-not-allowed items-center gap-3 rounded-md border border-zinc-800 bg-zinc-800/50 px-3 py-2.5 opacity-70"
              >
                <input type="checkbox" checked disabled className="accent-emerald-500" />
                {s.emoji && <span className="text-base">{s.emoji}</span>}
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-zinc-300">{s.label}</span>
                  <p className="text-xs text-zinc-500">{s.description} (always installed)</p>
                </div>
              </label>
            ))}
            {toggleableSkills.map((s) => {
              const selected = managedSkillKeys.includes(s.slug);
              return (
                <label
                  key={s.slug}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-800 bg-zinc-800/50 px-3 py-2.5 transition-colors hover:border-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onManagedSkillToggle(s.slug)}
                    className="accent-emerald-500"
                  />
                  {s.emoji && <span className="text-base">{s.emoji}</span>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-200">{s.label}</span>
                      {s.tier === "template-scoped" && (
                        <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-400">
                          template
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">{s.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

// --- Step: Cloud Storage ---

function StepCloudStorage({
  state,
  setState,
}: {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const selected = state.cloudStorage.provider;
  const [showSecrets, setShowSecrets] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const gcsFileInputRef = useRef<HTMLInputElement>(null);

  function loadJsonFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      try {
        JSON.parse(text);
        setJsonError(null);
      } catch {
        setJsonError("Invalid JSON file");
      }
      updateField("gcsCredentialsJson", text);
    };
    reader.readAsText(file);
  }

  function validateJson(value: string) {
    if (!value.trim()) {
      setJsonError(null);
      return;
    }
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON format");
    }
  }

  function selectProvider(id: CloudStorageProviderId) {
    setState((s) => ({
      ...s,
      cloudStorage: { ...s.cloudStorage, provider: id },
    }));
  }

  function updateField(field: string, value: string) {
    setState((s) => ({
      ...s,
      cloudStorage: { ...s.cloudStorage, [field]: value },
    }));
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-200">Cloud Storage Setup</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Connect a cloud storage provider so your Archives Director agent can back up
        deliverables and generate shareable links. You can skip this and configure it
        later from the Archives page.
      </p>

      {/* Provider selection */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {CLOUD_STORAGE_PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            onClick={() => selectProvider(provider.id)}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
              selected === provider.id
                ? "border-blue-500/50 bg-blue-500/5"
                : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
            }`}
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-xs font-bold text-zinc-300">
              {provider.id === "none" ? (
                <HardDrive className="h-4 w-4" />
              ) : (
                <Cloud className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-200">{provider.label}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{provider.description}</p>
            </div>
            {selected === provider.id && (
              <Check className="ml-auto mt-1 h-4 w-4 shrink-0 text-blue-400" />
            )}
          </button>
        ))}
      </div>

      {/* Configuration fields per provider */}
      {selected === "gcs" && (
        <div className="mt-5 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h4 className="text-sm font-medium text-zinc-300">Google Cloud Storage</h4>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Bucket Name *</label>
            <input
              value={state.cloudStorage.gcsBucketName || ""}
              onChange={(e) => updateField("gcsBucketName", e.target.value)}
              placeholder="my-workspace-bucket"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-zinc-500">Service Account Key (JSON) *</label>
              <button
                type="button"
                onClick={() => gcsFileInputRef.current?.click()}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Choose from file
              </button>
              <input
                ref={gcsFileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadJsonFile(file);
                  e.target.value = "";
                }}
              />
            </div>
            <textarea
              value={state.cloudStorage.gcsCredentialsJson || ""}
              onChange={(e) => {
                updateField("gcsCredentialsJson", e.target.value);
                validateJson(e.target.value);
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) loadJsonFile(file);
              }}
              placeholder='{"type":"service_account","project_id":"...","private_key":"..."}'
              rows={6}
              className={`w-full rounded-md border ${
                dragOver ? "border-blue-500 bg-blue-500/5" : jsonError ? "border-red-500/50" : "border-zinc-700"
              } bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none font-mono text-xs transition-colors`}
            />
            {jsonError ? (
              <p className="mt-1 text-xs text-red-400">{jsonError}</p>
            ) : (
              <p className="mt-1 text-xs text-zinc-600">
                Paste JSON, drag & drop a .json file, or use &quot;Choose from file&quot;
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Path Prefix (optional)</label>
            <input
              value={state.cloudStorage.gcsPrefix || ""}
              onChange={(e) => updateField("gcsPrefix", e.target.value)}
              placeholder="workspaces/my-workspace"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      {selected === "s3" && (
        <div className="mt-5 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h4 className="text-sm font-medium text-zinc-300">Amazon S3</h4>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Bucket Name *</label>
            <input
              value={state.cloudStorage.s3BucketName || ""}
              onChange={(e) => updateField("s3BucketName", e.target.value)}
              placeholder="my-workspace-bucket"
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Access Key ID *</label>
              <input
                value={state.cloudStorage.awsAccessKeyId || ""}
                onChange={(e) => updateField("awsAccessKeyId", e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Secret Access Key *</label>
              <div className="relative">
                <input
                  type={showSecrets ? "text" : "password"}
                  value={state.cloudStorage.awsSecretAccessKey || ""}
                  onChange={(e) => updateField("awsSecretAccessKey", e.target.value)}
                  placeholder="wJalrXUtnFEMI..."
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none font-mono text-xs"
                />
                <button type="button" onClick={() => setShowSecrets(!showSecrets)} className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300">
                  {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Region *</label>
              <input
                value={state.cloudStorage.awsRegion || ""}
                onChange={(e) => updateField("awsRegion", e.target.value)}
                placeholder="us-east-1"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Path Prefix (optional)</label>
              <input
                value={state.cloudStorage.s3Prefix || ""}
                onChange={(e) => updateField("s3Prefix", e.target.value)}
                placeholder="workspaces/my-workspace"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {selected === "r2" && (
        <div className="mt-5 space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h4 className="text-sm font-medium text-zinc-300">Cloudflare R2</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Bucket Name *</label>
              <input
                value={state.cloudStorage.r2BucketName || ""}
                onChange={(e) => updateField("r2BucketName", e.target.value)}
                placeholder="my-workspace-bucket"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Account ID *</label>
              <input
                value={state.cloudStorage.r2AccountId || ""}
                onChange={(e) => updateField("r2AccountId", e.target.value)}
                placeholder="a1b2c3d4e5f6..."
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none font-mono text-xs"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Access Key ID *</label>
              <input
                value={state.cloudStorage.r2AccessKeyId || ""}
                onChange={(e) => updateField("r2AccessKeyId", e.target.value)}
                placeholder="R2 API token access key"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Secret Access Key *</label>
              <div className="relative">
                <input
                  type={showSecrets ? "text" : "password"}
                  value={state.cloudStorage.r2SecretAccessKey || ""}
                  onChange={(e) => updateField("r2SecretAccessKey", e.target.value)}
                  placeholder="R2 API token secret"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 pr-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none font-mono text-xs"
                />
                <button type="button" onClick={() => setShowSecrets(!showSecrets)} className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300">
                  {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Path Prefix (optional)</label>
              <input
                value={state.cloudStorage.r2Prefix || ""}
                onChange={(e) => updateField("r2Prefix", e.target.value)}
                placeholder="workspaces/my-workspace"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Public Domain (optional)</label>
              <input
                value={state.cloudStorage.r2PublicDomain || ""}
                onChange={(e) => updateField("r2PublicDomain", e.target.value)}
                placeholder="files.example.com"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepReview({
  state,
  effectiveManagedSkillKeys,
}: {
  state: WizardState;
  effectiveManagedSkillKeys: string[];
}) {
  const providerLabel =
    BUILT_IN_PROVIDERS.find((p) => p.id === state.providerId)?.label ??
    state.aiProviders.find((p) => p.id === state.providerId)?.label ??
    state.providerId;
  const configuredCount = state.aiProviders.filter((p) => p.apiKey).length;

  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-200">Review & Deploy</h3>
      <p className="mt-1 text-sm text-zinc-500">
        Confirm your workspace configuration before deploying.
      </p>
      <div className="mt-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Name
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {state.name || "Untitled Workspace"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Template
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {state.templateName || "Blank"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              AI Provider
            </p>
            <p className="mt-1 text-sm text-zinc-200">{providerLabel}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Default Model
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {getModelLabel(state.model)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              API Keys
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {configuredCount > 0
                ? `${configuredCount} provider${configuredCount !== 1 ? "s" : ""} configured`
                : "None configured"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Agents
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {state.agents.length} agent{state.agents.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Skills
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {state.skillKeys.length} required
              {effectiveManagedSkillKeys.length > 0
                ? ` + ${effectiveManagedSkillKeys.length + 1} Opcify`
                : " + 1 Opcify"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Cloud Storage
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {state.cloudStorage.provider === "none"
                ? "Not configured"
                : CLOUD_STORAGE_PROVIDERS.find((p) => p.id === state.cloudStorage.provider)?.label ?? state.cloudStorage.provider}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Demo Data
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {state.enableDemoData ? "Yes" : "No"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Memory
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {state.memory.mode === "disabled"
                ? "Memory.md (Built-in)"
                : state.memory.mode === "remote"
                  ? "Remote Embedding Engine"
                  : "QMD Memory Engine (Local CPU)"}
            </p>
          </div>
          {state.memory.mode === "remote" && state.memory.remoteProvider && (
            <>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Embedding Provider
                </p>
                <p className="mt-1 text-sm text-zinc-200">
                  {MEMORY_REMOTE_PROVIDERS.find((p) => p.id === state.memory.remoteProvider)?.label ?? state.memory.remoteProvider}
                </p>
              </div>
              {state.memory.remoteModel && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Embedding Model
                  </p>
                  <p className="mt-1 text-sm text-zinc-200">
                    {state.memory.remoteModel}
                  </p>
                </div>
              )}
            </>
          )}
          {state.memory.mode === "local" && (
            <>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Sessions
                </p>
                <p className="mt-1 text-sm text-zinc-200">
                  {state.memory.sessionsEnabled ? "Enabled" : "Disabled"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Dream Sweep
                </p>
                <p className="mt-1 text-sm text-zinc-200">
                  {state.memory.dreamingEnabled ? "Enabled" : "Disabled"}
                </p>
              </div>
            </>
          )}
        </div>
        {state.description && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Description
            </p>
            <p className="mt-1 text-sm text-zinc-400">{state.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}
