import { IMAGES } from "../docker/DockerClient.js";
import { getExecutor } from "../runtime/executor.js";
import { getRuntime } from "../runtime/workspace-runtime.js";
import { detectWorkspaceContainers } from "./WorkspaceDetector.js";
import {
  generateToken,
  getDataDir,
  writeWorkspaceToDisk,
  loadWorkspaceFromDisk,
  patchOpcifyApiKeyInOpenclawJson,
  writeOpcifyApiKeyToDisk,
} from "./WorkspaceConfig.js";
import { getOpcifyCallbackUrl, getOpcifyCallbackToken } from "./opcify-url.js";
import type {
  Workspace,
  WorkspaceUserConfig,
  WorkspaceDockerState,
  WorkspaceHealth,
  EnsureResult,
} from "./types.js";
import { createLogger } from "../logger.js";

const log = createLogger("workspace-service");

// ─── In-memory workspace registry ───────────────────────────────────

const workspaces = new Map<string, Workspace>();

// ─── WorkspaceService ───────────────────────────────────────────────

export class WorkspaceService {
  // ── Public methods ──────────────────────────────────────────────

  async create(
    workspaceId: string,
    userConfig: WorkspaceUserConfig = {},
  ): Promise<Workspace> {
    if (workspaces.has(workspaceId)) {
      throw Object.assign(
        new Error(`Workspace "${workspaceId}" already exists`),
        { statusCode: 409 },
      );
    }

    // Reject if Docker containers already exist (naming conflict)
    const existing = await detectWorkspaceContainers(workspaceId);
    if (existing.gateway !== "missing" || existing.network) {
      throw Object.assign(
        new Error(
          `Docker resources for workspace "${workspaceId}" already exist. ` +
            `Use ensureContainers to recover, or delete first.`,
        ),
        { statusCode: 409 },
      );
    }

    const token = generateToken();
    const dataDir = getDataDir(workspaceId);

    // Pre-seed the in-memory workspace so chat service calls made during
    // provisioning can see it. gatewayUrl is placeholder until runtime.create
    // returns the real URL (host port in Docker, Service DNS in K8s).
    const workspace: Workspace = {
      id: workspaceId,
      token,
      status: "creating",
      gatewayUrl: "",
      gatewayPort: 0,
      createdAt: new Date(),
      dataDir,
      userConfig,
    };
    workspaces.set(workspaceId, workspace);

    try {
      await getRuntime().ensureImage(IMAGES.gateway);

      // writeWorkspaceToDisk seeds opcify-meta.json + openclaw.json so the
      // runtime can bind-mount / hostPath-mount that directory. The persisted
      // port field will be populated with the real value below if Docker mode
      // allocated one.
      await writeWorkspaceToDisk(workspaceId, token, userConfig, undefined);
      const { gatewayUrl, gatewayHostPort } = await this.createContainersFromConfig(
        workspaceId,
        token,
        userConfig,
      );

      workspace.gatewayUrl = gatewayUrl;
      if (gatewayHostPort !== undefined) {
        workspace.gatewayPort = gatewayHostPort;
        // Persist the allocated port so recovery-from-disk can reuse it.
        await writeWorkspaceToDisk(workspaceId, token, userConfig, gatewayHostPort);
      }
      workspace.status = "running";
      log.info(`Workspace "${workspaceId}" created — gateway at ${gatewayUrl}`);
      return workspace;
    } catch (err) {
      workspace.status = "error";
      const message = err instanceof Error ? err.message : "Unknown error";
      log.error(`Failed to create workspace "${workspaceId}": ${message}`);
      throw err;
    }
  }

  async ensureContainers(workspaceId: string): Promise<EnsureResult> {
    const state = await detectWorkspaceContainers(workspaceId);

    // Gateway running
    if (state.gateway === "running") {
      await this.registerFromContainer(workspaceId, "running");
      return { action: "already_running", state };
    }

    // Gateway stopped — restart
    if (state.gateway === "stopped") {
      await this.startExistingContainers(workspaceId, state);
      await this.registerFromContainer(workspaceId, "running");
      const newState = await detectWorkspaceContainers(workspaceId);
      return { action: "restarted", state: newState };
    }

    // Gateway missing — recreate from disk config
    const meta = await loadWorkspaceFromDisk(workspaceId);
    if (!meta) {
      throw new Error(
        `Cannot recover workspace "${workspaceId}": ` +
          `containers are missing and no opcify-meta.json found on disk. ` +
          `The workspace must be recreated manually.`,
      );
    }

    const { gatewayUrl, gatewayHostPort } = await this.createContainersFromConfig(
      workspaceId,
      meta.token,
      meta.userConfig,
    );

    if (gatewayHostPort !== undefined && gatewayHostPort !== meta.gatewayPort) {
      // Port changed (couldn't reuse the persisted value) — re-persist.
      await writeWorkspaceToDisk(
        workspaceId,
        meta.token,
        meta.userConfig,
        gatewayHostPort,
      );
    }

    const ws: Workspace = {
      id: workspaceId,
      token: meta.token,
      status: "running",
      gatewayUrl,
      gatewayPort: gatewayHostPort ?? 0,
      createdAt: new Date(),
      dataDir: getDataDir(workspaceId),
      userConfig: meta.userConfig,
    };
    workspaces.set(workspaceId, ws);

    const newState = await detectWorkspaceContainers(workspaceId);
    return { action: "recreated", state: newState };
  }

  async start(workspaceId: string): Promise<void> {
    await this.ensureContainers(workspaceId);
  }

  async stop(workspaceId: string): Promise<void> {
    const state = await detectWorkspaceContainers(workspaceId);

    if (state.gateway === "running") {
      log.info(`Stopping gateway for workspace "${workspaceId}"`);
      await getRuntime().stop(workspaceId, 10);
    }

    const ws = workspaces.get(workspaceId);
    if (ws) ws.status = "stopped";
  }

  async delete(
    workspaceId: string,
    keepData: boolean = false,
  ): Promise<void> {
    const ws = workspaces.get(workspaceId);
    if (ws) ws.status = "deleting";

    // Tear down all runtime resources (container/deployment/service/network).
    await getRuntime().delete(workspaceId);

    // Delete data directory
    if (!keepData) {
      const dataDir = getDataDir(workspaceId);
      try {
        const { rm } = await import("node:fs/promises");
        await rm(dataDir, { recursive: true, force: true });
        log.info(`Deleted data directory ${dataDir}`);
      } catch {
        log.warn(`Could not delete data directory ${dataDir}`);
      }
    }

    workspaces.delete(workspaceId);
    log.info(`Workspace "${workspaceId}" deleted`);
  }

  async health(workspaceId: string): Promise<WorkspaceHealth> {
    const state = await detectWorkspaceContainers(workspaceId);

    const mapState = (
      s: "running" | "stopped" | "missing",
    ): "healthy" | "unhealthy" | "unreachable" => {
      if (s === "running") return "healthy";
      if (s === "stopped") return "unhealthy";
      return "unreachable";
    };

    const result: WorkspaceHealth = {
      workspaceId,
      gateway: mapState(state.gateway),
      browser: "healthy", // browser-use CLI runs inside gateway
    };

    // Check gateway health via HTTP when an exposed host port is available
    // (Docker mode). K8s mode relies on the runtime's readiness poll — the
    // Deployment is already verified Ready by runtime.create/start, and a
    // separate in-cluster HTTP probe from the API pod would need cluster DNS
    // that tests don't mock. Running state alone is the signal there.
    const ws = workspaces.get(workspaceId);
    if (state.gateway === "running" && ws && ws.gatewayPort) {
      try {
        const res = await fetch(`http://localhost:${ws.gatewayPort}/healthz`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = (await res.json()) as { uptime?: number };
          result.gatewayUptime = data.uptime;
        } else {
          result.gateway = "unhealthy";
        }
      } catch {
        result.gateway = "unhealthy";
      }
    }

    return result;
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    return workspaces.get(workspaceId);
  }

  listWorkspaces(): Workspace[] {
    return Array.from(workspaces.values());
  }

  // ── Private methods ─────────────────────────────────────────────

  private async createContainersFromConfig(
    workspaceId: string,
    token: string,
    userConfig: WorkspaceUserConfig,
  ): Promise<{ gatewayUrl: string; gatewayHostPort: number | undefined }> {
    const gatewayCfg = userConfig.gateway ?? {};
    const memoryMB = gatewayCfg.memory ?? 4096;
    const cpuCores = gatewayCfg.cpu ?? 2;

    // Inject OPCIFY_* env vars so every bash subprocess the agent spawns
    // can reach the Opcify API. The opcify skill env block in openclaw.json
    // only applies to skill invocations, not shell commands — this is the
    // only place these vars become visible to ad-hoc curl calls.
    const meta = await loadWorkspaceFromDisk(workspaceId);
    const opcifyKey = getOpcifyCallbackToken(meta);

    // When the wizard's Memory step picked "QMD Memory Engine (Local CPU)",
    // tell the entrypoint-wrapper.sh to run `npm install -g @tobilu/qmd` on
    // first boot. QMD pulls down a ~300M local GGUF model so we skip the
    // install entirely for workspaces that use the Markdown File (builtin)
    // default or Remote Embedding Engine.
    const needsQmd = userConfig.memory?.mode === "local";

    const env: Record<string, string> = {
      GATEWAY_TOKEN: token,
      NODE_COMPILE_CACHE: "/var/tmp/openclaw-compile-cache",
      OPENCLAW_NO_RESPAWN: "1",
      TZ: userConfig.timezone ?? "UTC",
      OPCIFY_API_URL: getOpcifyCallbackUrl(),
      OPCIFY_WORKSPACE_ID: workspaceId,
      ...(opcifyKey ? { OPCIFY_API_KEY: opcifyKey } : {}),
      ...(needsQmd ? { OPCIFY_INSTALL_QMD: "1" } : {}),
      ...(userConfig.env ?? {}),
    };

    log.info(`Provisioning gateway runtime for workspace "${workspaceId}"`);
    const result = await getRuntime().create({
      workspaceId,
      image: IMAGES.gateway,
      env,
      memoryMB,
      cpuCores,
      dataDir: getDataDir(workspaceId),
    });

    // Best-effort: create the Node compile cache directory inside the
    // gateway container.
    try {
      await getExecutor().exec(workspaceId, [
        "mkdir",
        "-p",
        "/var/tmp/openclaw-compile-cache",
      ]);
    } catch {
      log.warn("Could not create compile cache directory in container");
    }

    // Gateway readiness. In Docker mode we poll the in-container loopback
    // (:18790) via exec, then the host port (:18789) via HTTP, because
    // docker.start() returns before the gateway inside is actually listening.
    // In K8s mode, runtime.create() already blocked on
    // `deployment.status.readyReplicas >= 1`, which fires only after the
    // pod's readinessProbe (tcpSocket:18789) succeeded — an equivalent
    // signal — so skip the redundant exec probe.
    if (result.gatewayHostPort !== undefined) {
      await this.waitForGatewayInternal(workspaceId);
      await this.waitForGateway(workspaceId, result.gatewayHostPort);
    }

    // Install opcify skill — always enabled for all workspaces.
    await this.installOpcifySkill(workspaceId);

    // Install browser-use skill (CLI + Chromium are baked into the image,
    // but the skill metadata needs to be copied into the mounted workspace dir).
    if (userConfig.browser?.enabled !== false) {
      await this.installBrowserUseSkill(workspaceId);
    }

    return { gatewayUrl: result.gatewayUrl, gatewayHostPort: result.gatewayHostPort };
  }

  private async startExistingContainers(
    workspaceId: string,
    state: WorkspaceDockerState,
  ): Promise<void> {
    if (state.gateway === "stopped") {
      log.info(`Starting gateway for workspace "${workspaceId}"`);
      await getRuntime().start(workspaceId);
    }

    // Docker-only readiness probe (see createContainersFromConfig for why
    // K8s doesn't need it).
    const ws = workspaces.get(workspaceId);
    const hostPort = ws?.gatewayPort ?? (await this.getGatewayHostPort(workspaceId));
    if (hostPort) {
      await this.waitForGatewayInternal(workspaceId);
      await this.waitForGateway(workspaceId, hostPort);
    }
  }

  /**
   * Verify the opcify skill is installed on the gateway. The SKILL.md and
   * _meta.json were already written to the workspace directory during
   * writeWorkspaceToDisk() — this just confirms they're visible inside
   * the container (via the bind mount).
   */
  private async installOpcifySkill(workspaceId: string): Promise<void> {
    try {
      const { stdout } = await getExecutor().exec(workspaceId, [
        "sh",
        "-c",
        "test -f /home/node/.openclaw/skills/opcify/SKILL.md && echo installed",
      ]);

      if (stdout.trim() === "installed") {
        log.info(`opcify skill verified for workspace "${workspaceId}"`);
      } else {
        log.warn(`opcify skill SKILL.md not found in container for workspace "${workspaceId}" — skill may not appear in list`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Could not verify opcify skill in workspace "${workspaceId}": ${msg}`);
    }
  }

  /**
   * Verify the browser-use skill is installed on the gateway.
   * The SKILL.md and _meta.json are copied to the workspace directory during
   * writeWorkspaceToDisk() (browser-use is a managed skill) — this just
   * confirms they're visible inside the container via the bind mount.
   */
  private async installBrowserUseSkill(workspaceId: string): Promise<void> {
    try {
      const { stdout } = await getExecutor().exec(workspaceId, [
        "sh",
        "-c",
        "test -f /home/node/.openclaw/skills/browser-use/SKILL.md && echo installed",
      ]);

      if (stdout.trim() === "installed") {
        log.info(`browser-use skill verified for workspace "${workspaceId}"`);
      } else {
        log.warn(`browser-use skill SKILL.md not found in container for workspace "${workspaceId}" — skill may not appear in list`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Could not verify browser-use skill in workspace "${workspaceId}": ${msg}`);
    }
  }

  /**
   * Wait for the gateway to become healthy on its internal loopback port (18790)
   * by polling via the runtime exec backend.
   */
  private async waitForGatewayInternal(
    workspaceId: string,
    timeoutMs: number = 90000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    log.info(
      `Waiting for gateway internal healthcheck on 127.0.0.1:18790 (timeout: ${timeoutMs}ms)`,
    );

    while (Date.now() < deadline) {
      try {
        const { stdout, exitCode } = await getExecutor().exec(workspaceId, [
          "node",
          "-e",
          `require("http").get("http://127.0.0.1:18790/healthz",r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>{console.log(d);process.exit(0)})}).on("error",()=>process.exit(1))`,
        ]);
        if (exitCode === 0 && stdout.length > 0) {
          log.info(`Gateway internal healthcheck passed for workspace "${workspaceId}"`);
          return;
        }
      } catch {
        // Not ready yet
      }
      await sleep(2000);
    }

    throw new Error(
      `Gateway internal health check timed out after ${timeoutMs}ms for workspace "${workspaceId}".`,
    );
  }

  private async waitForGateway(
    workspaceId: string,
    hostPort: number,
    timeoutMs: number = 90000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    log.info(
      `Waiting for gateway healthcheck at http://localhost:${hostPort}/healthz (timeout: ${timeoutMs}ms)`,
    );

    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://localhost:${hostPort}/healthz`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          log.info(
            `Gateway for workspace "${workspaceId}" is healthy at port ${hostPort}`,
          );
          return;
        }
      } catch {
        // Not ready yet
      }
      await sleep(1000);
    }

    throw new Error(
      `Gateway health check timed out after ${timeoutMs}ms for workspace "${workspaceId}". ` +
        `Check logs with: docker logs openclaw-gateway-${workspaceId}`,
    );
  }

  private async registerFromContainer(
    workspaceId: string,
    status: "running" | "stopped",
  ): Promise<void> {
    if (workspaces.has(workspaceId)) return;

    const runtime = getRuntime();
    const [gatewayUrl, inspected, meta] = await Promise.all([
      runtime.getGatewayUrl(workspaceId),
      runtime.inspect(workspaceId),
      loadWorkspaceFromDisk(workspaceId),
    ]);

    // Heal any drift between the on-disk Opcify callback token and the one
    // baked into the running gateway's env. The container env is the source
    // of truth for any ad-hoc bash `curl` commands agents run. Syncing disk
    // → container would be disruptive (requires recreate), so we go the
    // other way: if they disagree, update disk to match.
    if (status === "running") {
      await this.syncOpcifyApiKeyFromRuntime(workspaceId, meta?.opcifyApiKey).catch(
        (err) => {
          log.warn(
            `Opcify API key sync failed for "${workspaceId}"`,
            { error: err instanceof Error ? err.message : String(err) },
          );
        },
      );
    }

    workspaces.set(workspaceId, {
      id: workspaceId,
      token: meta?.token ?? "",
      status,
      gatewayUrl: gatewayUrl ?? "",
      gatewayPort: inspected.gatewayHostPort ?? 0,
      createdAt: new Date(),
      dataDir: getDataDir(workspaceId),
      userConfig: meta?.userConfig ?? {},
    });
  }

  /**
   * Read `OPCIFY_API_KEY` from the running gateway and propagate it back to
   * on-disk `opcify-meta.json` + `openclaw.json` if they disagree. Container
   * wins — the env var is baked at provisioning time and cannot change
   * without a recreate; agents are already using that value.
   */
  private async syncOpcifyApiKeyFromRuntime(
    workspaceId: string,
    diskKey: string | undefined,
  ): Promise<void> {
    const containerKey = await getRuntime().readEnvVar(workspaceId, "OPCIFY_API_KEY");
    if (!containerKey) return;
    if (containerKey === diskKey) return;

    log.warn(
      `Opcify API key drift detected for "${workspaceId}" — ` +
        `disk had a different value than the running gateway. ` +
        `Syncing disk to match so agent callbacks keep working.`,
    );

    if (diskKey !== undefined) {
      await writeOpcifyApiKeyToDisk(workspaceId, containerKey);
    }
    await patchOpcifyApiKeyInOpenclawJson(workspaceId, containerKey);
  }

  private async getGatewayHostPort(workspaceId: string): Promise<number | null> {
    const inspected = await getRuntime().inspect(workspaceId);
    return inspected.gatewayHostPort ?? null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Singleton ──────────────────────────────────────────────────────

export const workspaceService = new WorkspaceService();
