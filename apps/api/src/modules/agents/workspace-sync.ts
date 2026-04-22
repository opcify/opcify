/**
 * Sync agent data from the Opcify DB to the OpenClaw workspace on disk.
 *
 * OpenClaw discovers agents via TWO mechanisms:
 *
 * 1. `openclaw.json` → `agents.list[]` — the gateway reads this to know which
 *    agents exist, their models, names, etc.
 *
 * 2. Agent workspace files — each agent gets a directory at:
 *      {dataDir}/agents/{agentId}/agent/
 *        SOUL.md       (personality & principles)
 *        AGENTS.md     (operational logic & rules)
 *        IDENTITY.md   (display identity)
 *
 *    The gateway resolves this via: resolveAgentDir → {stateDir}/agents/{id}/agent
 *    where stateDir is the bind-mounted workspace root (~/.opcify/workspaces/{id}).
 */
import { mkdir, writeFile, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  getDataDir,
  readOpenClawConfig,
  writeOpenClawConfig,
  type OpenClawConfig,
} from "../../workspace/WorkspaceConfig.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { getProviderForModel } from "@opcify/core";
import type { AIProviderConfig, WorkspaceAISettings } from "@opcify/core";

const log = createLogger("agent-workspace-sync");

export interface AgentData {
  id: string;
  name: string;
  role: string;
  description: string;
  model: string;
  soul?: string | null;
  agentConfig?: string | null;
  identity?: string | null;
  tools?: string | null;
  user?: string | null;
  heartbeat?: string | null;
  bootstrap?: string | null;
  isSystem: boolean;
  status: string;
}

/**
 * Convert an Opcify model ID to the OpenClaw provider/model format.
 * OpenClaw requires "provider/model" (e.g. "openai/gpt-5.4", "anthropic/claude-sonnet-4-20250514").
 *
 * Resolution order:
 *   1. Workspace-configured providers — the source of truth for custom
 *      models the user added under a specific provider.
 *   2. BUILT_IN_PROVIDERS — the source of truth for well-known models
 *      shipped with Opcify (gpt-*, claude-*, gemini-*, etc).
 *
 * If the model isn't found in either, it's returned unchanged. OpenClaw
 * will surface a clear "Unknown model" error at dispatch time — that's
 * better than guessing the wrong provider from the model name.
 */
export function openclawModelId(
  model: string,
  providers?: AIProviderConfig[],
): string {
  if (providers) {
    for (const p of providers) {
      if ((p.models ?? []).some((m) => m.value === model)) {
        // OpenRouter keeps the original "provider/model" namespace as a
        // sub-path (e.g. "openrouter/anthropic/claude-sonnet-4").
        if (p.id === "openrouter") return `openrouter/${model}`;
        return `${p.id}/${model}`;
      }
    }
  }
  const builtIn = getProviderForModel(model);
  if (builtIn) {
    if (builtIn.id === "openrouter") return `openrouter/${model}`;
    return `${builtIn.id}/${model}`;
  }
  log.warn("openclawModelId: unknown model, passing through unchanged", { model });
  return model;
}

/** Load the workspace's configured AI providers from settingsJson. */
async function loadWorkspaceProviders(
  workspaceId: string,
): Promise<AIProviderConfig[] | undefined> {
  try {
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

/** Convert agent name to a slug for use as OpenClaw agent ID (e.g. "Orchestrator" → "orchestrator") */
export function agentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Directory where the agent's workspace files live (SOUL.md, AGENTS.md, etc.) */
function agentWorkspaceDir(workspaceId: string, agentId: string): string {
  return join(getDataDir(workspaceId), "agents", agentId, "agent");
}

// ─── openclaw.json agent helpers ────────────────────────────────

interface AgentEntry {
  id: string;
  name?: string;
  model?: string;
  [key: string]: unknown;
}

function upsertAgentEntry(
  config: OpenClawConfig,
  agent: AgentData,
  providers?: AIProviderConfig[],
): OpenClawConfig {
  // openclaw.json `agents` is `unknown` in our typed view; narrow it once.
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  config.agents = agents;
  const list = ((agents.list as AgentEntry[] | undefined) ?? []) as AgentEntry[];
  agents.list = list;

  const slug = agentSlug(agent.name);

  // Inherit default skills so every agent gets the workspace-level skills
  const defaults = (agents.defaults as Record<string, unknown> | undefined) ?? {};
  const defaultSkills = (defaults.skills as string[] | undefined) ?? [];

  const entry: AgentEntry = {
    id: slug,
    name: agent.name,
    model: openclawModelId(agent.model, providers),
    // Agent config directory (SOUL.md, AGENTS.md, etc.)
    workspace: `~/.openclaw/agents/${slug}/agent`,
    // Agent working directory for task execution
    agentDir: `~/.openclaw/agents/${slug}/agent/workspace`,
    // Allow this agent to spawn sessions with any other agent (for orchestration)
    subagents: { allowAgents: ["*"] },
    // Each agent gets the workspace-level skills; per-agent skills are added later
    skills: [...defaultSkills],
  };

  // Archives Director runs a periodic sweep of unclassified files.
  // Route those heartbeat runs to an isolated session
  // (`agent:archives-director:main:heartbeat`) so they never pollute the main
  // chat session that the Files page and Chat page subscribe to.
  if (slug === "archives-director") {
    entry.heartbeat = {
      every: "15m",
      isolatedSession: true,
      lightContext: true,
    };
  }

  // Match by slug (new format) or by CUID (legacy format)
  const idx = list.findIndex((e: AgentEntry) => e.id === slug || e.id === agent.id);
  if (idx >= 0) {
    // Preserve any per-agent skills that were added after initial provisioning
    const existingSkills = (list[idx].skills as string[] | undefined) ?? [];
    const mergedSkills = [...new Set([...defaultSkills, ...existingSkills])];
    entry.skills = mergedSkills;
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  return config;
}

function removeAgentEntry(config: OpenClawConfig, agentId: string): OpenClawConfig {
  const agents = config.agents as Record<string, unknown> | undefined;
  if (!agents) return config;
  const list = agents.list as AgentEntry[] | undefined;
  if (!list) return config;
  agents.list = list.filter((e: AgentEntry) => e.id !== agentId);
  if ((agents.list as AgentEntry[]).length === 0) {
    delete agents.list;
    if (Object.keys(agents).length === 0) delete config.agents;
  }
  return config;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Write (or overwrite) agent into the OpenClaw workspace.
 * - Adds/updates the agent in openclaw.json agents.list
 * - Writes all core bootstrap files to agents/{id}/agent/
 */
export async function syncAgentToWorkspace(
  workspaceId: string,
  agent: AgentData,
): Promise<void> {
  try {
    // 1. Update openclaw.json — load providers so custom models resolve to
    // the right OpenClaw namespace (e.g. a Google-scoped "gemma-4-31B-it"
    // becomes "google/gemma-4-31B-it" instead of falling through to "openai/").
    const providers = await loadWorkspaceProviders(workspaceId);
    const config = await readOpenClawConfig(workspaceId);
    upsertAgentEntry(config, agent, providers);
    await writeOpenClawConfig(workspaceId, config);

    // 2. Write agent workspace files using slug as directory name
    const slug = agentSlug(agent.name);
    const dir = agentWorkspaceDir(workspaceId, slug);
    await mkdir(dir, { recursive: true });

    // Create the agent working directory (agentDir) for task execution
    const agentWorkDir = join(dir, "workspace");
    await mkdir(agentWorkDir, { recursive: true });

    // Memory dir — OpenClaw reads/writes session memory + QMD snapshots here.
    // Without this, the gateway logs "memory directory missing" for every agent.
    const memoryDir = join(dir, "memory");
    await mkdir(memoryDir, { recursive: true });

    // Create sessions directory so OpenClaw can store session data per agent
    const sessionsDir = join(getDataDir(workspaceId), "agents", slug, "sessions");
    await mkdir(sessionsDir, { recursive: true });

    // Core files from Opcify agent data
    await writeFile(join(dir, "SOUL.md"), agent.soul || defaultSoul(agent));
    await writeFile(join(dir, "AGENTS.md"), agent.agentConfig || defaultAgents(agent));
    await writeFile(join(dir, "IDENTITY.md"), agent.identity || defaultIdentity(agent));

    // Remaining core files — use custom content if provided, otherwise create defaults if missing
    if (agent.user) {
      await writeFile(join(dir, "USER.md"), agent.user);
    } else {
      await writeIfMissing(join(dir, "USER.md"), DEFAULT_USER);
    }
    if (agent.tools) {
      await writeFile(join(dir, "TOOLS.md"), agent.tools);
    } else {
      await writeIfMissing(join(dir, "TOOLS.md"), DEFAULT_TOOLS);
    }
    if (agent.bootstrap) {
      await writeFile(join(dir, "BOOTSTRAP.md"), agent.bootstrap);
    } else {
      await writeIfMissing(join(dir, "BOOTSTRAP.md"), DEFAULT_BOOTSTRAP);
    }
    if (agent.heartbeat) {
      await writeFile(join(dir, "HEARTBEAT.md"), agent.heartbeat);
    } else {
      await writeIfMissing(join(dir, "HEARTBEAT.md"), DEFAULT_HEARTBEAT);
    }
    // MEMORY.md is the agent's persistent long-term notes file. Write the
    // starter template only when missing so we never clobber facts the
    // agent or user has appended over time.
    await writeIfMissing(join(dir, "MEMORY.md"), DEFAULT_MEMORY);

    // 3. Write auth-profiles.json from workspace AI settings
    await syncAuthProfilesToAgent(workspaceId, dir);

    log.info("Synced agent to workspace", { workspaceId, agentId: agent.id });
  } catch (err) {
    log.warn("Failed to sync agent to workspace", {
      workspaceId,
      agentId: agent.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  try {
    await readFile(path);
  } catch {
    await writeFile(path, content);
  }
}

/** Write auth-profiles.json for a single agent directory from workspace AI settings.
 *  OpenClaw resolves auth at `{agentDir}/auth-profiles.json` where the agent's
 *  agentDir is the working directory `{agent}/workspace/`. We write to BOTH the
 *  config dir and the working dir so all OpenClaw lookup paths succeed. */
async function syncAuthProfilesToAgent(workspaceId: string, agentDir: string): Promise<void> {
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { settingsJson: true },
    });
    if (!ws?.settingsJson) return;

    const settings = JSON.parse(ws.settingsJson) as WorkspaceAISettings;
    const profiles: Record<string, { type: string; key: string; provider: string }> = {};
    for (const p of settings.providers ?? []) {
      if (!p.apiKey) continue;
      profiles[`${p.id}:default`] = {
        type: "api_key",
        key: p.apiKey,
        provider: p.id,
      };
    }
    if (Object.keys(profiles).length === 0) return;

    const authContent = JSON.stringify({ profiles }, null, 2);
    // Write to the agent config dir (legacy location)
    await writeFile(join(agentDir, "auth-profiles.json"), authContent, "utf-8");
    // Write to the agent working dir (the agentDir OpenClaw resolves auth from)
    const workingDir = join(agentDir, "workspace");
    await mkdir(workingDir, { recursive: true });
    await writeFile(join(workingDir, "auth-profiles.json"), authContent, "utf-8");
  } catch {
    // Non-fatal — workspace may not have settings yet
  }
}

// ─── Default file content generators ───────────────────────────

function defaultSoul(agent: AgentData): string {
  return `# SOUL.md — ${agent.name}

You are **${agent.name}**, a ${agent.role} agent.

${agent.description || ""}

## Core Principles

- Be concise and action-oriented
- Prioritize accuracy over speed
- Ask for clarification when uncertain
`.trimEnd() + "\n";
}

function defaultAgents(agent: AgentData): string {
  return `# AGENTS.md — ${agent.name}

## Role

${agent.role}

## Session Startup

1. Read \`SOUL.md\` — this is who you are
2. Read \`USER.md\` — this is who you're helping
3. Check memory files for recent context
`.trimEnd() + "\n";
}

function defaultIdentity(agent: AgentData): string {
  return `# IDENTITY.md — ${agent.name}

- **Name:** ${agent.name}
- **Role:** ${agent.role}
`.trimEnd() + "\n";
}

const DEFAULT_USER = `# USER.md

- **Name:**
- **Notes:**
`;

const DEFAULT_TOOLS = `# TOOLS.md

No tool-specific configuration yet.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
`;

const DEFAULT_BOOTSTRAP = `# BOOTSTRAP.md

Bootstrap complete. This agent was provisioned by Opcify.
`;

const DEFAULT_HEARTBEAT = `# HEARTBEAT.md
`;

const DEFAULT_MEMORY = `# MEMORY.md

Persistent long-term memory for this agent. Append facts, decisions, and
learnings here that should survive across sessions. Each entry should be
self-contained — a future you reading it cold needs to understand it
without the original conversation context.

## Facts

## Recent Decisions

## Open Questions
`;

/**
 * Remove an agent from the OpenClaw workspace.
 * - Removes agent from openclaw.json agents.list
 * - Deletes agents/{id}/ directory
 */
export async function removeAgentFromWorkspace(
  workspaceId: string,
  agentId: string,
  agentName?: string,
): Promise<void> {
  try {
    const slug = agentName ? agentSlug(agentName) : agentId;

    // 1. Remove from openclaw.json (match by slug or CUID)
    const config = await readOpenClawConfig(workspaceId);
    removeAgentEntry(config, slug);
    removeAgentEntry(config, agentId); // also try CUID for legacy
    await writeOpenClawConfig(workspaceId, config);

    // 2. Remove agent directory (try slug first, then CUID for legacy)
    const slugRoot = join(getDataDir(workspaceId), "agents", slug);
    await rm(slugRoot, { recursive: true, force: true });
    if (slug !== agentId) {
      const cuidRoot = join(getDataDir(workspaceId), "agents", agentId);
      await rm(cuidRoot, { recursive: true, force: true });
    }

    log.info("Removed agent from workspace", { workspaceId, agentId });
  } catch (err) {
    log.warn("Failed to remove agent from workspace", {
      workspaceId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Write AI provider API keys to auth-profiles.json for all agents in a workspace.
 * OpenClaw reads this file to authenticate with AI providers (OpenAI, Anthropic, etc.).
 *
 * Format: { "profiles": { "<provider>:default": { "type": "api_key", "key": "sk-...", "provider": "<provider>" } } }
 */
export async function syncAuthProfilesToWorkspace(
  workspaceId: string,
  providers: Array<{ id: string; apiKey: string }>,
): Promise<void> {
  if (providers.length === 0) return;

  // Build the auth-profiles.json content
  const profiles: Record<string, { type: string; key: string; provider: string }> = {};
  for (const p of providers) {
    if (!p.apiKey) continue;
    profiles[`${p.id}:default`] = {
      type: "api_key",
      key: p.apiKey,
      provider: p.id,
    };
  }

  if (Object.keys(profiles).length === 0) return;

  const authContent = JSON.stringify({ profiles }, null, 2);

  // Write to every agent directory in this workspace.
  // OpenClaw resolves auth at `{agentDir}/auth-profiles.json` where agentDir is
  // the working dir `agents/{slug}/agent/workspace/`. Write to BOTH the config
  // dir and the working dir so all lookup paths succeed.
  const agentsDir = join(getDataDir(workspaceId), "agents");
  try {
    const entries = await readdir(agentsDir);
    for (const entry of entries) {
      const agentDir = join(agentsDir, entry, "agent");
      try {
        await stat(agentDir);
        // Config dir (legacy location)
        await writeFile(join(agentDir, "auth-profiles.json"), authContent, "utf-8");
        // Working dir (where OpenClaw actually reads it from)
        const workingDir = join(agentDir, "workspace");
        await mkdir(workingDir, { recursive: true });
        await writeFile(join(workingDir, "auth-profiles.json"), authContent, "utf-8");
      } catch {
        // Not a valid agent directory
      }
    }
    log.info("Synced auth profiles to workspace agents", {
      workspaceId,
      providerCount: Object.keys(profiles).length,
    });
  } catch {
    log.warn("Could not sync auth profiles — agents directory may not exist yet", { workspaceId });
  }
}

/**
 * Restart the OpenClaw gateway container so it picks up config changes
 * (e.g. agent model updates in openclaw.json). Runs in the background.
 */
export function restartWorkspaceGateway(workspaceId: string): void {
  Promise.resolve().then(async () => {
    try {
      const { getRuntime } = await import("../../runtime/workspace-runtime.js");
      const { workspaceService } = await import("../../workspace/WorkspaceService.js");
      await getRuntime().stop(workspaceId, 2);
      await workspaceService.ensureContainers(workspaceId);
      log.info("Restarted gateway after agent config change", { workspaceId });
    } catch {
      // Non-critical — gateway will pick up changes on next restart
    }
  });
}
