import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the runtime executor before importing service
const mockExec = vi.fn();

vi.mock("../../runtime/executor.js", () => ({
  getExecutor: () => ({ exec: mockExec }),
}));

vi.mock("../../workspace/WorkspaceConfig.js", () => ({
  containerNames: (workspaceId: string) => ({
    gateway: `openclaw-gateway-${workspaceId}`,
    browser: `openclaw-browser-${workspaceId}`,
    network: `opcify-ws-${workspaceId}`,
  }),
  readOpenClawConfig: vi.fn().mockResolvedValue({}),
  writeOpenClawConfig: vi.fn().mockResolvedValue(undefined),
  getSkillsSourceDir: () => "/tmp/skills",
  getDataDir: () => "/tmp/ws",
  loadManagedSkillRegistry: vi.fn().mockResolvedValue({}),
  isManagedSkill: () => false,
}));

// Mock chat service so WS RPC fallback is skipped in tests
vi.mock("../chat/service.js", () => ({
  chatService: { getClient: () => Promise.reject(new Error("no gateway in test")) },
}));

import {
  runCapabilityCommand,
  installSkillBySlug,
  updateAllSkills,
  listInstalledSkills,
} from "./service.js";

const TEST_WS = "test-workspace-id";

function simulateExec(stdout: string, exitCode = 0, stderr = "") {
  mockExec.mockResolvedValue({ stdout, stderr, exitCode });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Command validation / whitelist ──────────────────────────────────

describe("command whitelist", () => {
  it("rejects empty slug", async () => {
    const result = await runCapabilityCommand(TEST_WS, { type: "skills-install", slug: "" });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not allowed");
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rejects slugs with shell injection characters", async () => {
    const result = await installSkillBySlug(TEST_WS, "foo; rm -rf /");
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("not allowed");
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rejects slugs exceeding max length", async () => {
    const result = await installSkillBySlug(TEST_WS, "a".repeat(201));
    expect(result.success).toBe(false);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("rejects path traversal attempts", async () => {
    const result = await installSkillBySlug(TEST_WS, "../../../etc/passwd");
    expect(result.success).toBe(false);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ─── Install skill ──────────────────────────────────────────────────

describe("installSkillBySlug", () => {
  it("builds correct command for skill install via runtime executor", async () => {
    simulateExec("Installed skill: my-skill");
    const result = await installSkillBySlug(TEST_WS, "my-skill");

    expect(result.success).toBe(true);
    expect(result.command).toBe("openclaw skills install my-skill");
    // First call is the skills install, second is the copySkillToGlobal shell.
    expect(mockExec.mock.calls[0][0]).toBe(TEST_WS);
    expect(mockExec.mock.calls[0][1]).toEqual(["openclaw", "skills", "install", "my-skill"]);
  });

  it("handles scoped skill slugs", async () => {
    simulateExec("OK");
    await installSkillBySlug(TEST_WS, "@org/my-skill");

    expect(mockExec.mock.calls[0][1]).toEqual(["openclaw", "skills", "install", "@org/my-skill"]);
  });
});

// ─── Update all ─────────────────────────────────────────────────────

describe("updateAllSkills", () => {
  it("builds correct command", async () => {
    simulateExec("Updated 3 skills");
    const result = await updateAllSkills(TEST_WS);

    expect(result.success).toBe(true);
    expect(result.command).toBe("openclaw skills update --all");
  });
});

// ─── List skills ────────────────────────────────────────────────────

describe("listInstalledSkills", () => {
  it("parses wrapped JSON output { skills: [...] }", async () => {
    const json = JSON.stringify({
      workspaceDir: "/home/node/.openclaw/workspace",
      skills: [
        { name: "web-search", source: "openclaw-bundled" },
        { name: "browser-use", source: "openclaw-workspace" },
      ],
    });
    simulateExec(json);
    const { skills } = await listInstalledSkills(TEST_WS);

    expect(skills).toHaveLength(2);
    expect(skills[0].slug).toBe("web-search");
    expect(skills[0].name).toBe("web-search");
    expect(skills[0].source).toBe("openclaw-bundled");
    expect(skills[1].slug).toBe("browser-use");
  });

  it("parses bare array JSON output", async () => {
    const json = JSON.stringify([
      { slug: "web-search", name: "Web Search", source: "clawhub" },
    ]);
    simulateExec(json);
    const { skills } = await listInstalledSkills(TEST_WS);

    expect(skills).toHaveLength(1);
    expect(skills[0].slug).toBe("web-search");
  });

  it("returns empty array on command failure", async () => {
    simulateExec("Error: not found", 1);
    const { skills, raw } = await listInstalledSkills(TEST_WS);

    expect(skills).toHaveLength(0);
    expect(raw.success).toBe(false);
  });
});

// ─── Malicious inputs ───────────────────────────────────────────────

describe("only whitelisted commands are allowed", () => {
  const maliciousInputs = [
    "foo; rm -rf /",
    "$(cat /etc/passwd)",
    "`whoami`",
    "foo\nbar",
    "foo|bar",
    "../../../etc/passwd",
  ];

  for (const input of maliciousInputs) {
    it(`rejects malicious slug: ${input}`, async () => {
      const result = await installSkillBySlug(TEST_WS, input);
      expect(result.success).toBe(false);
      expect(mockExec).not.toHaveBeenCalled();
      vi.clearAllMocks();
    });
  }
});
