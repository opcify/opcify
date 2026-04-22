import { PassThrough } from "node:stream";
import {
  CoreV1Api,
  Exec,
  KubeConfig,
  type V1Status,
} from "@kubernetes/client-node";
import { createLogger } from "../logger.js";
import type { ContainerExecutor, ExecResult } from "./executor.js";

const log = createLogger("runtime-k8s");

const POD_CACHE_TTL_MS = 30_000;
const WORKSPACE_LABEL = "opcify.workspace";

/**
 * Exec backend backed by the Kubernetes Exec API
 * (`/api/v1/namespaces/{ns}/pods/{pod}/exec`, SPDY/WebSocket).
 *
 * Selected when OPCIFY_RUNTIME_MODE=k8s. Requires the Opcify pod's
 * ServiceAccount to have `pods/exec` RBAC in OPCIFY_K8S_NAMESPACE.
 *
 * The K8s API exec endpoint takes a concrete Pod name (the Deployment's
 * ReplicaSet suffixes a hash + random string), so we resolve each
 * workspace's gateway pod by its `opcify.workspace=<wsId>` label the
 * runtime sets when provisioning. The resolution is cached for 30s so
 * repeated execs don't spam the API server.
 */
export class K8sExecutor implements ContainerExecutor {
  private kubeConfig: KubeConfig | null = null;
  private execClient: Exec | null = null;
  private coreClient: CoreV1Api | null = null;
  private podCache = new Map<string, { name: string; expiresAt: number }>();

  private ensureKube(): KubeConfig {
    if (!this.kubeConfig) {
      this.kubeConfig = new KubeConfig();
      this.kubeConfig.loadFromDefault();
    }
    return this.kubeConfig;
  }

  private get client(): Exec {
    if (this.execClient) return this.execClient;
    this.execClient = new Exec(this.ensureKube());
    return this.execClient;
  }

  private get core(): CoreV1Api {
    if (this.coreClient) return this.coreClient;
    this.coreClient = this.ensureKube().makeApiClient(CoreV1Api);
    return this.coreClient;
  }

  private get namespace(): string {
    return process.env.OPCIFY_K8S_NAMESPACE || "openclaw";
  }

  private get containerName(): string {
    return process.env.OPCIFY_K8S_GATEWAY_CONTAINER || "gateway";
  }

  /**
   * Resolve the concrete Pod name for a workspace by label selector.
   * Falls back to the Deployment-name-as-Pod-name only if no matching
   * pod is found (lets Docker-mode tests / single-pod deployments work).
   */
  private async resolvePodName(workspaceId: string): Promise<string> {
    const cached = this.podCache.get(workspaceId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.name;

    try {
      const list = await this.core.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: `${WORKSPACE_LABEL}=${workspaceId}`,
      });
      const running = (list.items ?? []).find(
        (p) => p.status?.phase === "Running" && p.metadata?.name,
      );
      const anyItem = (list.items ?? []).find((p) => p.metadata?.name);
      const pod = running ?? anyItem;
      if (pod?.metadata?.name) {
        this.podCache.set(workspaceId, {
          name: pod.metadata.name,
          expiresAt: now + POD_CACHE_TTL_MS,
        });
        return pod.metadata.name;
      }
    } catch (err) {
      log.warn(`listNamespacedPod failed for ${workspaceId}: ${describeError(err)}`);
    }
    return `openclaw-gateway-${workspaceId}`;
  }

  private invalidatePodCache(workspaceId: string): void {
    this.podCache.delete(workspaceId);
  }

  async exec(workspaceId: string, cmd: string[]): Promise<ExecResult> {
    const podName = await this.resolvePodName(workspaceId);
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    stdoutStream.on("data", (c: Buffer) => stdoutChunks.push(c));
    stderrStream.on("data", (c: Buffer) => stderrChunks.push(c));

    const stdoutDone = new Promise<void>((r) => {
      stdoutStream.once("end", r);
      stdoutStream.once("close", r);
    });
    const stderrDone = new Promise<void>((r) => {
      stderrStream.once("end", r);
      stderrStream.once("close", r);
    });

    let capturedStatus: V1Status = { status: "Failure", message: "exec did not report status" };

    try {
      const ws = await this.client.exec(
        this.namespace,
        podName,
        this.containerName,
        cmd,
        stdoutStream,
        stderrStream,
        null,
        false,
        (status) => {
          capturedStatus = status;
        },
      );
      await new Promise<void>((resolve, reject) => {
        ws.on("close", () => resolve());
        ws.on("error", (err: Error) => reject(err));
      });
    } catch (err) {
      const msg = describeError(err);
      log.warn(`k8s exec failed on ${this.namespace}/${podName}: ${msg}`);
      // 404 means the pod name is stale (Deployment rolled, old pod gone).
      // Drop the cached name so the next call re-resolves.
      if (msg.includes("404")) this.invalidatePodCache(workspaceId);
      stdoutStream.destroy();
      stderrStream.destroy();
      throw err instanceof Error ? err : new Error(msg);
    } finally {
      stdoutStream.end();
      stderrStream.end();
    }

    await Promise.all([stdoutDone, stderrDone]);

    const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
    const stderr = Buffer.concat(stderrChunks).toString("utf-8");
    const exitCode = parseExitCode(capturedStatus);

    if (exitCode !== 0) {
      log.info(
        `k8s exec non-zero: ns=${this.namespace} pod=${podName} code=${exitCode} reason=${capturedStatus.reason ?? ""}`,
      );
    }

    return { stdout, stderr, exitCode };
  }
}

/**
 * Map a V1Status from the Kubernetes exec subresource to a numeric exit code.
 *
 * Success case: `status.status === "Success"` → 0.
 *
 * Failure case: kubelet reports `reason: "NonZeroExitCode"` with
 * `details.causes[]` containing `{ reason: "ExitCode", message: "<n>" }`.
 * Fall back to 1 if parsing fails.
 */
function parseExitCode(status: V1Status): number {
  if (status.status === "Success") return 0;
  const cause = status.details?.causes?.find((c) => c.reason === "ExitCode");
  if (cause?.message) {
    const parsed = Number.parseInt(cause.message, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 1;
}

/**
 * Extract a useful message out of anything a WS exec can reject with.
 *
 * The `ws` library's `onerror` hands back an ErrorEvent whose `.message` and
 * `.error` hold the actual cause — a plain `String(err)` on that just gives
 * "[object Object]". Walk through the common shapes.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as {
      message?: unknown;
      code?: unknown;
      error?: { message?: unknown };
      reason?: unknown;
      type?: unknown;
    };
    if (typeof e.message === "string" && e.message) return e.message;
    if (e.error && typeof e.error.message === "string") return e.error.message;
    const parts: string[] = [];
    if (e.type) parts.push(`type=${String(e.type)}`);
    if (e.code) parts.push(`code=${String(e.code)}`);
    if (e.reason) parts.push(`reason=${String(e.reason)}`);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
