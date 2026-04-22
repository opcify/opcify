import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (available inside vi.mock factories) ─────────────

const {
  mockInspectContainer,
  mockStartContainer,
  mockStopContainer,
  mockRemoveContainer,
  mockExecCreate,
  mockInspectNetwork,
  mockCreateNetwork,
  mockCreateContainer,
  mockInspectImage,
  mockPull,
  mockFollowProgress,
  mockContainer,
  mockNetwork,
  mockReadFile,
  mockWriteFile,
  mockRuntimeExec,
} = vi.hoisted(() => {
  const mockInspectContainer = vi.fn();
  const mockStartContainer = vi.fn();
  const mockStopContainer = vi.fn();
  const mockRemoveContainer = vi.fn();
  const mockExecCreate = vi.fn();
  const mockInspectNetwork = vi.fn();
  const mockCreateNetwork = vi.fn();
  const mockRemoveNetwork = vi.fn();
  const mockCreateContainer = vi.fn();
  const mockInspectImage = vi.fn();
  const mockPull = vi.fn();
  const mockFollowProgress = vi.fn();
  const mockReadFile = vi.fn();
  const mockWriteFile = vi.fn().mockResolvedValue(undefined);
  const mockRuntimeExec = vi.fn();

  const mockContainer = {
    inspect: mockInspectContainer,
    start: mockStartContainer,
    stop: mockStopContainer,
    remove: mockRemoveContainer,
    exec: mockExecCreate,
  };

  const mockNetwork = {
    inspect: mockInspectNetwork,
    remove: mockRemoveNetwork,
  };

  return {
    mockInspectContainer,
    mockStartContainer,
    mockStopContainer,
    mockRemoveContainer,
    mockExecCreate,
    mockInspectNetwork,
    mockCreateNetwork,
    mockRemoveNetwork,
    mockCreateContainer,
    mockInspectImage,
    mockPull,
    mockFollowProgress,
    mockContainer,
    mockNetwork,
    mockReadFile,
    mockWriteFile,
    mockRuntimeExec,
  };
});

// ─── Mock runtime executor ──────────────────────────────────────────
vi.mock("../../runtime/executor.js", () => ({
  getExecutor: () => ({ exec: mockRuntimeExec }),
}));

// ─── Mock dockerode ─────────────────────────────────────────────────

vi.mock("dockerode", () => {
  class MockDockerode {
    getContainer() {
      return mockContainer;
    }
    getNetwork() {
      return mockNetwork;
    }
    getImage() {
      return { inspect: mockInspectImage };
    }
    createContainer(...args: unknown[]) {
      return mockCreateContainer(...args);
    }
    createNetwork(...args: unknown[]) {
      return mockCreateNetwork(...args);
    }
    pull(...args: unknown[]) {
      return mockPull(...args);
    }
    modem = { followProgress: mockFollowProgress };
  }
  return { default: MockDockerode };
});

// ─── Mock fs operations ─────────────────────────────────────────────

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    chown: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({}),
  };
});

// ─── Import after mocks ─────────────────────────────────────────────

import { WorkspaceService } from "../WorkspaceService.js";
import {
  buildOpenclawJson,
  resolveMemoryConfig,
} from "../WorkspaceConfig.js";

// ─── Helpers ────────────────────────────────────────────────────────

function makeContainerInspect(running: boolean) {
  return {
    State: { Running: running },
    HostConfig: { PortBindings: { "18789/tcp": [{ HostPort: "19000" }] } },
    NetworkSettings: { Ports: { "18789/tcp": [{ HostPort: "19000" }] } },
  };
}

function mockImageExists() {
  mockInspectImage.mockResolvedValue({});
}

function mockNetworkMissing() {
  mockInspectNetwork.mockRejectedValue(new Error("not found"));
}

function mockContainerCreated() {
  mockCreateContainer.mockResolvedValue({
    start: mockStartContainer,
    exec: mockExecCreate,
  });
}

function mockHealthyFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: "ok", uptime: 42 }),
    }),
  );
}

function mockUnhealthyFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("connection refused")),
  );
}

/**
 * Mock runtime exec for SKILL.md verification, healthcheck, and mkdir paths.
 * All four sites in WorkspaceService now route through getExecutor().exec,
 * so one mock covers them all. Return "installed" so skill-verify branches
 * log the positive path; exitCode 0 so the internal healthcheck passes.
 */
function mockSuccessfulExec() {
  mockRuntimeExec.mockResolvedValue({
    stdout: "installed",
    stderr: "",
    exitCode: 0,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("WorkspaceService", () => {
  let service: WorkspaceService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    service = new WorkspaceService();
    mockStartContainer.mockResolvedValue(undefined);
    mockStopContainer.mockResolvedValue(undefined);
    mockRemoveContainer.mockResolvedValue(undefined);
  });

  // ── Scenario A: ensureContainers ────────────────────────────────

  describe("ensureContainers", () => {
    it("1. returns already_running when gateway is running", async () => {
      mockInspectContainer.mockResolvedValue(makeContainerInspect(true));
      mockInspectNetwork.mockResolvedValue({});
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const result = await service.ensureContainers("ws-1");

      expect(result.action).toBe("already_running");
      expect(result.state.gateway).toBe("running");
      expect(mockStartContainer).not.toHaveBeenCalled();
      expect(mockCreateContainer).not.toHaveBeenCalled();
    });

    it("1a. syncs disk to container when OPCIFY_API_KEY has drifted", async () => {
      // Container was started long ago with "container-tok" baked in.
      // Meanwhile, something rotated the disk token to "stale-disk-tok".
      // registerFromContainer should detect the drift and rewrite both
      // opcify-meta.json AND openclaw.json with the container's value,
      // since the running agents are already using "container-tok".
      mockInspectContainer.mockResolvedValue({
        ...makeContainerInspect(true),
        Config: {
          Env: [
            "GATEWAY_TOKEN=gw-tok",
            "OPCIFY_API_URL=http://host.docker.internal:4210",
            "OPCIFY_WORKSPACE_ID=ws-drift",
            "OPCIFY_API_KEY=container-tok",
          ],
        },
      });
      mockInspectNetwork.mockResolvedValue({});

      mockReadFile.mockImplementation(async (path: string) => {
        if (path.endsWith("opcify-meta.json")) {
          return JSON.stringify({
            token: "gw-tok",
            userConfig: {},
            opcifyApiKey: "stale-disk-tok",
          });
        }
        if (path.endsWith("openclaw.json")) {
          return JSON.stringify({
            skills: {
              entries: {
                opcify: { env: { OPCIFY_API_KEY: "stale-disk-tok" } },
              },
            },
            meta: { lastTouchedVersion: "2026.4.5" },
            gateway: { mode: "local" },
          });
        }
        throw new Error(`unexpected readFile path: ${path}`);
      });

      const result = await service.ensureContainers("ws-drift");
      expect(result.action).toBe("already_running");

      const writtenMeta = mockWriteFile.mock.calls.find(([p]) =>
        String(p).endsWith("opcify-meta.json"),
      );
      expect(writtenMeta).toBeDefined();
      const writtenMetaBody = JSON.parse(writtenMeta![1] as string);
      expect(writtenMetaBody.opcifyApiKey).toBe("container-tok");

      const writtenConfig = mockWriteFile.mock.calls.find(([p]) =>
        String(p).endsWith("openclaw.json"),
      );
      expect(writtenConfig).toBeDefined();
      const writtenConfigBody = JSON.parse(writtenConfig![1] as string);
      expect(writtenConfigBody.skills.entries.opcify.env.OPCIFY_API_KEY).toBe(
        "container-tok",
      );
    });

    it("1b. leaves disk alone when the OPCIFY_API_KEY already matches", async () => {
      mockInspectContainer.mockResolvedValue({
        ...makeContainerInspect(true),
        Config: {
          Env: ["OPCIFY_API_KEY=agreed-tok"],
        },
      });
      mockInspectNetwork.mockResolvedValue({});
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.endsWith("opcify-meta.json")) {
          return JSON.stringify({
            token: "gw-tok",
            userConfig: {},
            opcifyApiKey: "agreed-tok",
          });
        }
        throw new Error(`unexpected readFile path: ${path}`);
      });

      await service.ensureContainers("ws-agree");

      const touchedMeta = mockWriteFile.mock.calls.some(([p]) =>
        String(p).endsWith("opcify-meta.json"),
      );
      const touchedConfig = mockWriteFile.mock.calls.some(([p]) =>
        String(p).endsWith("openclaw.json"),
      );
      expect(touchedMeta).toBe(false);
      expect(touchedConfig).toBe(false);
    });

    it("2. restarts stopped gateway", async () => {
      let callCount = 0;
      mockInspectContainer.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) return makeContainerInspect(false); // first detect: stopped
        return makeContainerInspect(true); // after restart
      });
      mockInspectNetwork.mockResolvedValue({});
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      mockSuccessfulExec();
      mockHealthyFetch();

      const result = await service.ensureContainers("ws-2");

      expect(result.action).toBe("restarted");
      expect(mockStartContainer).toHaveBeenCalled();
    });

    it("3. recreates gateway when missing but meta exists on disk", async () => {
      mockInspectContainer.mockRejectedValue(new Error("not found"));
      mockNetworkMissing();

      const meta = {
        token: "test-token-abc",
        userConfig: {},
      };
      mockReadFile.mockResolvedValue(JSON.stringify(meta));

      mockImageExists();
      mockCreateNetwork.mockResolvedValue({});
      mockContainerCreated();
      mockHealthyFetch();
      mockSuccessfulExec();

      const result = await service.ensureContainers("ws-3");

      expect(result.action).toBe("recreated");
      expect(mockCreateNetwork).toHaveBeenCalled();
    });

    it("4. throws when gateway missing and no meta on disk", async () => {
      mockInspectContainer.mockRejectedValue(new Error("not found"));
      mockNetworkMissing();
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      await expect(service.ensureContainers("ws-4")).rejects.toThrow(
        /cannot recover/i,
      );
    });
  });

  // ── Scenario B: create ──────────────────────────────────────────

  describe("create", () => {
    it("5. creates workspace — creates network and gateway container", async () => {
      mockInspectContainer.mockRejectedValue(new Error("not found"));
      mockNetworkMissing();
      mockImageExists();
      mockContainerCreated();
      mockCreateNetwork.mockResolvedValue({});
      mockHealthyFetch();
      mockSuccessfulExec();

      const ws = await service.create("ws-5");

      expect(ws.status).toBe("running");
      expect(ws.id).toBe("ws-5");
      expect(ws.gatewayPort).toBeGreaterThan(0);
      expect(ws.gatewayUrl).toContain("localhost");
      expect(mockCreateNetwork).toHaveBeenCalled();
      // One container: gateway only (browser-use is a CLI skill, not a container)
      expect(mockCreateContainer).toHaveBeenCalledTimes(1);
    });

    it("6. creates workspace with browser disabled — skips browser-use skill install", async () => {
      mockInspectContainer.mockRejectedValue(new Error("not found"));
      mockNetworkMissing();
      mockImageExists();
      mockContainerCreated();
      mockCreateNetwork.mockResolvedValue({});
      mockHealthyFetch();
      mockSuccessfulExec();

      const ws = await service.create("ws-6", {
        browser: { enabled: false },
      });

      expect(ws.status).toBe("running");
      expect(mockCreateContainer).toHaveBeenCalledTimes(1);
    });

    it("6a. sets OPCIFY_INSTALL_QMD=1 in container env when memory mode is local", async () => {
      // The Dockerfile no longer bakes @tobilu/qmd into the image — it's
      // installed lazily by entrypoint-wrapper.sh when this env var is set.
      // This test pins that wiring so a refactor can't silently drop the flag
      // and leave QMD-mode workspaces booting without their memory backend.
      mockInspectContainer.mockRejectedValue(new Error("not found"));
      mockNetworkMissing();
      mockImageExists();
      mockContainerCreated();
      mockCreateNetwork.mockResolvedValue({});
      mockHealthyFetch();
      mockSuccessfulExec();

      await service.create("ws-6a", {
        browser: { enabled: false },
        memory: {
          mode: "local",
          sessionsEnabled: true,
          dreamingEnabled: true,
          vectorWeight: 0.3,
          textWeight: 0.7,
        },
      });

      const createArgs = mockCreateContainer.mock.calls.at(-1)?.[0] as
        | { Env?: string[] }
        | undefined;
      expect(createArgs?.Env).toContain("OPCIFY_INSTALL_QMD=1");
    });

    it("6b. omits OPCIFY_INSTALL_QMD when memory mode is disabled or remote", async () => {
      // Markdown File (disabled) and Remote Embedding Engine both use the
      // builtin backend — they must not trigger the npm install hook or
      // we're back to wasting container startup time for workspaces that
      // don't need QMD.
      mockInspectContainer.mockRejectedValue(new Error("not found"));
      mockNetworkMissing();
      mockImageExists();
      mockContainerCreated();
      mockCreateNetwork.mockResolvedValue({});
      mockHealthyFetch();
      mockSuccessfulExec();

      await service.create("ws-6b", {
        browser: { enabled: false },
        memory: {
          mode: "disabled",
          sessionsEnabled: true,
          dreamingEnabled: true,
          vectorWeight: 0.3,
          textWeight: 0.7,
        },
      });

      const disabledArgs = mockCreateContainer.mock.calls.at(-1)?.[0] as
        | { Env?: string[] }
        | undefined;
      expect(disabledArgs?.Env ?? []).not.toContain("OPCIFY_INSTALL_QMD=1");

      // Reset for the remote check
      mockCreateContainer.mockClear();
      mockContainerCreated();

      await service.create("ws-6c", {
        browser: { enabled: false },
        memory: {
          mode: "remote",
          provider: "openai",
          sessionsEnabled: true,
          dreamingEnabled: true,
          vectorWeight: 0.7,
          textWeight: 0.3,
        },
      });

      const remoteArgs = mockCreateContainer.mock.calls.at(-1)?.[0] as
        | { Env?: string[] }
        | undefined;
      expect(remoteArgs?.Env ?? []).not.toContain("OPCIFY_INSTALL_QMD=1");
    });

    it("7. throws conflict when gateway already exists", async () => {
      mockInspectContainer.mockResolvedValue(makeContainerInspect(true));
      mockInspectNetwork.mockResolvedValue({});

      await expect(service.create("ws-7")).rejects.toThrow(/already exist/i);
      expect(mockCreateContainer).not.toHaveBeenCalled();
    });

    it("8. rejects with timeout when gateway health check fails", async () => {
      mockInspectContainer.mockRejectedValue(new Error("not found"));
      mockNetworkMissing();
      mockImageExists();
      mockContainerCreated();
      mockCreateNetwork.mockResolvedValue({});
      // Exec fails (internal healthcheck via the runtime executor)
      mockRuntimeExec.mockRejectedValue(new Error("not ready"));
      mockUnhealthyFetch();

      await expect(
        service.create("ws-8", {
          browser: { enabled: false },
        }),
      ).rejects.toThrow(/timed out/i);

      const ws = service.getWorkspace("ws-8");
      expect(ws?.status).toBe("error");
    }, 95000);
  });
});

// ── WorkspaceConfig tests ───────────────────────────────────────────

describe("WorkspaceConfig", () => {
  it("9. buildOpenclawJson with browser enabled configures sandbox browser", () => {
    const config = buildOpenclawJson("ws-9", "tok-123", {
      model: "gpt-4",
      browser: { enabled: true, headless: false },
      timezone: "America/New_York",
    });

    // Top-level browser config for OpenClaw
    const browser = config.browser as Record<string, unknown>;
    expect(browser.enabled).toBe(true);
    expect(browser.headless).toBe(false);
    expect(browser.noSandbox).toBe(true);
    expect(browser.defaultProfile).toBe("browser-use");

    // PLAYWRIGHT_BROWSERS_PATH is baked into the container image (see
    // docker/Dockerfile.openclaw); the builder no longer sets config.env.
    expect(config.env).toBeUndefined();

    // agents.defaults with timeout and subagent settings
    const agents = config.agents as Record<string, unknown>;
    const defaults = agents.defaults as Record<string, unknown>;
    expect(defaults.timeoutSeconds).toBe(6000);
    const subagents = defaults.subagents as Record<string, unknown>;
    expect(subagents.maxConcurrent).toBe(20);
    expect(subagents.maxSpawnDepth).toBe(5);
    expect(subagents.maxChildrenPerAgent).toBe(10);
    expect(subagents.runTimeoutSeconds).toBe(36000);

    // hooks.internal with session-memory and command-logger
    const hooks = config.hooks as Record<string, unknown>;
    const internal = hooks.internal as Record<string, unknown>;
    expect(internal.enabled).toBe(true);
    const entries = internal.entries as Record<string, unknown>;
    expect(entries["session-memory"]).toEqual({ enabled: true });
    expect(entries["command-logger"]).toEqual({ enabled: true });

    // tools.exec grants full permissions for skill script execution
    const tools = config.tools as Record<string, unknown>;
    expect(tools.exec).toEqual({ security: "full", ask: "off" });

    // memory: QMD backend with sessions enabled and a docs path
    const memory = config.memory as Record<string, unknown>;
    expect(memory.backend).toBe("qmd");
    const qmd = memory.qmd as Record<string, unknown>;
    expect(qmd.sessions).toEqual({ enabled: true });
    expect(qmd.paths).toEqual([
      { name: "docs", path: "/home/node/.openclaw/data", pattern: "**/*.md" },
    ]);
    // Periodic embed loop is disabled (CPU-only embedding on the default
    // 300M model doesn't fit within OpenClaw's 2-minute default timeout,
    // which otherwise floods logs with `qmd embed timed out` warnings).
    // On-demand embeds get generous timeouts so they can complete.
    expect(qmd.update).toEqual({
      embedInterval: "0",
      embedTimeoutMs: 1_800_000,
      updateTimeoutMs: 600_000,
    });

    // agents.defaults: memorySearch defaults to local provider with
    // text-biased hybrid weights (vector 0.3 / text 0.7) — the semantic
    // side lags on CPU-only hosts so we weight keyword BM25 higher until
    // an embed cycle catches up. `enabled: true` + `store.vector.enabled: true`
    // must be present so the builtin/disabled shape is distinguishable from
    // this one on a casual shape check.
    const memorySearch = defaults.memorySearch as Record<string, unknown>;
    expect(memorySearch.enabled).toBe(true);
    expect(memorySearch.provider).toBe("local");
    expect(memorySearch).not.toHaveProperty("remote");
    expect(memorySearch.store).toEqual({ vector: { enabled: true } });
    expect(memorySearch.sync).toEqual({
      watch: true,
      onSessionStart: true,
      sessions: { deltaBytes: 100000, deltaMessages: 100 },
    });
    const hybrid = (memorySearch.query as Record<string, unknown>).hybrid as Record<string, unknown>;
    expect(hybrid.enabled).toBe(true);
    expect(hybrid.vectorWeight).toBe(0.3);
    expect(hybrid.textWeight).toBe(0.7);
    expect(hybrid.mmr).toEqual({ enabled: true, lambda: 0.7 });
    expect(hybrid.temporalDecay).toEqual({ enabled: true, halfLifeDays: 30 });
    expect(defaults.userTimezone).toBe("America/New_York");

    // cron: enabled with the in-container store path and run-log limits
    const cron = config.cron as Record<string, unknown>;
    expect(cron.enabled).toBe(true);
    expect(cron.store).toBe("~/.openclaw/cron/cron.json");
    expect(cron.maxConcurrentRuns).toBe(3);
    expect(cron.sessionRetention).toBe("24h");
    expect(cron.runLog).toEqual({ maxBytes: "2mb", keepLines: 2000 });

    // plugins.entries.memory-core enables nightly dreaming at 03:00
    const plugins = config.plugins as Record<string, unknown>;
    const pluginEntries = plugins.entries as Record<string, unknown>;
    expect(pluginEntries["memory-core"]).toEqual({
      config: {
        dreaming: {
          enabled: true,
          frequency: "0 3 * * *",
        },
      },
    });
  });

  it("10. buildOpenclawJson with browser disabled has no browser block", () => {
    const config = buildOpenclawJson("ws-10", "tok-456", {
      model: "gpt-4",
      browser: { enabled: false },
    });

    expect(config).not.toHaveProperty("browser");

    // agents.defaults, hooks, memory and cron are always present regardless
    // of browser config; userTimezone falls back to UTC when not provided.
    expect(config).toHaveProperty("agents");
    const agents = config.agents as Record<string, unknown>;
    const defaults = agents.defaults as Record<string, unknown>;
    expect(defaults).toBeDefined();
    expect(defaults.userTimezone).toBe("UTC");
    expect(defaults.memorySearch).toBeDefined();
    expect(config).toHaveProperty("hooks");
    expect(config).toHaveProperty("memory");
    expect(config).toHaveProperty("cron");
  });

  // ── Memory mode matrix ─────────────────────────────────────────────
  //
  // These cases pin the exact JSON the wizard's three memory modes write
  // into openclaw.json. Drift in any of them (default weights, remote
  // endpoint shape, disabled forcing hybrid to text-only) should fail
  // loudly so we catch it before it ships to a live gateway.

  it("11. local memory mode: user toggles sessions and dreaming off", () => {
    const config = buildOpenclawJson("ws-11", "tok", {
      browser: { enabled: false },
      memory: {
        mode: "local",
        sessionsEnabled: false,
        dreamingEnabled: false,
        vectorWeight: 0.5,
        textWeight: 0.5,
      },
    });

    const defaults = (config.agents as Record<string, unknown>).defaults as Record<string, unknown>;
    const search = defaults.memorySearch as Record<string, unknown>;
    expect(search.provider).toBe("local");
    expect(search).not.toHaveProperty("remote");
    const hybrid = (search.query as Record<string, unknown>).hybrid as Record<string, unknown>;
    expect(hybrid.vectorWeight).toBe(0.5);
    expect(hybrid.textWeight).toBe(0.5);

    const memory = config.memory as Record<string, unknown>;
    const qmd = memory.qmd as Record<string, unknown>;
    expect(qmd.sessions).toEqual({ enabled: false });

    const dreaming = (
      ((config.plugins as Record<string, unknown>).entries as Record<string, unknown>)[
      "memory-core"
      ] as Record<string, unknown>
    ).config as Record<string, unknown>;
    expect(dreaming.dreaming).toEqual({ enabled: false, frequency: "0 3 * * *" });
  });

  it("12. remote memory mode: builtin backend + provider + model + remote endpoint override", () => {
    const config = buildOpenclawJson("ws-12", "tok", {
      browser: { enabled: false },
      memory: {
        mode: "remote",
        provider: "openai",
        model: "text-embedding-3-small",
        baseUrl: "https://api.together.xyz/v1/",
        apiKey: "tgp-xxx",
        headers: { "X-Custom": "yes" },
        sessionsEnabled: true,
        dreamingEnabled: true,
        // Remote mode flips the weight bias because a remote provider
        // gives fresh embeddings, unlike the lagging local CPU path.
        vectorWeight: 0.7,
        textWeight: 0.3,
      },
    });

    // Memory backend: builtin — no QMD block at all. Remote providers do
    // the embedding work themselves, so QMD has nothing to do locally.
    const memory = config.memory as Record<string, unknown>;
    expect(memory).toEqual({ backend: "builtin" });

    const search = (
      (config.agents as Record<string, unknown>).defaults as Record<string, unknown>
    ).memorySearch as Record<string, unknown>;
    expect(search.enabled).toBe(true);
    expect(search.provider).toBe("openai");
    // Critical: `model` lives at memorySearch.model, NOT inside .remote.
    expect(search.model).toBe("text-embedding-3-small");
    expect(search.store).toEqual({ vector: { enabled: true } });
    expect(search.sync).toEqual({
      watch: true,
      onSessionStart: true,
      sessions: { deltaBytes: 100000, deltaMessages: 100 },
    });
    // remote block includes batch: { enabled: false } plus user overrides.
    // model must NOT leak into remote — it sits top-level.
    expect(search.remote).toEqual({
      batch: { enabled: false },
      baseUrl: "https://api.together.xyz/v1/",
      apiKey: "tgp-xxx",
      headers: { "X-Custom": "yes" },
    });
    expect((search.remote as Record<string, unknown>)).not.toHaveProperty("model");
    const hybrid = (search.query as Record<string, unknown>).hybrid as Record<string, unknown>;
    expect(hybrid.enabled).toBe(true);
    expect(hybrid.vectorWeight).toBe(0.7);
    expect(hybrid.textWeight).toBe(0.3);
  });

  it("12b. remote memory mode: omits empty optional remote overrides and model", () => {
    // When the user picks a remote provider but doesn't override baseUrl,
    // apiKey, or model, we must NOT write empty strings — doing so would
    // blank out OpenClaw's own provider defaults and break embedding.
    const config = buildOpenclawJson("ws-12b", "tok", {
      browser: { enabled: false },
      memory: {
        mode: "remote",
        provider: "voyage",
        sessionsEnabled: true,
        dreamingEnabled: true,
        vectorWeight: 0.7,
        textWeight: 0.3,
      },
    });

    // Still builtin-backed — no QMD block leaks through when the user picks
    // remote even without endpoint overrides.
    const memory = config.memory as Record<string, unknown>;
    expect(memory).toEqual({ backend: "builtin" });

    const search = (
      (config.agents as Record<string, unknown>).defaults as Record<string, unknown>
    ).memorySearch as Record<string, unknown>;
    expect(search.provider).toBe("voyage");
    expect(search).not.toHaveProperty("model");
    // remote block still present for `batch: { enabled: false }` even
    // when the user didn't supply baseUrl/apiKey overrides.
    expect(search.remote).toEqual({ batch: { enabled: false } });
  });

  it("12c. remote memory mode: model without endpoint overrides writes just memorySearch.model", () => {
    // A user can pin the embedding model ID without supplying a custom
    // baseUrl or apiKey — in that case we skip the `remote` block entirely
    // and only add `model` at the top level.
    const config = buildOpenclawJson("ws-12c", "tok", {
      browser: { enabled: false },
      memory: {
        mode: "remote",
        provider: "openai",
        model: "text-embedding-3-large",
        sessionsEnabled: true,
        dreamingEnabled: true,
        vectorWeight: 0.7,
        textWeight: 0.3,
      },
    });

    const search = (
      (config.agents as Record<string, unknown>).defaults as Record<string, unknown>
    ).memorySearch as Record<string, unknown>;
    expect(search.provider).toBe("openai");
    expect(search.model).toBe("text-embedding-3-large");
    // remote block present for batch even without baseUrl/apiKey.
    expect(search.remote).toEqual({ batch: { enabled: false } });
  });

  it("13. disabled memory mode: switches to builtin backend and sets memorySearch.enabled=false", () => {
    const config = buildOpenclawJson("ws-13", "tok", {
      browser: { enabled: false },
      memory: {
        // User-facing knobs: whatever the wizard posted. Disabled mode
        // should ignore sessions/dreaming/weights entirely — the whole
        // memory backend is swapped to builtin and memorySearch is shut
        // off outright. Anything more (e.g. provider: "none") gets
        // rejected at gateway startup with "Unknown memory embedding
        // provider: none", which is why we write only `enabled: false`.
        mode: "disabled",
        sessionsEnabled: true,
        dreamingEnabled: true,
        vectorWeight: 0.7,
        textWeight: 0.3,
      },
    });

    // memory backend: builtin, no qmd sub-block at all.
    const memory = config.memory as Record<string, unknown>;
    expect(memory).toEqual({ backend: "builtin" });

    const search = (
      (config.agents as Record<string, unknown>).defaults as Record<string, unknown>
    ).memorySearch as Record<string, unknown>;
    expect(search).toEqual({
      enabled: true,
    });

    // Dreaming: plugins.memory-core.config.dreaming is forced off because
    // there's no QMD index to dream into. Frequency string stays set for
    // forward-compat if the user flips back to local mode later.
    const memoryCore = ((config.plugins as Record<string, unknown>).entries as Record<string, unknown>)[
      "memory-core"
    ] as Record<string, unknown>;
    expect((memoryCore.config as Record<string, unknown>).dreaming).toEqual({
      enabled: false,
      frequency: "0 3 * * *",
    });
  });

  it("13b. local mode writes store.vector.enabled=true and hybrid.enabled=true", () => {
    // Regression guard: local/remote mode must keep the enabled flags and
    // the vector store on, otherwise disabled and local would look
    // identical on a shallow shape check.
    const config = buildOpenclawJson("ws-13b", "tok", {
      browser: { enabled: false },
      memory: {
        mode: "local",
        sessionsEnabled: true,
        dreamingEnabled: true,
        vectorWeight: 0.3,
        textWeight: 0.7,
      },
    });

    const search = (
      (config.agents as Record<string, unknown>).defaults as Record<string, unknown>
    ).memorySearch as Record<string, unknown>;
    expect(search.enabled).toBe(true);
    expect(search.store).toEqual({ vector: { enabled: true } });
    expect(search.sync).toEqual({
      watch: true,
      onSessionStart: true,
      sessions: { deltaBytes: 100000, deltaMessages: 100 },
    });
    expect(search).not.toHaveProperty("remote");
    const hybrid = (search.query as Record<string, unknown>).hybrid as Record<string, unknown>;
    expect(hybrid.enabled).toBe(true);

    // Local still uses the QMD backend with the embed guards intact.
    const memory = config.memory as Record<string, unknown>;
    expect(memory.backend).toBe("qmd");
    const qmd = memory.qmd as Record<string, unknown>;
    expect(qmd.update).toEqual({
      embedInterval: "0",
      embedTimeoutMs: 1_800_000,
      updateTimeoutMs: 600_000,
    });
  });
});

describe("resolveMemoryConfig (wizard → openclaw.json defaults)", () => {
  it("returns the text-biased local default when the user didn't touch the wizard", () => {
    const resolved = resolveMemoryConfig(undefined);
    expect(resolved).toEqual({
      mode: "local",
      sessionsEnabled: true,
      dreamingEnabled: true,
      vectorWeight: 0.3,
      textWeight: 0.7,
    });
  });

  it("passes local-mode knobs through verbatim", () => {
    const resolved = resolveMemoryConfig({
      mode: "local",
      sessionsEnabled: false,
      dreamingEnabled: true,
      vectorWeight: 0.9,
      textWeight: 0.1,
    });
    expect(resolved.mode).toBe("local");
    expect(resolved.vectorWeight).toBe(0.9);
    expect(resolved.textWeight).toBe(0.1);
  });

  it("forces disabled mode to zero-vector + dreaming off regardless of user input", () => {
    const resolved = resolveMemoryConfig({
      mode: "disabled",
      sessionsEnabled: true,
      // User typed these in the form but they must be ignored:
      dreamingEnabled: true,
      vectorWeight: 0.8,
      textWeight: 0.2,
    });
    expect(resolved.mode).toBe("disabled");
    expect(resolved.vectorWeight).toBe(0);
    expect(resolved.textWeight).toBe(1);
    expect(resolved.dreamingEnabled).toBe(false);
    // But sessionsEnabled stays as the user asked — FTS still needs session docs.
    expect(resolved.sessionsEnabled).toBe(true);
  });

  it("passes remote endpoint overrides through verbatim", () => {
    const resolved = resolveMemoryConfig({
      mode: "remote",
      provider: "voyage",
      model: "voyage-3",
      baseUrl: "https://api.voyageai.com/v1",
      apiKey: "sk-test",
      headers: { "X-Org": "acme" },
      sessionsEnabled: true,
      dreamingEnabled: true,
      vectorWeight: 0.4,
      textWeight: 0.6,
    });
    expect(resolved.mode).toBe("remote");
    if (resolved.mode !== "remote") throw new Error("wrong mode");
    expect(resolved.provider).toBe("voyage");
    expect(resolved.model).toBe("voyage-3");
    expect(resolved.baseUrl).toBe("https://api.voyageai.com/v1");
    expect(resolved.apiKey).toBe("sk-test");
    expect(resolved.headers).toEqual({ "X-Org": "acme" });
  });
});
