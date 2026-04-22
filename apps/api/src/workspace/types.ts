// ─── Workspace Docker Lifecycle Types ───────────────────────────────

export type ContainerState = "running" | "stopped" | "missing";

export type WorkspaceDockerState = {
  gateway: ContainerState;
  browser: ContainerState;
  network: boolean;
};

export type WorkspaceUserConfig = {
  model?: string;
  modelFallbacks?: string[];
  browser?: {
    enabled: boolean;
    headless?: boolean; // default true
    enableNoVNC?: boolean; // default false
    memory?: number; // MB, default 512
    cpu?: number; // cores, default 0.5
  };
  gateway?: {
    memory?: number; // MB, default 2048
    cpu?: number; // cores, default 1
  };
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  env?: Record<string, string>;
  /**
   * Memory / semantic recall configuration. Three modes map onto how
   * buildOpenclawJson wires `config.memory`, `agents.defaults.memorySearch`,
   * and `plugins.memory-core.config.dreaming`. Omitting the field falls back
   * to "local" defaults (matches the prior hardcoded behavior — see
   * WorkspaceConfig.ts).
   */
  memory?: WorkspaceMemoryConfig;
  /** Opcify managed skills to install. "opcify" is always included. */
  managedSkillKeys?: string[];
  /**
   * ClawHub skill slugs declared in the workspace template's `skills:` array
   * (e.g. "web-search"). Pre-registered in skills.entries by buildOpenclawJson
   * so they appear in agents.defaults.skills + every agents.list[].skills from
   * the very first openclaw.json write — installSkillBySlug then just downloads
   * the actual skill files via the CLI without needing to mutate openclaw.json.
   */
  clawHubSkillKeys?: string[];
  /** IANA timezone for the workspace (e.g. "America/New_York"). Defaults to UTC. */
  timezone?: string;
};

// ─── Memory config ───────────────────────────────────────────────────

/**
 * Embedding providers understood by OpenClaw's memorySearch.provider field.
 * Kept in sync with the upstream schema (docs.openclaw.ai/reference/memory-config).
 * "local" runs the bundled llama.cpp embeddings inside the container — slow on
 * CPU-only hardware. Everything else offloads embedding work to a remote API.
 */
export type MemoryRemoteProvider =
  | "openai"
  | "voyage"
  | "bedrock"
  | "gemini"
  | "mistral"
  | "ollama"
  | "github-copilot";

/**
 * Knobs shared by every memory mode. `vectorWeight` + `textWeight` drive the
 * hybrid recall ranker (range 0–1, usually summing to 1). `sessionsEnabled`
 * toggles `memory.qmd.sessions.enabled`. `dreamingEnabled` toggles the nightly
 * memory-core dream sweep.
 */
export interface WorkspaceMemoryCommon {
  sessionsEnabled: boolean;
  dreamingEnabled: boolean;
  vectorWeight: number;
  textWeight: number;
}

/** Local (CPU) mode — the current default. QMD runs in-container. */
export interface WorkspaceMemoryLocal extends WorkspaceMemoryCommon {
  mode: "local";
}

/**
 * Remote embedding mode — QMD still runs locally for FTS and storage, but
 * `agents.defaults.memorySearch.provider` points at a remote embedding API.
 * `baseUrl` / `apiKey` / `headers` are optional overrides that land in
 * `memorySearch.remote` so a user can target an OpenAI-compatible proxy
 * (Together, Ollama, NVIDIA NIM, etc.) without shipping code changes.
 *
 * `model` (optional) pins the embedding model ID — lands at
 * `memorySearch.model` TOP-LEVEL alongside provider, NOT inside `.remote`.
 * Per OpenClaw's config example:
 *   memorySearch: {
 *     provider: "openai",
 *     model: "text-embedding-3-small",
 *     remote: { baseUrl: "...", apiKey: "..." }
 *   }
 */
export interface WorkspaceMemoryRemote extends WorkspaceMemoryCommon {
  mode: "remote";
  provider: MemoryRemoteProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

/**
 * Disabled mode — no vector recall at all. Hybrid weights are forced to
 * text-only under the hood regardless of what the user put in the form, and
 * dreaming is forced off since there is nothing to dream about.
 */
export interface WorkspaceMemoryDisabled extends WorkspaceMemoryCommon {
  mode: "disabled";
}

export type WorkspaceMemoryConfig =
  | WorkspaceMemoryLocal
  | WorkspaceMemoryRemote
  | WorkspaceMemoryDisabled;

export type WorkspaceStatus =
  | "creating"
  | "running"
  | "stopped"
  | "deleting"
  | "error";

export type Workspace = {
  id: string;
  token: string;
  status: WorkspaceStatus;
  gatewayUrl: string;
  gatewayPort: number;
  createdAt: Date;
  dataDir: string;
  userConfig: WorkspaceUserConfig;
};

export type WorkspaceHealth = {
  workspaceId: string;
  gateway: "healthy" | "unhealthy" | "unreachable";
  browser: "healthy" | "unhealthy" | "unreachable";
  gatewayUptime?: number;
};

export type EnsureResult = {
  action: "already_running" | "restarted" | "recreated";
  state: WorkspaceDockerState;
};
