import { readFile, cp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getExecutor } from "../../runtime/executor.js";
import {
  containerNames,
  readOpenClawConfig,
  writeOpenClawConfig,
  getSkillsSourceDir,
  getDataDir,
  loadManagedSkillRegistry,
  isManagedSkill,
  type ManagedSkillTier,
} from "../../workspace/WorkspaceConfig.js";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { parseSkillFrontmatter } from "../../lib/frontmatter.js";

const log = createLogger("openclaw-capabilities");

// ─── Types ──────────────────────────────────────────────────────────

export interface CommandResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface InstalledSkill {
  slug: string;
  name: string;
  description?: string;
  emoji?: string;
  eligible: boolean;
  disabled: boolean;
  bundled: boolean;
  source?: string;
  homepage?: string;
  missing?: { bins: string[]; env: string[]; config: string[]; os: string[] };
}

// ─── Whitelisted commands ───────────────────────────────────────────

type AllowedCommand =
  | { type: "skills-install"; slug: string }
  | { type: "skills-update-all" }
  | { type: "skills-list" };

// Slug/package name safety: alphanumeric, hyphens, underscores, dots, slashes, @
// Must not contain path traversal (..) or start with -
const SAFE_NAME = /^[@a-zA-Z0-9._/:+-]+$/;
const DANGEROUS_PATTERN = /\.\.|^-/;

function validateCommand(cmd: AllowedCommand): string[] | null {
  switch (cmd.type) {
    case "skills-install":
      if (!SAFE_NAME.test(cmd.slug) || DANGEROUS_PATTERN.test(cmd.slug) || cmd.slug.length > 200) return null;
      return ["openclaw", "skills", "install", cmd.slug];

    case "skills-update-all":
      return ["openclaw", "skills", "update", "--all"];

    case "skills-list":
      return ["openclaw", "skills", "list", "--json"];

    default:
      return null;
  }
}

/**
 * Execute a whitelisted openclaw CLI command inside the workspace gateway container.
 */
export async function runCapabilityCommand(
  workspaceId: string,
  cmd: AllowedCommand,
): Promise<CommandResult> {
  const args = validateCommand(cmd);
  if (!args) {
    const desc = JSON.stringify(cmd);
    log.warn(`Rejected capability command: ${desc}`);
    return {
      success: false,
      command: `openclaw (rejected: ${desc})`,
      stdout: "",
      stderr: "Command not allowed or invalid parameters.",
      exitCode: 1,
    };
  }

  const fullCommand = args.join(" ");
  const names = containerNames(workspaceId);
  log.info(`Running in container ${names.gateway}: ${fullCommand}`);

  try {
    const { stdout, stderr, exitCode } = await getExecutor().exec(workspaceId, args);
    // Historical behavior: on non-zero exit, callers read the combined
    // output from `stderr`. Preserve that by merging stdout+stderr when
    // the command failed.
    const mergedStderr = exitCode !== 0 ? [stderr, stdout].filter(Boolean).join("\n") : stderr;

    return {
      success: exitCode === 0,
      command: fullCommand,
      stdout,
      stderr: mergedStderr,
      exitCode,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Container exec failed for ${names.gateway}: ${msg}`);
    return {
      success: false,
      command: fullCommand,
      stdout: "",
      stderr: `Container exec failed: ${msg}`,
      exitCode: 1,
    };
  }
}

// ─── High-level helpers ─────────────────────────────────────────────

export async function listInstalledSkills(
  workspaceId: string,
): Promise<{ skills: InstalledSkill[]; raw: CommandResult }> {
  let skills: InstalledSkill[];
  let raw: CommandResult;

  // Try WebSocket RPC first (fast), fall back to CLI exec
  try {
    const { chatService } = await import("../chat/service.js");
    const client = await chatService.getClient(workspaceId);
    const result = await client.request<{ skills?: Record<string, unknown>[] }>("skills.status", {});
    const arr = result?.skills ?? [];
    skills = parseSkillsList(arr);
    raw = { success: true, command: "skills.status (RPC)", stdout: "", stderr: "", exitCode: 0 };
  } catch {
    // Fall back to CLI via the runtime executor (docker exec or k8s exec)
    const result = await runCapabilityCommand(workspaceId, { type: "skills-list" });
    if (!result.success) {
      return { skills: [], raw: result };
    }
    raw = result;

    try {
      const parsed = JSON.parse(result.stdout);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.skills) ? parsed.skills : [];
      skills = parseSkillsList(arr);
    } catch {
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      skills = lines.map((line) => ({
        slug: line.trim(),
        name: line.trim(),
        eligible: false,
        disabled: false,
        bundled: false,
      }));
    }
  }

  // Overlay disabled state from openclaw.json — the gateway's skills.status
  // response may not reflect the actual enabled state, so use the config file
  // as the authoritative source. A skill is enabled only if it appears in
  // agents.defaults.skills OR has skills.entries[name].enabled === true.
  try {
    const config = await readOpenClawConfig(workspaceId);
    const agentsCfg = (config.agents ?? {}) as Record<string, unknown>;
    const defaults = (agentsCfg.defaults ?? {}) as Record<string, unknown>;
    const defaultSkills = (defaults.skills as string[] | undefined) ?? [];
    const skillsCfg = (config.skills ?? {}) as Record<string, unknown>;
    const entries = (skillsCfg.entries ?? {}) as Record<string, Record<string, unknown>>;

    for (const skill of skills) {
      const entry = entries[skill.slug] ?? entries[skill.name];
      const inDefaults = defaultSkills.includes(skill.slug) || defaultSkills.includes(skill.name);

      if (entry?.enabled === false || !inDefaults) {
        skill.disabled = true;
      }
    }
  } catch {
    // Config not readable — keep gateway-reported state as-is
  }

  return { skills, raw };
}

function parseSkillsList(arr: Record<string, unknown>[]): InstalledSkill[] {
  const missing = (m: Record<string, unknown> | undefined) =>
    m ? { bins: arr_(m.bins), env: arr_(m.env), config: arr_(m.config), os: arr_(m.os) } : undefined;
  const arr_ = (v: unknown) => (Array.isArray(v) ? v as string[] : []);

  return arr.map((s) => ({
    slug: (s.slug || s.key || s.name || "unknown") as string,
    name: (s.name || s.slug || s.key || "unknown") as string,
    description: (s.description as string) || undefined,
    emoji: (s.emoji as string) || undefined,
    eligible: s.eligible === true,
    disabled: s.disabled === true,
    bundled: s.bundled === true,
    source: (s.source as string) || undefined,
    homepage: (s.homepage as string) || undefined,
    missing: missing(s.missing as Record<string, unknown> | undefined),
  }));
}

export async function installSkillBySlug(workspaceId: string, slug: string, agentIds?: string[]): Promise<CommandResult> {
  // Use the CLI via the runtime executor — the WebSocket RPC skills.install
  // schema is strict and version-dependent, so the CLI is more reliable.
  const result = await runCapabilityCommand(workspaceId, { type: "skills-install", slug });

  // All skills are installed to ~/.openclaw/skills/ (workspace-global).
  // openclaw.json controls which agents see which skills via agents.defaults.skills
  // and agents.list[].skills.
  if (result.success) {
    await copySkillToGlobal(workspaceId, slug);

    const skillName = slug.includes("/") ? slug.split("/").pop()! : slug;
    const skill = await prisma.skill.upsert({
      where: { key: skillName },
      update: {},
      create: { key: skillName, name: skillName },
    });

    if (agentIds && agentIds.length > 0) {
      // Per-agent skill: add to specific agents' skills lists in openclaw.json only
      const agents = await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true },
      });
      for (const agent of agents) {
        await prisma.agentSkill.upsert({
          where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
          update: {},
          create: { agentId: agent.id, skillId: skill.id },
        });
      }
      // Add skill slug to each agent's agents.list[].skills in openclaw.json
      await addSkillToAgents(workspaceId, skillName, agents.map((a) => a.name));
    } else {
      // Workspace-global skill: add to agents.defaults.skills in openclaw.json
      const wsAgents = await prisma.agent.findMany({
        where: { workspaceId, deletedAt: null },
        select: { id: true },
      });
      for (const agent of wsAgents) {
        await prisma.agentSkill.upsert({
          where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
          update: {},
          create: { agentId: agent.id, skillId: skill.id },
        });
      }
      // Add skill slug to agents.defaults.skills and all agents.list[].skills
      await addSkillToDefaults(workspaceId, skillName);
    }
  }

  return result;
}

/**
 * Copy a skill from agent-level install location to the global skills dir
 * so it's available to all agents, not just the default (orchestrator).
 */
async function copySkillToGlobal(workspaceId: string, slug: string): Promise<void> {
  // Sanitize slug for use in path (e.g. "@org/skill" → "skill")
  const skillName = slug.includes("/") ? slug.split("/").pop()! : slug;
  try {
    await getExecutor().exec(workspaceId, [
      "sh",
      "-c",
      `mkdir -p /home/node/.openclaw/skills/${skillName} && ` +
        `for d in /home/node/.openclaw/agents/*/agent/skills/${skillName}; do ` +
        `  [ -d "$d" ] && cp -r "$d"/* /home/node/.openclaw/skills/${skillName}/ 2>/dev/null && break; ` +
        `done; echo ok`,
    ]);
    log.info(`Copied skill "${slug}" to global skills dir for workspace "${workspaceId}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to copy skill "${slug}" to global dir: ${msg}`);
  }
}

/**
 * Add a skill slug to agents.defaults.skills and all agents.list[].skills in openclaw.json.
 * Used when installing a workspace-global skill.
 */
async function addSkillToDefaults(workspaceId: string, skillName: string): Promise<void> {
  try {
    const config = await readOpenClawConfig(workspaceId);
    // openclaw.json `agents` is `unknown` in our typed view; narrow it once.
    const agents = ((config.agents ?? {}) as Record<string, unknown>);
    config.agents = agents;
    const defaults = ((agents.defaults ?? {}) as Record<string, unknown>);
    agents.defaults = defaults;

    // Add to defaults.skills
    const defaultSkills = (defaults.skills as string[] | undefined) ?? [];
    if (!defaultSkills.includes(skillName)) {
      defaultSkills.push(skillName);
      defaults.skills = defaultSkills;
    }

    // Also add to every agents.list[].skills
    const list = ((agents.list as Array<Record<string, unknown>> | undefined) ?? []);
    for (const entry of list) {
      const agentSkills = (entry.skills as string[] | undefined) ?? [];
      if (!agentSkills.includes(skillName)) {
        agentSkills.push(skillName);
        entry.skills = agentSkills;
      }
    }

    await writeOpenClawConfig(workspaceId, config);
    log.info(`Added skill "${skillName}" to agents.defaults.skills for workspace "${workspaceId}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to add skill "${skillName}" to defaults: ${msg}`);
  }
}

/**
 * Add a skill slug to specific agents' agents.list[].skills in openclaw.json.
 * Used when installing a per-agent skill (does NOT add to agents.defaults.skills).
 */
async function addSkillToAgents(workspaceId: string, skillName: string, agentNames: string[]): Promise<void> {
  try {
    const { agentSlug } = await import("../agents/workspace-sync.js");
    const config = await readOpenClawConfig(workspaceId);
    const agents = (config.agents ?? {}) as Record<string, unknown>;
    const list = (agents.list as Array<Record<string, unknown>> | undefined) ?? [];
    const slugs = new Set(agentNames.map((n) => agentSlug(n)));

    for (const entry of list) {
      if (slugs.has(entry.id as string)) {
        const agentSkills = (entry.skills as string[]) ?? [];
        if (!agentSkills.includes(skillName)) {
          agentSkills.push(skillName);
          entry.skills = agentSkills;
        }
      }
    }

    await writeOpenClawConfig(workspaceId, config);
    log.info(`Added skill "${skillName}" to agents [${agentNames.join(", ")}] for workspace "${workspaceId}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to add skill "${skillName}" to agents: ${msg}`);
  }
}

export async function uninstallSkillBySlug(workspaceId: string, slug: string): Promise<CommandResult> {
  const skillName = slug.includes("/") ? slug.split("/").pop()! : slug;
  if (!SAFE_NAME.test(skillName) || DANGEROUS_PATTERN.test(skillName)) {
    return { success: false, command: `uninstall ${slug}`, stdout: "", stderr: "Invalid skill name", exitCode: 1 };
  }

  try {
    // Remove from global skills dir only (all skills live in ~/.openclaw/skills/)
    const { stdout } = await getExecutor().exec(workspaceId, [
      "sh",
      "-c",
      `rm -rf /home/node/.openclaw/skills/${skillName}; echo ok`,
    ]);

    // Remove skill from agents.defaults.skills and all agents.list[].skills
    await removeSkillFromConfig(workspaceId, skillName);

    log.info(`Uninstalled skill "${slug}" from workspace "${workspaceId}"`);
    return { success: true, command: `uninstall ${slug}`, stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to uninstall skill "${slug}": ${msg}`);
    return { success: false, command: `uninstall ${slug}`, stdout: "", stderr: msg, exitCode: 1 };
  }
}

/**
 * Remove a skill slug from agents.defaults.skills and all agents.list[].skills in openclaw.json.
 */
async function removeSkillFromConfig(workspaceId: string, skillName: string): Promise<void> {
  try {
    const config = await readOpenClawConfig(workspaceId);
    if (!config.agents) return;
    const agents = config.agents as Record<string, unknown>;

    // Remove from defaults.skills
    const defaults = (agents.defaults as Record<string, unknown> | undefined) ?? {};
    const defaultSkills = (defaults.skills as string[] | undefined) ?? [];
    defaults.skills = defaultSkills.filter((s: string) => s !== skillName);
    agents.defaults = defaults;

    // Remove from all agents.list[].skills
    const list = (agents.list as Array<Record<string, unknown>> | undefined) ?? [];
    for (const entry of list) {
      const agentSkills = (entry.skills as string[] | undefined) ?? [];
      entry.skills = agentSkills.filter((s: string) => s !== skillName);
    }

    await writeOpenClawConfig(workspaceId, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to remove skill "${skillName}" from config: ${msg}`);
  }
}

export async function updateAllSkills(workspaceId: string): Promise<CommandResult> {
  return runCapabilityCommand(workspaceId, { type: "skills-update-all" });
}

// ─── Combined listing with cache ────────────────────────────────────

interface CachedCapabilities {
  skills: InstalledSkill[];
  timestamp: number;
}

const capabilitiesCache = new Map<string, CachedCapabilities>();
const inflightRequests = new Map<string, Promise<{ skills: InstalledSkill[] }>>();
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function listCapabilities(
  workspaceId: string,
): Promise<{ skills: InstalledSkill[]; perAgentSlugs: string[] }> {
  const cached = capabilitiesCache.get(workspaceId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const perAgentSlugs = await getPerAgentSlugs();
    return { skills: cached.skills, perAgentSlugs };
  }

  // Deduplicate concurrent requests for the same workspace
  const inflight = inflightRequests.get(workspaceId);
  if (inflight) {
    const result = await inflight;
    const perAgentSlugs = await getPerAgentSlugs();
    return { ...result, perAgentSlugs };
  }

  const promise = listInstalledSkills(workspaceId).then(({ skills }) => {
    capabilitiesCache.set(workspaceId, { skills, timestamp: Date.now() });
    inflightRequests.delete(workspaceId);
    return { skills };
  }).catch((err) => {
    inflightRequests.delete(workspaceId);
    throw err;
  });

  inflightRequests.set(workspaceId, promise);
  const result = await promise;
  const perAgentSlugs = await getPerAgentSlugs();
  return { ...result, perAgentSlugs };
}

/** Return skill keys that have per-agent assignments (not workspace-global). */
async function getPerAgentSlugs(): Promise<string[]> {
  const skills = await prisma.skill.findMany({
    where: { agents: { some: {} } },
    select: { key: true },
  });
  return skills.map((s) => s.key);
}

/** Invalidate cache after install/update/toggle operations. */
export function invalidateCapabilitiesCache(workspaceId: string): void {
  capabilitiesCache.delete(workspaceId);
}

// ─── Skill config (openclaw.json skills.entries) ────────────────────

export interface SkillConfigEntry {
  enabled?: boolean;
  env?: Record<string, string>;
  apiKey?: string | { source: string; provider: string; id: string };
}

export async function toggleSkill(
  workspaceId: string,
  skillName: string,
  enabled: boolean,
): Promise<void> {
  // ── Phase 0: ensure files on disk for managed skills ─────────────────
  // Handles workspaces provisioned before the skill was added — e.g. enabling
  // yahoo-finance from the Skills page on a non-investing-firm workspace.
  if (enabled && isManagedSkill(skillName)) {
    await ensureManagedSkillOnDisk(workspaceId, skillName);
  }

  // ── Phase A: write ONLY the skills.entries flag ──────────────────────
  // The OpenClaw gateway has an anomaly detector that compares each file
  // write against an in-memory "last good" snapshot. A combined write that
  // touches both `skills.entries` AND `agents.list[].skills` /
  // `agents.defaults.skills` triggers the detector, which reverts the agents
  // changes (only the entries flag survives via the dynamic-reload safe list).
  //
  // The defense is to split the writes: small entries-only change first,
  // confirm the gateway accepts it via RPC, THEN make the agents change in a
  // separate write. The RPC ack between writes gives the gateway a chance to
  // re-snapshot its in-memory last-good so the second write is compared
  // against a baseline that already includes our entries change.
  {
    const config = await readOpenClawConfig(workspaceId);
    const skills = (config.skills ?? {}) as Record<string, unknown>;
    const entries = (skills.entries ?? {}) as Record<string, Record<string, unknown>>;
    entries[skillName] = { ...entries[skillName], enabled };
    skills.entries = entries;
    config.skills = skills;
    await writeOpenClawConfig(workspaceId, config);
    log.info(
      `[toggleSkill] phase A: wrote skills.entries["${skillName}"].enabled=${enabled} for workspace "${workspaceId}"`,
    );
  }

  // ── Phase B: send the skills.update RPC and wait for the gateway ack ──
  // skills.update is on the gateway's dynamic-reload safe list. After this
  // RPC succeeds, the gateway has accepted the new entries.enabled state in
  // its in-memory model and (we hope) re-snapshotted its last-good baseline.
  let rpcOk = false;
  try {
    const { chatService } = await import("../chat/service.js");
    const client = await chatService.getClient(workspaceId);
    await client.request("skills.update", { skillKey: skillName, enabled });
    rpcOk = true;
    log.info(
      `[toggleSkill] phase B: skills.update RPC ack received for "${skillName}" in workspace "${workspaceId}"`,
    );
  } catch (err) {
    log.warn(
      `[toggleSkill] phase B: skills.update RPC failed for "${skillName}" in workspace "${workspaceId}": ${err instanceof Error ? err.message : String(err)} (continuing — file watcher is the fallback)`,
    );
  }

  // ── Phase C: short delay so the gateway can absorb the RPC ───────────
  // Gives the gateway time to update its in-memory model and re-snapshot
  // last-good before our second write hits the watcher.
  await new Promise((resolve) => setTimeout(resolve, 500));

  // ── Phase D: write the agents.defaults.skills + agents.list[].skills ─
  // Read fresh — the gateway may have re-saved the file in response to our
  // Phase A write or the RPC, and we want to operate on the latest content.
  {
    const config = await readOpenClawConfig(workspaceId);
    const agents = (config.agents ?? {}) as Record<string, unknown>;
    config.agents = agents;
    const defaults = (agents.defaults ?? {}) as Record<string, unknown>;
    agents.defaults = defaults;
    const defaultSkills = (defaults.skills as string[] | undefined) ?? [];
    if (enabled) {
      if (!defaultSkills.includes(skillName)) defaultSkills.push(skillName);
      defaults.skills = defaultSkills;
    } else {
      defaults.skills = defaultSkills.filter((s) => s !== skillName);
    }

    const list = (agents.list as Array<Record<string, unknown>> | undefined) ?? [];
    for (const entry of list) {
      const agentSkills = (entry.skills as string[] | undefined) ?? [];
      if (enabled) {
        if (!agentSkills.includes(skillName)) {
          agentSkills.push(skillName);
          entry.skills = agentSkills;
        }
      } else {
        entry.skills = agentSkills.filter((s) => s !== skillName);
      }
    }

    await writeOpenClawConfig(workspaceId, config);
    log.info(
      `[toggleSkill] phase D: wrote agents update. defaults.skills = [${(defaults.skills as string[]).join(", ")}] for workspace "${workspaceId}"`,
    );
  }

  // ── Phase E: verify the agents change actually survived ─────────────
  // Read the file back after a brief settle delay. If `agents.defaults.skills`
  // doesn't reflect the change we just wrote, the gateway has reverted us —
  // log a clear error so the operator can see the gateway is rejecting the
  // write (vs a stale-build issue or a race in our own code).
  await new Promise((resolve) => setTimeout(resolve, 250));
  const verifyConfig = await readOpenClawConfig(workspaceId);
  const verifyAgents = (verifyConfig.agents as Record<string, unknown> | undefined) ?? {};
  const verifyDefaults = (verifyAgents.defaults as Record<string, unknown> | undefined) ?? {};
  const verifySkills = (verifyDefaults.skills as string[] | undefined) ?? [];
  const present = verifySkills.includes(skillName);
  const expected = enabled;
  if (present === expected) {
    log.info(
      `[toggleSkill] phase E ✓ verified: agents.defaults.skills survived for "${skillName}" (workspace "${workspaceId}", rpcOk=${rpcOk}). final = [${verifySkills.join(", ")}]`,
    );
  } else {
    log.error(
      `[toggleSkill] phase E ✗ REVERTED: agents.defaults.skills was reverted by the gateway for "${skillName}" (workspace "${workspaceId}", rpcOk=${rpcOk}). expected ${expected ? "present" : "absent"}, got ${present ? "present" : "absent"}. final = [${verifySkills.join(", ")}]. Check the gateway log for "Config observe anomaly" / "Config overwrite" lines.`,
    );
  }
}

/**
 * Copy a managed skill's full directory tree to the workspace data dir
 * if it doesn't already exist. This covers workspaces provisioned before
 * the skill was added.
 */
async function ensureManagedSkillOnDisk(
  workspaceId: string,
  skillName: string,
): Promise<void> {
  const destDir = join(getDataDir(workspaceId), "skills", skillName);
  try {
    await stat(join(destDir, "SKILL.md"));
    return; // already exists
  } catch {
    // not on disk yet — copy it
  }

  const srcDir = join(getSkillsSourceDir(), skillName);
  try {
    await cp(srcDir, destDir, { recursive: true });
    const meta = {
      ownerId: "opcify-managed",
      slug: skillName,
      version: "1.0.0",
      publishedAt: Date.now(),
    };
    await writeFile(
      join(destDir, "_meta.json"),
      JSON.stringify(meta, null, 2),
      "utf-8",
    );
    log.info(`Copied managed skill "${skillName}" to workspace ${workspaceId}`);
  } catch (err) {
    log.warn(`Could not copy managed skill "${skillName}" to workspace: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function updateSkillConfig(
  workspaceId: string,
  skillName: string,
  patch: SkillConfigEntry,
): Promise<void> {
  const config = await readOpenClawConfig(workspaceId);
  const skills = (config.skills ?? {}) as Record<string, unknown>;
  const entries = (skills.entries ?? {}) as Record<string, Record<string, unknown>>;
  entries[skillName] = { ...entries[skillName], ...patch };
  skills.entries = entries;
  config.skills = skills;
  await writeOpenClawConfig(workspaceId, config);
  log.info(`Skill config updated for "${skillName}" in workspace ${workspaceId}`);
}

export async function getSkillConfig(
  workspaceId: string,
  skillName: string,
): Promise<SkillConfigEntry> {
  const config = await readOpenClawConfig(workspaceId);
  const skills = (config.skills ?? {}) as Record<string, unknown>;
  const entries = (skills.entries ?? {}) as Record<string, Record<string, unknown>>;
  return (entries[skillName] ?? {}) as SkillConfigEntry;
}

// ─── Opcify managed skills ────────────────────────────────────────────

export interface ManagedSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  category: string;
  installed: boolean;
  /** Setup-wizard tier — see ManagedSkillTier in managed-skills-loader. */
  tier: ManagedSkillTier;
  /** Workspace template keys this skill is scoped to (template-scoped tier only). */
  templateScopes?: string[];
  /** Always-on skills are rendered as locked checkboxes in the setup wizard. */
  alwaysOn: boolean;
  /** Optional emoji from _meta.json for UI rendering. */
  emoji?: string;
  /** Display label from _meta.json (falls back to slug). */
  label: string;
}

/**
 * Workspace-agnostic catalog of every Opcify-managed skill, loaded from
 * `templates/skills/<slug>/_meta.json`. Used by the setup wizard which is not
 * scoped to any workspace yet. The `installed` flag is always false here.
 */
export async function listManagedSkillsCatalog(): Promise<ManagedSkill[]> {
  return assemble(null);
}

/**
 * Per-workspace listing — same shape as the catalog, plus the `installed` flag
 * sourced from the workspace's openclaw.json.
 */
export async function listManagedSkills(
  workspaceId: string,
): Promise<ManagedSkill[]> {
  return assemble(workspaceId);
}

async function assemble(workspaceId: string | null): Promise<ManagedSkill[]> {
  const srcDir = getSkillsSourceDir();

  // Optionally read openclaw.json to check which skills are enabled
  let enabledEntries: Record<string, Record<string, unknown>> = {};
  if (workspaceId) {
    try {
      const config = await readOpenClawConfig(workspaceId);
      const skills = (config.skills ?? {}) as Record<string, unknown>;
      enabledEntries = (skills.entries ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
    } catch {
      // Workspace may not be provisioned yet — treat all as not installed
    }
  }

  const registry = loadManagedSkillRegistry();
  const results: ManagedSkill[] = [];
  for (const entry of registry) {
    if (entry.slug === "opcify") continue; // always installed, hidden from picker
    let frontmatter: { name?: string; description?: string; category?: string } = {};
    try {
      const raw = await readFile(join(srcDir, entry.slug, "SKILL.md"), "utf-8");
      frontmatter = parseSkillFrontmatter(raw);
    } catch {
      log.warn(`Could not read SKILL.md for managed skill "${entry.slug}"`);
    }
    const enabledEntry = enabledEntries[entry.slug];
    const installed = enabledEntry?.enabled === true;

    results.push({
      slug: entry.slug,
      // Prefer the _meta.json label, fall back to SKILL.md frontmatter `name`,
      // then to the slug as a last resort.
      name: entry.label || frontmatter.name || entry.slug,
      label: entry.label || frontmatter.name || entry.slug,
      description: entry.description || frontmatter.description || "",
      version: entry.version,
      category: frontmatter.category || "",
      installed,
      tier: entry.tier,
      templateScopes: entry.templateScopes.length > 0 ? [...entry.templateScopes] : undefined,
      alwaysOn: entry.alwaysOn,
      emoji: entry.emoji,
    });
  }
  return results;
}
