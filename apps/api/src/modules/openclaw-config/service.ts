import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { createLogger } from "../../logger.js";
import { getDataDir, containerNames } from "../../workspace/WorkspaceConfig.js";
import { getExecutor } from "../../runtime/executor.js";

const log = createLogger("openclaw-config");

// ─── Types ──────────────────────────────────────────────────────────

export interface TelegramAccountConfig {
  enabled: boolean;
  dmPolicy: string;
  botToken: string;
  groups: Record<string, { requireMention: boolean }>;
  groupPolicy: string;
  streaming: string;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  dmPolicy: string;
  groupPolicy: string;
  streaming: string;
  accounts: Record<string, TelegramAccountConfig>;
}

export interface BindingEntry {
  agentId: string;
  match: {
    channel: string;
    accountId: string;
  };
}

export interface OpenClawConfig {
  channels?: {
    telegram?: TelegramChannelConfig;
    [key: string]: unknown;
  };
  bindings?: BindingEntry[];
  [key: string]: unknown;
}

export interface CommandResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ─── Config path ────────────────────────────────────────────────────

/**
 * Resolve the openclaw.json config path.
 *
 * When workspaceId is provided, returns the workspace-specific config at
 * ~/.opcify/workspaces/{id}/openclaw.json — this is the file the Docker
 * container sees at /home/node/.openclaw/openclaw.json via bind mount.
 *
 * Without workspaceId, falls back to the global ~/.openclaw/openclaw.json
 * or OPENCLAW_CONFIG_PATH env var (for tests).
 */
function getConfigPath(workspaceId?: string): string {
  if (workspaceId) {
    return join(getDataDir(workspaceId), "openclaw.json");
  }
  return process.env.OPENCLAW_CONFIG_PATH || join(homedir(), ".openclaw", "openclaw.json");
}

// ─── Read config ────────────────────────────────────────────────────

export async function readOpenClawConfig(workspaceId?: string): Promise<OpenClawConfig> {
  const configPath = getConfigPath(workspaceId);
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as OpenClawConfig;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.info(`Config file not found at ${configPath}, returning empty config`);
      return {};
    }
    throw err;
  }
}

// ─── Write config ───────────────────────────────────────────────────

export async function writeOpenClawConfig(config: OpenClawConfig, workspaceId?: string): Promise<void> {
  const configPath = getConfigPath(workspaceId);
  const dir = dirname(configPath);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // Backup existing file
  if (existsSync(configPath)) {
    try {
      const existing = await readFile(configPath, "utf-8");
      await writeFile(configPath + ".bak", existing, "utf-8");
    } catch {
      log.warn("Failed to create config backup");
    }
  }

  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  log.info(`Config written to ${configPath}`);
}

// ─── Patch config (deep merge) ──────────────────────────────────────

export async function patchOpenClawConfig(patch: Partial<OpenClawConfig>, workspaceId?: string): Promise<OpenClawConfig> {
  const existing = await readOpenClawConfig(workspaceId);
  const merged = deepMerge(existing, patch) as OpenClawConfig;
  await writeOpenClawConfig(merged, workspaceId);
  return merged;
}

// ─── Patch Telegram channel config ──────────────────────────────────

export async function patchTelegramConfig(telegramConfig: TelegramChannelConfig, workspaceId?: string): Promise<OpenClawConfig> {
  const existing = await readOpenClawConfig(workspaceId);

  // Replace accounts with exactly what was submitted — removed accounts stay removed
  const mergedTelegram: TelegramChannelConfig = {
    ...telegramConfig,
    accounts: telegramConfig.accounts,
  };

  const merged: OpenClawConfig = {
    ...existing,
    channels: {
      ...(existing.channels || {}),
      telegram: mergedTelegram,
    },
  };

  await writeOpenClawConfig(merged, workspaceId);
  return merged;
}

// ─── Delete a single Telegram account (and its binding) ────────────

export async function deleteTelegramAccount(accountId: string, workspaceId?: string): Promise<OpenClawConfig> {
  const existing = await readOpenClawConfig(workspaceId);
  const telegram = existing.channels?.telegram;
  if (!telegram?.accounts?.[accountId]) {
    throw new Error(`Account "${accountId}" not found`);
  }

  delete telegram.accounts[accountId];

  // Remove any bindings referencing this account
  if (existing.bindings) {
    existing.bindings = existing.bindings.filter(
      (b) => !(b.match.channel === "telegram" && b.match.accountId === accountId),
    );
  }

  await writeOpenClawConfig(existing, workspaceId);
  return existing;
}

// ─── Patch bindings ─────────────────────────────────────────────────

export async function patchBindings(newBindings: BindingEntry[], workspaceId?: string): Promise<OpenClawConfig> {
  const existing = await readOpenClawConfig(workspaceId);
  const existingBindings = existing.bindings || [];

  // Build map: "channel:accountId" -> binding
  const bindingMap = new Map<string, BindingEntry>();

  // Add existing bindings first
  for (const b of existingBindings) {
    const key = `${b.match.channel}:${b.match.accountId}`;
    bindingMap.set(key, b);
  }

  // Overwrite/add new bindings
  for (const b of newBindings) {
    const key = `${b.match.channel}:${b.match.accountId}`;
    bindingMap.set(key, b);
  }

  const merged: OpenClawConfig = {
    ...existing,
    bindings: Array.from(bindingMap.values()),
  };

  await writeOpenClawConfig(merged, workspaceId);
  return merged;
}

// ─── Run whitelisted OpenClaw command ───────────────────────────────

function validateCommandArgs(commandKey: string, args: string[]): boolean {
  if (commandKey === "gateway" && args.length === 0) return true;
  if (commandKey === "pairing" && args[0] === "list" && args[1] === "telegram" && args.length === 2) return true;
  if (commandKey === "pairing" && args[0] === "approve" && args[1] === "telegram" && args.length === 3 && /^[a-zA-Z0-9_-]+$/.test(args[2])) return true;
  return false;
}

/**
 * Run a whitelisted openclaw CLI command.
 * When workspaceId is provided, executes inside the workspace's Docker container.
 * Otherwise falls back to host execution.
 */
export async function runOpenClawCommand(commandKey: string, args: string[], workspaceId?: string): Promise<CommandResult> {
  const fullArgs = args.join(" ");

  if (!validateCommandArgs(commandKey, args)) {
    log.warn(`Rejected command: openclaw ${commandKey} ${fullArgs}`);
    return {
      success: false,
      command: `openclaw ${commandKey} ${fullArgs}`,
      stdout: "",
      stderr: "Command not allowed. Only gateway, pairing list telegram, and pairing approve telegram <code> are permitted.",
      exitCode: 1,
    };
  }

  const fullCommand = `openclaw ${commandKey} ${fullArgs}`.trim();

  // Execute inside the workspace Docker container when workspaceId is provided
  if (workspaceId) {
    return runInContainer(workspaceId, ["openclaw", commandKey, ...args], fullCommand);
  }

  // Fallback: run on host (legacy, no workspace context)
  return new Promise((resolve) => {
    const allArgs = [commandKey, ...args];
    execFile("openclaw", allArgs, { timeout: 30_000 }, (error, stdout, stderr) => {
      const exitCode = error ? (error as { code?: number }).code ?? 1 : 0;
      resolve({
        success: exitCode === 0,
        command: fullCommand,
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode,
      });
    });
  });
}

async function runInContainer(workspaceId: string, cmd: string[], displayCommand: string): Promise<CommandResult> {
  const names = containerNames(workspaceId);
  log.info(`Running in container ${names.gateway}: ${displayCommand}`);

  try {
    const { stdout, stderr, exitCode } = await getExecutor().exec(workspaceId, cmd);
    // Preserve historical semantics: on success, stdout wins; on failure,
    // whatever the command wrote goes into stderr so callers see the cause.
    const mergedOnFailure = [stderr, stdout].filter(Boolean).join("\n");
    return {
      success: exitCode === 0,
      command: displayCommand,
      stdout: exitCode === 0 ? stdout : "",
      stderr: exitCode !== 0 ? mergedOnFailure : stderr,
      exitCode,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Container exec failed for ${names.gateway}: ${msg}`);
    return {
      success: false,
      command: displayCommand,
      stdout: "",
      stderr: `Container exec failed: ${msg}`,
      exitCode: 1,
    };
  }
}

// ─── Get pairing list ───────────────────────────────────────────────

export async function getPairingList(channel: string, workspaceId?: string): Promise<CommandResult> {
  return runOpenClawCommand("pairing", ["list", channel], workspaceId);
}

// ─── Approve pairing ────────────────────────────────────────────────

export async function approvePairing(channel: string, code: string, workspaceId?: string): Promise<CommandResult> {
  return runOpenClawCommand("pairing", ["approve", channel, code], workspaceId);
}

// ─── Deep merge utility ─────────────────────────────────────────────

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];
    if (
      targetVal && sourceVal &&
      typeof targetVal === "object" && typeof sourceVal === "object" &&
      !Array.isArray(targetVal) && !Array.isArray(sourceVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}
