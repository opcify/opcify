import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readOpenClawConfig,
  writeOpenClawConfig,
  patchTelegramConfig,
  patchBindings,
  runOpenClawCommand,
} from "./service.js";
import type { TelegramChannelConfig, BindingEntry } from "./service.js";

// Use a temp directory for tests
const TEST_DIR = join(tmpdir(), "opcify-test-openclaw-" + Date.now());
const TEST_CONFIG = join(TEST_DIR, "openclaw.json");

beforeEach(async () => {
  process.env.OPENCLAW_CONFIG_PATH = TEST_CONFIG;
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  delete process.env.OPENCLAW_CONFIG_PATH;
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true, force: true });
  }
});

// ─── readOpenClawConfig ─────────────────────────────────────────────

describe("readOpenClawConfig", () => {
  it("returns empty object when file does not exist", async () => {
    const config = await readOpenClawConfig();
    expect(config).toEqual({});
  });

  it("reads and parses existing config", async () => {
    const data = { channels: { telegram: { enabled: true } }, other: "value" };
    await writeFile(TEST_CONFIG, JSON.stringify(data), "utf-8");

    const config = await readOpenClawConfig();
    expect(config).toEqual(data);
  });
});

// ─── writeOpenClawConfig ────────────────────────────────────────────

describe("writeOpenClawConfig", () => {
  it("creates config file and parent directories", async () => {
    const nestedDir = join(TEST_DIR, "nested", "dir");
    const nestedConfig = join(nestedDir, "openclaw.json");
    process.env.OPENCLAW_CONFIG_PATH = nestedConfig;

    await writeOpenClawConfig({ test: true });

    expect(existsSync(nestedConfig)).toBe(true);
    const raw = await readFile(nestedConfig, "utf-8");
    expect(JSON.parse(raw)).toEqual({ test: true });
  });

  it("creates backup before overwriting", async () => {
    await writeFile(TEST_CONFIG, '{"original": true}', "utf-8");
    await writeOpenClawConfig({ updated: true });

    const backup = await readFile(TEST_CONFIG + ".bak", "utf-8");
    expect(JSON.parse(backup)).toEqual({ original: true });

    const current = await readFile(TEST_CONFIG, "utf-8");
    expect(JSON.parse(current)).toEqual({ updated: true });
  });
});

// ─── patchTelegramConfig ────────────────────────────────────────────

describe("patchTelegramConfig", () => {
  it("writes Telegram config to empty file", async () => {
    const telegramConfig: TelegramChannelConfig = {
      enabled: true,
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      streaming: "partial",
      accounts: {
        "coder-bot": {
          enabled: true,
          dmPolicy: "pairing",
          botToken: "TOKEN_A",
          groups: { "*": { requireMention: true } },
          groupPolicy: "allowlist",
          streaming: "partial",
        },
      },
    };

    const result = await patchTelegramConfig(telegramConfig);

    expect(result.channels?.telegram?.enabled).toBe(true);
    expect(result.channels?.telegram?.accounts["coder-bot"].botToken).toBe("TOKEN_A");
  });

  it("preserves existing non-Telegram config", async () => {
    await writeFile(
      TEST_CONFIG,
      JSON.stringify({
        someSetting: "keep-me",
        channels: { discord: { enabled: false } },
      }),
      "utf-8",
    );

    const telegramConfig: TelegramChannelConfig = {
      enabled: true,
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      streaming: "partial",
      accounts: {
        "bot-1": {
          enabled: true,
          dmPolicy: "pairing",
          botToken: "T1",
          groups: { "*": { requireMention: true } },
          groupPolicy: "allowlist",
          streaming: "partial",
        },
      },
    };

    const result = await patchTelegramConfig(telegramConfig);

    expect(result.someSetting).toBe("keep-me");
    expect((result.channels as Record<string, unknown>).discord).toEqual({ enabled: false });
    expect(result.channels?.telegram?.accounts["bot-1"].botToken).toBe("T1");
  });

  it("replaces accounts with exactly what was submitted", async () => {
    await writeFile(
      TEST_CONFIG,
      JSON.stringify({
        channels: {
          telegram: {
            enabled: true,
            dmPolicy: "pairing",
            groupPolicy: "allowlist",
            streaming: "partial",
            accounts: {
              "existing-bot": {
                enabled: true,
                dmPolicy: "pairing",
                botToken: "OLD_TOKEN",
                groups: { "*": { requireMention: true } },
                groupPolicy: "allowlist",
                streaming: "partial",
              },
            },
          },
        },
      }),
      "utf-8",
    );

    const telegramConfig: TelegramChannelConfig = {
      enabled: true,
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      streaming: "partial",
      accounts: {
        "new-bot": {
          enabled: true,
          dmPolicy: "pairing",
          botToken: "NEW_TOKEN",
          groups: { "*": { requireMention: true } },
          groupPolicy: "allowlist",
          streaming: "partial",
        },
      },
    };

    const result = await patchTelegramConfig(telegramConfig);

    // Only the submitted account should exist — existing-bot was removed
    const accounts = result.channels?.telegram?.accounts;
    expect(accounts).toBeDefined();
    expect(Object.keys(accounts!)).toHaveLength(1);
    expect(accounts!["new-bot"].botToken).toBe("NEW_TOKEN");
    expect(accounts!["existing-bot"]).toBeUndefined();
  });

  it("updates existing account when same key provided", async () => {
    await writeFile(
      TEST_CONFIG,
      JSON.stringify({
        channels: {
          telegram: {
            enabled: true,
            dmPolicy: "pairing",
            groupPolicy: "allowlist",
            streaming: "partial",
            accounts: {
              "my-bot": {
                enabled: true,
                dmPolicy: "pairing",
                botToken: "OLD_TOKEN",
                groups: { "*": { requireMention: true } },
                groupPolicy: "allowlist",
                streaming: "partial",
              },
            },
          },
        },
      }),
      "utf-8",
    );

    const telegramConfig: TelegramChannelConfig = {
      enabled: true,
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      streaming: "partial",
      accounts: {
        "my-bot": {
          enabled: false,
          dmPolicy: "open",
          botToken: "NEW_TOKEN",
          groups: { "*": { requireMention: false } },
          groupPolicy: "open",
          streaming: "full",
        },
      },
    };

    const result = await patchTelegramConfig(telegramConfig);

    const accounts = result.channels?.telegram?.accounts;
    expect(Object.keys(accounts!)).toHaveLength(1);
    expect(accounts!["my-bot"].botToken).toBe("NEW_TOKEN");
    expect(accounts!["my-bot"].dmPolicy).toBe("open");
  });
});

// ─── patchBindings ──────────────────────────────────────────────────

describe("patchBindings", () => {
  it("writes bindings to empty config", async () => {
    const newBindings: BindingEntry[] = [
      { agentId: "coder", match: { channel: "telegram", accountId: "coder-bot" } },
    ];

    const result = await patchBindings(newBindings);

    expect(result.bindings).toHaveLength(1);
    expect(result.bindings![0].agentId).toBe("coder");
    expect(result.bindings![0].match.accountId).toBe("coder-bot");
  });

  it("preserves bindings for other channels", async () => {
    await writeFile(
      TEST_CONFIG,
      JSON.stringify({
        bindings: [
          { agentId: "discord-agent", match: { channel: "discord", accountId: "my-discord" } },
        ],
      }),
      "utf-8",
    );

    const newBindings: BindingEntry[] = [
      { agentId: "tg-agent", match: { channel: "telegram", accountId: "tg-bot" } },
    ];

    const result = await patchBindings(newBindings);

    expect(result.bindings).toHaveLength(2);
    const discord = result.bindings!.find(b => b.match.channel === "discord");
    const telegram = result.bindings!.find(b => b.match.channel === "telegram");
    expect(discord?.agentId).toBe("discord-agent");
    expect(telegram?.agentId).toBe("tg-agent");
  });

  it("replaces existing binding for same channel/accountId", async () => {
    await writeFile(
      TEST_CONFIG,
      JSON.stringify({
        bindings: [
          { agentId: "old-agent", match: { channel: "telegram", accountId: "my-bot" } },
        ],
      }),
      "utf-8",
    );

    const newBindings: BindingEntry[] = [
      { agentId: "new-agent", match: { channel: "telegram", accountId: "my-bot" } },
    ];

    const result = await patchBindings(newBindings);

    expect(result.bindings).toHaveLength(1);
    expect(result.bindings![0].agentId).toBe("new-agent");
  });

  it("does not duplicate bindings", async () => {
    await writeFile(
      TEST_CONFIG,
      JSON.stringify({
        bindings: [
          { agentId: "agent-a", match: { channel: "telegram", accountId: "bot-1" } },
          { agentId: "agent-b", match: { channel: "telegram", accountId: "bot-2" } },
        ],
      }),
      "utf-8",
    );

    const newBindings: BindingEntry[] = [
      { agentId: "agent-c", match: { channel: "telegram", accountId: "bot-1" } },
      { agentId: "agent-d", match: { channel: "telegram", accountId: "bot-3" } },
    ];

    const result = await patchBindings(newBindings);

    expect(result.bindings).toHaveLength(3);
    const bot1 = result.bindings!.find(b => b.match.accountId === "bot-1");
    expect(bot1?.agentId).toBe("agent-c"); // replaced
    const bot2 = result.bindings!.find(b => b.match.accountId === "bot-2");
    expect(bot2?.agentId).toBe("agent-b"); // preserved
    const bot3 = result.bindings!.find(b => b.match.accountId === "bot-3");
    expect(bot3?.agentId).toBe("agent-d"); // added
  });
});

// ─── runOpenClawCommand ─────────────────────────────────────────────

describe("runOpenClawCommand", () => {
  it("rejects arbitrary commands", async () => {
    const result = await runOpenClawCommand("rm", ["-rf", "/"]);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not allowed");
  });

  it("rejects commands that look like allowed but have extra args", async () => {
    const result = await runOpenClawCommand("pairing", ["list", "telegram", "--extra"]);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not allowed");
  });

  it("rejects pairing approve with no code", async () => {
    const result = await runOpenClawCommand("pairing", ["approve", "telegram"]);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not allowed");
  });

  it("rejects pairing approve with invalid code characters", async () => {
    const result = await runOpenClawCommand("pairing", ["approve", "telegram", "code;rm -rf /"]);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not allowed");
  });

  it("allows valid gateway command format", async () => {
    // This will fail because openclaw is not installed, but it should pass validation
    const result = await runOpenClawCommand("gateway", []);
    // It passed the whitelist check (will fail execution since openclaw isn't installed)
    expect(result.command).toBe("openclaw gateway");
    // Exit code should be non-zero since openclaw isn't installed in test env
    // but the key point is that it wasn't rejected by the whitelist
  });

  it("allows valid pairing list command format", async () => {
    const result = await runOpenClawCommand("pairing", ["list", "telegram"]);
    expect(result.command).toBe("openclaw pairing list telegram");
  });

  it("allows valid pairing approve command format", async () => {
    const result = await runOpenClawCommand("pairing", ["approve", "telegram", "abc123"]);
    expect(result.command).toBe("openclaw pairing approve telegram abc123");
  });
});
