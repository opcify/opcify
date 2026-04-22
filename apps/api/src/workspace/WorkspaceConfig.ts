import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { mkdir, writeFile, readFile, readdir, chown, stat, cp } from "node:fs/promises";
import type { AIProviderConfig, WorkspaceAISettings } from "@opcify/core";
import type {
  WorkspaceUserConfig,
  WorkspaceMemoryConfig,
  MemoryRemoteProvider,
} from "./types.js";
import { openclawModelId } from "../modules/agents/workspace-sync.js";
import { createLogger } from "../logger.js";
import {
  getAlwaysOnManagedSkillKeys,
  isManagedSkill,
} from "./managed-skills-loader.js";
import { getOpcifyCallbackUrl, getOpcifyCallbackToken } from "./opcify-url.js";

const log = createLogger("workspace-config");

// ─── Constants ──────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Walk up from __dirname to find the monorepo root (contains pnpm-workspace.yaml).
 *  Works in both dev (src/workspace/) and prod (dist/) contexts. */
function findProjectRoot(): string {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  // Fallback: assume traditional src layout
  return join(__dirname, "..", "..", "..", "..");
}

const projectRoot = findProjectRoot();

/** Path to the templates/skills/ source directory in the monorepo. */
export function getSkillsSourceDir(): string {
  return join(projectRoot, "templates", "skills");
}

// ─── Managed skill registry ─────────────────────────────────────────
//
// The registry of Opcify-managed skills is loaded at runtime from each
// `templates/skills/<slug>/_meta.json` file's `managed` block — see
// `./managed-skills-loader.ts`. There is no hardcoded list anywhere; adding
// a new skill is a matter of dropping a folder under templates/skills/ with
// a SKILL.md and a _meta.json that has a `managed` block, then restarting
// the API. The exports below are thin re-exports / wrappers around the
// loader so existing import sites keep working.

export type { ManagedSkillTier, ManagedSkillManifest } from "./managed-skills-loader.js";
export {
  loadManagedSkillRegistry,
  getManagedSkillKeys,
  getAlwaysOnManagedSkillKeys,
  getGeneralManagedSkillKeys,
  getTemplateScopedManagedSkillKeys,
  getManagedSkillManifest,
  isManagedSkill,
} from "./managed-skills-loader.js";

function resolveDataRoot(): string {
  const raw = process.env.WORKSPACE_DATA_ROOT;
  if (!raw) return join(homedir(), ".opcify", "workspaces");
  // Expand ~ to home directory (Node.js doesn't do this automatically)
  if (raw.startsWith("~")) return join(homedir(), raw.slice(1));
  return raw;
}

export const DATA_ROOT = resolveDataRoot();

// ─── Token generation ───────────────────────────────────────────────

export function generateToken(): string {
  return randomBytes(24).toString("hex");
}

// ─── Paths ──────────────────────────────────────────────────────────

export function getDataDir(workspaceId: string): string {
  return join(DATA_ROOT, workspaceId);
}

// ─── Container naming convention ────────────────────────────────────

export function containerNames(workspaceId: string) {
  return {
    gateway: `openclaw-gateway-${workspaceId}`,
    browser: `openclaw-browser-${workspaceId}`,
    network: `opcify-ws-${workspaceId}`,
  };
}

// ─── OpenClaw config builder ────────────────────────────────────────

/** Load the workspace's configured AI providers from settingsJson. */
async function loadWorkspaceProviders(
  workspaceId: string,
): Promise<AIProviderConfig[] | undefined> {
  try {
    const { prisma } = await import("../db.js");
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settingsJson: true },
    });
    if (!ws?.settingsJson) return undefined;
    const settings = JSON.parse(ws.settingsJson) as WorkspaceAISettings;
    return settings.providers ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the `models.providers` section for any custom OpenAI-compatible
 * providers the user has configured (providers that carry a `baseUrl`).
 * Returns `undefined` when there are none — callers should leave the
 * section off openclaw.json entirely in that case.
 *
 * OpenClaw spec: `models.providers.<id>` declares a bring-your-own endpoint.
 * Agents reference these models as `<id>/<model.id>` — which is exactly
 * what `openclawModelId` produces for custom providers.
 */
export function buildCustomProvidersSection(
  providers: AIProviderConfig[] | undefined,
): { mode: "merge"; providers: Record<string, Record<string, unknown>> } | undefined {
  if (!providers) return undefined;
  const entries: Record<string, Record<string, unknown>> = {};
  for (const p of providers) {
    if (!p.baseUrl) continue;
    const modelList = (p.models ?? []).map((m) => ({
      id: m.value,
      name: m.label || m.value,
    }));
    if (modelList.length === 0) continue;
    const entry: Record<string, unknown> = {
      baseUrl: p.baseUrl,
      api: "openai-completions",
      models: modelList,
    };
    if (p.apiKey) entry.apiKey = p.apiKey;
    entries[p.id] = entry;
  }
  if (Object.keys(entries).length === 0) return undefined;
  return { mode: "merge", providers: entries };
}

// ─── Memory config resolution ────────────────────────────────────────

/**
 * The values written into openclaw.json when the user hasn't picked
 * anything in the wizard. Chosen so a brand-new workspace boots without
 * flooding the logs with `qmd embed timed out` warnings on CPU-only hosts:
 *
 *   - Local provider (embedding runs in-container via llama.cpp)
 *   - Periodic embed loop OFF (interval "0") — embeds only happen via the
 *     nightly dream sweep and manual `qmd update`, both of which get generous
 *     per-cycle timeouts below.
 *   - Hybrid recall biased toward text (0.3 / 0.7) since vectors may lag.
 *   - Sessions indexing + dreaming both ON so recall has something to work
 *     with once an embed cycle eventually completes.
 */
const DEFAULT_MEMORY_CONFIG: ResolvedMemoryConfig = {
  mode: "local",
  sessionsEnabled: true,
  dreamingEnabled: true,
  vectorWeight: 0.3,
  textWeight: 0.7,
};

interface ResolvedMemoryLocal {
  mode: "local";
  sessionsEnabled: boolean;
  dreamingEnabled: boolean;
  vectorWeight: number;
  textWeight: number;
}

interface ResolvedMemoryRemote {
  mode: "remote";
  sessionsEnabled: boolean;
  dreamingEnabled: boolean;
  vectorWeight: number;
  textWeight: number;
  provider: MemoryRemoteProvider;
  /**
   * Optional embedding model ID — lands at `memorySearch.model` top-level
   * (not inside `remote`). See the comment on WorkspaceMemoryRemote for the
   * exact openclaw.json shape.
   */
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

interface ResolvedMemoryDisabled {
  mode: "disabled";
  sessionsEnabled: boolean;
  /** Always false in disabled mode — there's nothing to dream about. */
  dreamingEnabled: false;
  /** Always 0 in disabled mode — vectors are unreachable. */
  vectorWeight: 0;
  /** Always 1 in disabled mode — recall falls back to pure BM25. */
  textWeight: 1;
}

type ResolvedMemoryConfig =
  | ResolvedMemoryLocal
  | ResolvedMemoryRemote
  | ResolvedMemoryDisabled;

/**
 * Build the `agents.defaults.memorySearch` object for a resolved memory mode.
 *
 *   - local   → QMD-backed hybrid recall. `provider: "local"` plus the
 *               user's hybrid weights + MMR + temporal decay. `store.vector`
 *               + `query.hybrid` are both enabled.
 *   - remote  → Same hybrid recall, but `provider` is the remote embedding
 *               service (openai/voyage/...) and the optional `remote`
 *               endpoint override carries baseUrl/apiKey/headers. Empty
 *               strings are dropped so OpenClaw's own provider defaults
 *               survive a server-side merge.
 *   - disabled→ Enable memorySearch with `enabled: true`.
 *               OpenClaw will use FTS for memory seach.
 *
 * Exported for unit tests that want to pin the exact shape per mode.
 */
export function buildMemorySearchBlock(
  memoryCfg: ResolvedMemoryConfig,
): Record<string, unknown> {
  if (memoryCfg.mode === "disabled") {
    return {
      enabled: true,
    };
  }

  const search: Record<string, unknown> = {
    enabled: true,
    provider: memoryCfg.mode === "remote" ? memoryCfg.provider : "local",
    store: { vector: { enabled: true } },
    sync: {
      watch: true,
      onSessionStart: true,
      sessions: {
        deltaBytes: 100000,
        deltaMessages: 100,
      },
    },
    query: {
      hybrid: {
        enabled: true,
        vectorWeight: memoryCfg.vectorWeight,
        textWeight: memoryCfg.textWeight,
        mmr: { enabled: true, lambda: 0.7 },
        temporalDecay: { enabled: true, halfLifeDays: 30 },
      },
    },
  };

  if (memoryCfg.mode === "remote") {
    // `model` is a TOP-LEVEL sibling of provider, NOT nested inside remote.
    // This matches OpenClaw's documented shape:
    //   { provider, model, remote: { baseUrl, apiKey } }
    if (memoryCfg.model) {
      search.model = memoryCfg.model;
    }

    const remote: Record<string, unknown> = {
      batch: { enabled: false },
    };
    if (memoryCfg.baseUrl) remote.baseUrl = memoryCfg.baseUrl;
    if (memoryCfg.apiKey) remote.apiKey = memoryCfg.apiKey;
    if (memoryCfg.headers && Object.keys(memoryCfg.headers).length > 0) {
      remote.headers = memoryCfg.headers;
    }
    search.remote = remote;
  }

  return search;
}

/**
 * Build the top-level `memory` config block.
 *
 *   - local     → QMD backend with the embed-timeout guards. QMD runs inside
 *                 the container and handles session ingestion + embedding.
 *   - remote    → Builtin backend. When the user points at an external
 *                 embedding provider (OpenAI, Voyage, …), OpenClaw does the
 *                 embedding through `agents.defaults.memorySearch.provider`
 *                 and there's nothing left for QMD to do locally, so we
 *                 skip the whole QMD block. This also sidesteps the CPU-only
 *                 llama.cpp embed cost entirely.
 *   - disabled  → Builtin backend, same as remote. memorySearch is off
 *                 entirely in the sibling block, so the backend choice only
 *                 matters for short-term in-process memory.
 */
export function buildMemoryBackendBlock(
  memoryCfg: ResolvedMemoryConfig,
): Record<string, unknown> {
  if (memoryCfg.mode === "disabled" || memoryCfg.mode === "remote") {
    return { backend: "builtin" };
  }

  return {
    backend: "qmd",
    qmd: {
      sessions: { enabled: memoryCfg.sessionsEnabled },
      paths: [
        { name: "docs", path: "/home/node/.openclaw/data", pattern: "**/*.md" },
      ],
      // QMD's 300M GGUF embedding model runs on llama.cpp/CPU inside the
      // container. A single cycle across ~15 session docs routinely takes
      // 5+ minutes, but OpenClaw's default cadence is "interval every
      // ~minute, kill at 120 s, log a failure, back off exponentially",
      // which floods the logs with `qmd embed timed out after 120000ms`
      // warnings AND never lets an embed complete. The update block below
      // is the fix:
      //   - embedInterval: "0" disables the interval loop entirely; embeds
      //     only happen on demand (nightly dream sweep, boot-time sync,
      //     manual `qmd update`).
      //   - embedTimeoutMs: 1_800_000 (30 min) gives on-demand cycles room
      //     to finish on CPU-only hosts.
      //   - updateTimeoutMs: 600_000 matches — `qmd update` also re-embeds
      //     when docs change and must tolerate the same cold-start cost.
      update: {
        embedInterval: "0",
        embedTimeoutMs: 1_800_000,
        updateTimeoutMs: 600_000,
      },
    },
  };
}

/**
 * Normalize a possibly-undefined user-supplied memory config into a complete
 * object that downstream code can read without nullish checks. Exported so
 * the test suite can pin down each mode's effective shape.
 */
export function resolveMemoryConfig(
  input: WorkspaceMemoryConfig | undefined,
): ResolvedMemoryConfig {
  if (!input) return DEFAULT_MEMORY_CONFIG;

  if (input.mode === "disabled") {
    return {
      mode: "disabled",
      sessionsEnabled: input.sessionsEnabled,
      dreamingEnabled: false,
      vectorWeight: 0,
      textWeight: 1,
    };
  }

  if (input.mode === "remote") {
    return {
      mode: "remote",
      sessionsEnabled: input.sessionsEnabled,
      dreamingEnabled: input.dreamingEnabled,
      vectorWeight: input.vectorWeight,
      textWeight: input.textWeight,
      provider: input.provider,
      model: input.model,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      headers: input.headers,
    };
  }

  return {
    mode: "local",
    sessionsEnabled: input.sessionsEnabled,
    dreamingEnabled: input.dreamingEnabled,
    vectorWeight: input.vectorWeight,
    textWeight: input.textWeight,
  };
}

export function buildOpenclawJson(
  workspaceId: string,
  token: string,
  userConfig: WorkspaceUserConfig,
  opcifyApiKey?: string,
  providers?: AIProviderConfig[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    gateway: {
      port: 18790,
      mode: "local",
      bind: "loopback",
      auth: {
        mode: "token",
        token,
      },
      controlUi: {
        enabled: true,
        allowedOrigins: ["*"],
        allowInsecureAuth: true,
      },
    },
  };

  // Note: OpenClaw does not support a top-level "model" key in openclaw.json.
  // Models are configured per-agent via the agents.list[].model field instead.

  if (userConfig.browser?.enabled !== false) {
    // Browser config — Chromium is installed locally in the gateway via Playwright.
    // PLAYWRIGHT_BROWSERS_PATH is baked into the container image via
    // docker/Dockerfile.openclaw, so no runtime override is needed here.
    config.browser = {
      enabled: true,
      headless: userConfig.browser?.headless ?? true,
      noSandbox: true,
      defaultProfile: "browser-use",
    };
  }

  // Only set tools.deny if explicitly configured. Do NOT set tools.allow
  // because an allowlist blocks all unlisted tools including sessions_spawn
  // which is needed for multi-agent orchestration.
  if (userConfig.tools?.deny?.length) {
    config.tools = { deny: userConfig.tools.deny };
  }

  // Grant full exec permissions so skills can run scripts without sandbox
  // restrictions (required for OpenClaw 4.5+ which defaults to restricted exec).
  config.tools = {
    ...((config.tools as Record<string, unknown>) ?? {}),
    exec: {
      security: "full",
      ask: "off",
    },
    sessions: {
      visibility: "all",
    },
  };

  // Pre-configure opcify skill as enabled for all workspaces.
  const opcifyUrl = getOpcifyCallbackUrl();
  const resolvedApiKey = opcifyApiKey || process.env.OPCIFY_CALLBACK_TOKEN;
  const skillEntries: Record<string, Record<string, unknown>> = {
    opcify: {
      enabled: true,
      env: {
        OPCIFY_API_URL: opcifyUrl,
        OPCIFY_WORKSPACE_ID: workspaceId,
        ...(resolvedApiKey ? { OPCIFY_API_KEY: resolvedApiKey } : {}),
      },
    },
  };
  // skill-creator is always enabled for all agents
  skillEntries["skill-creator"] = { enabled: true };

  // browser-use skill is installed from ClawHub during container provisioning;
  // register it in the config so it appears in agents.defaults.skills and each
  // agent's skills list.
  if (userConfig.browser?.enabled !== false) {
    skillEntries["browser-use"] = { enabled: true };
  }

  // Enable user-selected Opcify managed skills
  const selectedManaged = userConfig.managedSkillKeys ?? [];
  for (const sk of selectedManaged) {
    if (sk !== "opcify" && isManagedSkill(sk)) {
      skillEntries[sk] = { enabled: true };
    }
  }

  // Pre-register ClawHub skills declared in the workspace template's `skills:`
  // array (e.g. "web-search"). The actual skill files are downloaded later by
  // installSkillBySlug → `openclaw skills install <slug>`, but registering the
  // entry here means it lands in agents.defaults.skills + every agents.list[].skills
  // from the very first openclaw.json write — bypassing the gateway's anomaly
  // detector that otherwise reverts late-stage agents-only writes.
  const clawHubSkills = userConfig.clawHubSkillKeys ?? [];
  for (const sk of clawHubSkills) {
    if (sk !== "opcify" && !isManagedSkill(sk) && !skillEntries[sk]) {
      skillEntries[sk] = { enabled: true };
    }
  }
  // Inject cloud storage credentials into the corresponding skill env
  const gcsEnv: Record<string, string> = {};
  if (userConfig.env?.GCS_BUCKET_NAME) gcsEnv.GCS_BUCKET_NAME = userConfig.env.GCS_BUCKET_NAME;
  if (userConfig.env?.GCS_CREDENTIALS_JSON) gcsEnv.GCS_CREDENTIALS_JSON = userConfig.env.GCS_CREDENTIALS_JSON;
  if (Object.keys(gcsEnv).length > 0) {
    skillEntries["google-cloud-storage"] = {
      ...skillEntries["google-cloud-storage"],
      enabled: true,
      env: gcsEnv,
    };
  }

  const s3Env: Record<string, string> = {};
  if (userConfig.env?.S3_BUCKET_NAME) s3Env.S3_BUCKET_NAME = userConfig.env.S3_BUCKET_NAME;
  if (userConfig.env?.AWS_ACCESS_KEY_ID) s3Env.AWS_ACCESS_KEY_ID = userConfig.env.AWS_ACCESS_KEY_ID;
  if (userConfig.env?.AWS_SECRET_ACCESS_KEY) s3Env.AWS_SECRET_ACCESS_KEY = userConfig.env.AWS_SECRET_ACCESS_KEY;
  if (userConfig.env?.AWS_REGION) s3Env.AWS_REGION = userConfig.env.AWS_REGION;
  if (userConfig.env?.S3_PREFIX) s3Env.S3_PREFIX = userConfig.env.S3_PREFIX;
  if (Object.keys(s3Env).length > 0) {
    skillEntries["amazon-s3-storage"] = {
      ...skillEntries["amazon-s3-storage"],
      enabled: true,
      env: s3Env,
    };
  }

  const r2Env: Record<string, string> = {};
  if (userConfig.env?.R2_BUCKET_NAME) r2Env.R2_BUCKET_NAME = userConfig.env.R2_BUCKET_NAME;
  if (userConfig.env?.R2_ACCOUNT_ID) r2Env.R2_ACCOUNT_ID = userConfig.env.R2_ACCOUNT_ID;
  if (userConfig.env?.R2_ACCESS_KEY_ID) r2Env.R2_ACCESS_KEY_ID = userConfig.env.R2_ACCESS_KEY_ID;
  if (userConfig.env?.R2_SECRET_ACCESS_KEY) r2Env.R2_SECRET_ACCESS_KEY = userConfig.env.R2_SECRET_ACCESS_KEY;
  if (userConfig.env?.R2_PREFIX) r2Env.R2_PREFIX = userConfig.env.R2_PREFIX;
  if (userConfig.env?.R2_PUBLIC_DOMAIN) r2Env.R2_PUBLIC_DOMAIN = userConfig.env.R2_PUBLIC_DOMAIN;
  if (Object.keys(r2Env).length > 0) {
    skillEntries["cloudflare-r2-storage"] = {
      ...skillEntries["cloudflare-r2-storage"],
      enabled: true,
      env: r2Env,
    };
  }

  // Load skills from the workspace-level skills directory
  config.skills = {
    entries: skillEntries,
    load: {
      extraDirs: ["~/.openclaw/skills"],
      watch: true,
      watchDebounceMs: 250,
    },
  };

  // Collect all enabled skill slugs for agents.defaults.skills
  const defaultSkillSlugs = Object.keys(skillEntries).filter(
    (k) => (skillEntries[k] as Record<string, unknown>).enabled !== false,
  );

  const memoryCfg = resolveMemoryConfig(userConfig.memory);
  const memorySearch = buildMemorySearchBlock(memoryCfg);

  config.agents = {
    defaults: {
      ...(userConfig.model ? { model: openclawModelId(userConfig.model, providers) } : {}),
      timeoutSeconds: 6000,
      skills: defaultSkillSlugs,
      subagents: {
        maxConcurrent: 20,
        maxSpawnDepth: 5,
        maxChildrenPerAgent: 10,
        runTimeoutSeconds: 36000,
      },
      memorySearch,
      userTimezone: userConfig.timezone ?? "UTC",
    },
  };

  // Register custom OpenAI-compatible providers so OpenClaw can route
  // `<custom-id>/<model>` agent refs to the user's own endpoint (e.g. an
  // NVIDIA or Together proxy that the user wired up via the wizard).
  const modelsSection = buildCustomProvidersSection(providers);
  if (modelsSection) {
    config.models = modelsSection;
  }

  config.hooks = {
    internal: {
      enabled: true,
      entries: {
        "session-memory": { enabled: true },
        "command-logger": { enabled: true },
      },
    },
  };

  // Memory backend: delegated to `buildMemoryBackendBlock` so the
  // disabled-mode "switch to builtin backend" branch lives next to the
  // local/remote "use QMD" branch and both are individually testable.
  config.memory = buildMemoryBackendBlock(memoryCfg);

  config.cron = {
    enabled: true,
    store: "~/.openclaw/cron/cron.json",
    maxConcurrentRuns: 3,
    sessionRetention: "24h",
    runLog: {
      maxBytes: "2mb",
      keepLines: 2000,
    },
  };

  config.plugins = {
    entries: {
      browser: { enabled: false },
      "memory-core": {
        config: {
          dreaming: {
            enabled: memoryCfg.dreamingEnabled,
            frequency: "0 3 * * *",
          },
        },
      },
    },
  };

  config.meta = {
    lastTouchedVersion: "2026.4.5",
    lastTouchedAt: new Date().toISOString(),
  };

  return config;
}

// ─── Disk persistence ───────────────────────────────────────────────

export async function writeWorkspaceToDisk(
  workspaceId: string,
  token: string,
  userConfig: WorkspaceUserConfig,
  /** Docker-only: omitted in K8s mode since there's no host port to allocate. */
  gatewayPort: number | undefined,
): Promise<void> {
  const dataDir = getDataDir(workspaceId);
  log.info(`Creating workspace data directory: ${dataDir}`);
  await mkdir(dataDir, { recursive: true });

  // Ensure the persistent data directory exists at provisioning time so
  // `/home/node/.openclaw/data` is writable inside the container from the
  // very first task dispatch (this is where agent outputs, chat uploads,
  // email attachments, task folders, archives, and QMD docs all land).
  // Previously this was created lazily at container-create time; moving
  // it here means it's also refreshed on any workspace rebuild.
  await mkdir(join(dataDir, "data"), { recursive: true });

  // Read the existing meta file (if any) BEFORE we overwrite it so we can
  // preserve state that must survive a rebuild:
  //   - opcifyApiKey: rotating this would desync the running gateway
  //     container (whose OPCIFY_API_KEY env var is baked at docker-run time
  //     and used by every agent's ad-hoc `curl` call back to the Opcify API).
  //   - gmail: the user's linked inbox config, same reason as before.
  let existingMeta: WorkspaceMeta | undefined;
  try {
    const rawMeta = await readFile(join(dataDir, "opcify-meta.json"), "utf-8");
    existingMeta = JSON.parse(rawMeta) as WorkspaceMeta;
  } catch {
    // No existing meta — first creation for this workspace.
  }

  // Per-workspace API key for the opcify skill callback auth. Reuse the
  // existing one whenever possible so it stays stable across any re-provision
  // path (reseed, template re-apply, backup restore, etc.). The only time a
  // fresh key is generated is on the very first write for this workspace.
  const opcifyApiKey = existingMeta?.opcifyApiKey ?? generateToken();

  // Load the workspace's configured AI providers so buildOpenclawJson can
  // resolve custom models to their correct provider namespace (e.g. a
  // Google-scoped "gemma-4-31B-it" becomes "google/gemma-4-31B-it" instead
  // of falling through to the "openai/" default).
  const providers = await loadWorkspaceProviders(workspaceId);

  // Build the base config, then merge with any existing config (preserves
  // agents.list written by syncAgentToWorkspace during provisioning).
  const baseConfig = buildOpenclawJson(workspaceId, token, userConfig, opcifyApiKey, providers);
  const existingConfig = await readOpenClawConfig(workspaceId);
  // Deep-merge agents: preserve agents.list from provisioner while keeping
  // agents.defaults from buildOpenclawJson
  const baseAgents = (baseConfig.agents ?? {}) as Record<string, unknown>;
  const existingAgents = (existingConfig.agents ?? {}) as Record<string, unknown>;
  const mergedAgents = { ...baseAgents, ...existingAgents };

  // agents.list[].skills is the explicit final skill set — it does NOT merge
  // with agents.defaults. Ensure every agent has all default skills, since
  // syncAgentToWorkspace may have run before defaults.skills was populated.
  const defaultSkills = ((baseAgents.defaults as Record<string, unknown>)?.skills as string[]) ?? [];
  const agentList = (mergedAgents.list ?? []) as Array<Record<string, unknown>>;
  for (const entry of agentList) {
    const existing = (entry.skills as string[]) ?? [];
    entry.skills = [...new Set([...defaultSkills, ...existing])];
  }
  // Preserve defaults from base config (existing may have overwritten it)
  mergedAgents.defaults = baseAgents.defaults;

  const mergedConfig = {
    ...baseConfig,
    agents: mergedAgents,
  };
  await writeFile(
    join(dataDir, "openclaw.json"),
    JSON.stringify(mergedConfig, null, 2),
    "utf-8",
  );

  // Write exec-approvals.json to grant full exec permissions in the sandbox
  // (required for OpenClaw 4.5+ which defaults to restricted exec).
  const execApprovals = {
    version: 1,
    defaults: {
      security: "full",
      ask: "off",
    },
    agents: {},
  };
  await writeFile(
    join(dataDir, "exec-approvals.json"),
    JSON.stringify(execApprovals, null, 2),
    "utf-8",
  );

  // Seed the OpenClaw cron store. The gateway expects this file at
  // `~/.openclaw/cron/cron.json` (in-container path) to persist scheduled
  // job state. Only create when missing so we never clobber a running
  // gateway's job log on workspace rebuild.
  const cronDir = join(dataDir, "cron");
  await mkdir(cronDir, { recursive: true });
  const cronFile = join(cronDir, "cron.json");
  try {
    await stat(cronFile);
  } catch {
    await writeFile(cronFile, JSON.stringify({ jobs: [] }, null, 2) + "\n", "utf-8");
  }

  const meta: WorkspaceMeta = { token, userConfig, gatewayPort, opcifyApiKey };
  if (existingMeta?.gmail) {
    meta.gmail = existingMeta.gmail;
  }
  await writeFile(
    join(dataDir, "opcify-meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );

  // Regenerate himalaya Gmail config if connected
  if (meta.gmail) {
    const { writeGmailConfigToDisk } = await import("../modules/auth/gmail-service.js");
    await writeGmailConfigToDisk(workspaceId, meta.gmail.email, meta.gmail.refreshToken);
  }

  // Copy Opcify-managed skills (full directory trees) into the workspace skills
  // directory so they're available inside the Docker container at
  // /home/node/.openclaw/skills/<skillName>/. Always-on skills (declared via
  // _meta.json `managed.alwaysOn`) are unioned with whatever the user selected.
  const alwaysOn = getAlwaysOnManagedSkillKeys();
  const selectedSkills = new Set([
    ...alwaysOn,
    ...(userConfig.managedSkillKeys ?? []).filter((sk) => isManagedSkill(sk)),
  ]);
  const skillsSrcDir = getSkillsSourceDir();
  for (const skillName of selectedSkills) {
    const srcDir = join(skillsSrcDir, skillName);
    const destDir = join(dataDir, "skills", skillName);
    try {
      await cp(srcDir, destDir, { recursive: true });
      // Refresh _meta.json so `openclaw skills list` recognises the skill, but
      // preserve the source `managed` block so the loader can still classify it
      // if it ever scans a workspace data dir directly.
      let sourceMeta: Record<string, unknown> = {};
      try {
        sourceMeta = JSON.parse(await readFile(join(srcDir, "_meta.json"), "utf-8"));
      } catch {
        // No source _meta.json — start from a blank slate
      }
      const skillMeta = {
        ...sourceMeta,
        ownerId: "opcify-managed",
        slug: skillName,
        version: (sourceMeta.version as string) || "1.0.0",
        publishedAt: Date.now(),
      };
      await writeFile(
        join(destDir, "_meta.json"),
        JSON.stringify(skillMeta, null, 2),
        "utf-8",
      );
      log.info(`Copied managed skill "${skillName}" to workspace`);
    } catch (err) {
      log.warn(`Could not copy skill "${skillName}" to workspace — tried: ${srcDir}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Sweep every existing agent directory to (a) ensure the OpenClaw-required
  // `memory/` subdir exists and (b) write AI provider API keys when the
  // workspace has any configured. The memory mkdir runs unconditionally so
  // the "memory directory missing" gateway warning is fixed retroactively
  // for workspaces provisioned before this feature landed.
  try {
    let authContent: string | undefined;
    let providerCount = 0;
    const { prisma } = await import("../db.js");
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (ws?.settingsJson) {
      const settings = JSON.parse(ws.settingsJson) as { providers?: Array<{ id: string; apiKey: string }> };
      const providers = (settings.providers ?? []).filter((p) => p.apiKey);
      if (providers.length > 0) {
        const profiles: Record<string, { type: string; key: string; provider: string }> = {};
        for (const p of providers) {
          profiles[`${p.id}:default`] = { type: "api_key", key: p.apiKey, provider: p.id };
        }
        authContent = JSON.stringify({ profiles }, null, 2);
        providerCount = providers.length;
      }
    }

    const agentsDir = join(dataDir, "agents");
    try {
      const entries = await readdir(agentsDir);
      for (const entry of entries) {
        const agentDir = join(agentsDir, entry, "agent");
        try {
          await stat(agentDir);
          // Always: ensure memory dir exists for OpenClaw QMD memory backend.
          await mkdir(join(agentDir, "memory"), { recursive: true });
          // Conditional: write auth-profiles.json when providers are configured.
          if (authContent) {
            // Config dir (legacy location)
            await writeFile(join(agentDir, "auth-profiles.json"), authContent, "utf-8");
            // Working dir — OpenClaw resolves auth at `{agentDir}/auth-profiles.json`
            // where agentDir is `agent/workspace/`. Write here too so it's found.
            const workingDir = join(agentDir, "workspace");
            await mkdir(workingDir, { recursive: true });
            await writeFile(join(workingDir, "auth-profiles.json"), authContent, "utf-8");
          }
        } catch { /* not a valid agent dir */ }
      }
      if (authContent) {
        log.info("Wrote auth-profiles.json to agent directories", { providerCount });
      }
    } catch { /* agents dir may not exist yet */ }
  } catch (err) {
    log.warn("Could not sweep agent directories during disk setup", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Set ownership to uid 1000 (node user inside containers)
  try {
    await chown(dataDir, 1000, 1000);
  } catch {
    log.warn(
      `Could not chown ${dataDir} to 1000:1000 — may need root privileges`,
    );
  }
}

// ─── Disk loading ───────────────────────────────────────────────────

export type WorkspaceMeta = {
  token: string;
  userConfig: WorkspaceUserConfig;
  gatewayPort?: number;
  opcifyApiKey?: string;
  gmail?: {
    email: string;
    refreshToken: string;
    connectedAt: string;
  };
};

export async function loadWorkspaceFromDisk(
  workspaceId: string,
): Promise<WorkspaceMeta | null> {
  try {
    const metaPath = join(getDataDir(workspaceId), "opcify-meta.json");
    const raw = await readFile(metaPath, "utf-8");
    return JSON.parse(raw) as WorkspaceMeta;
  } catch {
    log.warn(
      `Could not load workspace meta from disk for ${workspaceId}`,
    );
    return null;
  }
}

// ─── OpenClaw config (openclaw.json) helpers ─────────────────────────

export type OpenClawConfig = Record<string, unknown>;

export function openclawConfigPath(workspaceId: string): string {
  return join(getDataDir(workspaceId), "openclaw.json");
}

export async function readOpenClawConfig(workspaceId: string): Promise<OpenClawConfig> {
  try {
    const raw = await readFile(openclawConfigPath(workspaceId), "utf-8");
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return {};
  }
}

/**
 * Ensure openclaw.json contains the top-level fields the OpenClaw gateway's
 * "last good" anomaly detector compares against on every reload.
 *
 * Without this, the gateway sees our partial writes (e.g. from toggleSkill)
 * as missing `meta` / `gateway.mode` and self-heals by reverting the file to
 * its in-memory last-good copy — silently dropping our agents.list[].skills
 * and agents.defaults.skills mutations. Symptoms in the gateway log:
 *
 *   Config observe anomaly: ... (missing-meta-vs-last-good, gateway-mode-missing-vs-last-good)
 *   Config overwrite: openclaw.json (sha256 X -> Y, backup=...)
 *
 * Refreshing `meta.lastTouchedAt` on every write also signals to the gateway
 * that this is a deliberate Opcify update, not a corruption.
 */
function ensureGatewayRequiredFields(config: OpenClawConfig): void {
  // Top-level meta — gateway expects lastTouchedVersion + lastTouchedAt
  const meta = (config.meta as Record<string, unknown> | undefined) ?? {};
  if (!meta.lastTouchedVersion) {
    meta.lastTouchedVersion = "2026.4.5";
  }
  meta.lastTouchedAt = new Date().toISOString();
  config.meta = meta;

  // gateway.mode — gateway expects this to be set; default to "local"
  const gw = (config.gateway as Record<string, unknown> | undefined) ?? {};
  if (!gw.mode) {
    gw.mode = "local";
  }
  config.gateway = gw;
}

export async function writeOpenClawConfig(workspaceId: string, config: OpenClawConfig): Promise<void> {
  await mkdir(getDataDir(workspaceId), { recursive: true });
  ensureGatewayRequiredFields(config);
  await writeFile(
    openclawConfigPath(workspaceId),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Patch `skills.entries.opcify.env.OPCIFY_API_KEY` in an existing openclaw.json
 * so the gateway's opcify skill invocations see a fresh value without a full
 * workspace rebuild. Used by:
 *
 *   1. The POST /workspaces/:id/api-key/regenerate admin endpoint.
 *   2. `syncOpcifyApiKey()` in WorkspaceService, which realigns the on-disk
 *      meta + openclaw.json with whatever the running container's env var
 *      already has (so a dev-server restart that regenerated the disk token
 *      heals itself instead of leaving the agents stranded).
 *
 * Note: this does NOT update the container env var (docker doesn't allow
 * that on a running container). The container env var is only used by
 * ad-hoc bash `curl` commands agents run, which is why the self-heal path
 * in WorkspaceService prefers to pull the container's value back into disk,
 * not the other way around.
 */
export async function patchOpcifyApiKeyInOpenclawJson(
  workspaceId: string,
  newKey: string,
): Promise<void> {
  const config = await readOpenClawConfig(workspaceId);
  const skills = (config.skills as Record<string, unknown> | undefined) ?? {};
  const entries = (skills.entries as Record<string, Record<string, unknown>> | undefined) ?? {};
  const opcifyEntry = (entries.opcify as Record<string, unknown> | undefined) ?? {};
  const env = (opcifyEntry.env as Record<string, string> | undefined) ?? {};
  env.OPCIFY_API_KEY = newKey;
  opcifyEntry.env = env;
  entries.opcify = opcifyEntry;
  skills.entries = entries;
  config.skills = skills;
  await writeOpenClawConfig(workspaceId, config);
}

/**
 * Rewrite opcify-meta.json with a new opcifyApiKey while preserving every
 * other field. Used by `syncOpcifyApiKey()` when the on-disk token has
 * drifted away from the value the running gateway container was started
 * with — the container wins, so we update disk to match.
 */
export async function writeOpcifyApiKeyToDisk(
  workspaceId: string,
  newKey: string,
): Promise<void> {
  const metaPath = join(getDataDir(workspaceId), "opcify-meta.json");
  const raw = await readFile(metaPath, "utf-8");
  const meta = JSON.parse(raw) as WorkspaceMeta;
  meta.opcifyApiKey = newKey;
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

/**
 * Rewrite the `models.providers` section of an existing openclaw.json to
 * match the workspace's current custom AI providers (those with a baseUrl).
 * Called from the PATCH /workspaces/:id route when `settingsJson` changes,
 * so a user can add/remove a custom endpoint after initial provisioning
 * without re-running the full `writeWorkspaceToDisk` pipeline.
 */
export async function syncCustomProvidersToOpenclawJson(
  workspaceId: string,
): Promise<void> {
  const providers = await loadWorkspaceProviders(workspaceId);
  const modelsSection = buildCustomProvidersSection(providers);
  const config = await readOpenClawConfig(workspaceId);
  if (modelsSection) {
    (config as Record<string, unknown>).models = modelsSection;
  } else {
    delete (config as Record<string, unknown>).models;
  }
  await writeOpenClawConfig(workspaceId, config);
}

/**
 * Push a new IANA timezone to an already-provisioned workspace. Rewrites
 * `userConfig.timezone` in `opcify-meta.json` AND `agents.defaults.userTimezone`
 * in `openclaw.json`, so a user changing their profile timezone in the Opcify
 * UI propagates to the OpenClaw gateway without requiring a full re-provision.
 *
 * The container's `TZ` env var is only refreshed on the next ensureContainers
 * cycle — existing gateways keep the zone they were created with until
 * restart.
 */
export async function syncUserTimezoneToWorkspace(
  workspaceId: string,
  timezone: string,
): Promise<void> {
  const dataDir = getDataDir(workspaceId);

  // 1. opcify-meta.json — authoritative userConfig store on disk.
  try {
    const metaPath = join(dataDir, "opcify-meta.json");
    const raw = await readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw) as WorkspaceMeta;
    meta.userConfig = { ...meta.userConfig, timezone };
    await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // Workspace not yet provisioned to disk — nothing to update.
    return;
  }

  // 2. openclaw.json — agents.defaults.userTimezone is what every agent
  //    inherits at runtime via buildOpenclawJson.
  const config = await readOpenClawConfig(workspaceId);
  const agents = (config.agents as Record<string, unknown> | undefined) ?? {};
  const defaults = (agents.defaults as Record<string, unknown> | undefined) ?? {};
  defaults.userTimezone = timezone;
  agents.defaults = defaults;
  config.agents = agents;
  await writeOpenClawConfig(workspaceId, config);
}

/**
 * Fan `syncUserTimezoneToWorkspace` out across every workspace owned by
 * `userId`. Called from the auth service after a profile update so the
 * timezone stays consistent between the User table and every provisioned
 * workspace's openclaw.json. Failures are logged and swallowed per-workspace
 * so one bad workspace never blocks the profile update response.
 */
export async function propagateUserTimezoneToAllWorkspaces(
  userId: string,
  timezone: string,
): Promise<void> {
  const { prisma } = await import("../db.js");
  const workspaces = await prisma.workspace.findMany({
    where: { userId },
    select: { id: true },
  });
  for (const ws of workspaces) {
    try {
      await syncUserTimezoneToWorkspace(ws.id, timezone);
    } catch (err) {
      log.warn("Failed to propagate timezone to workspace", {
        userId,
        workspaceId: ws.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
