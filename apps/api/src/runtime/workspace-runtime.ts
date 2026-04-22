import { createLogger } from "../logger.js";
import { DockerRuntime } from "./docker-runtime.js";
import { K8sRuntime } from "./k8s-runtime.js";

const log = createLogger("workspace-runtime");

// ─── Runtime mode (shared with ContainerExecutor) ────────────────────

export type RuntimeMode = "docker" | "k8s";

function resolveMode(): RuntimeMode {
  const raw = (process.env.OPCIFY_RUNTIME_MODE ?? "docker").toLowerCase();
  if (raw === "k8s" || raw === "kubernetes") return "k8s";
  return "docker";
}

// ─── Types ───────────────────────────────────────────────────────────

export interface CreateWorkspaceInput {
  workspaceId: string;
  image: string;
  env: Record<string, string>;
  memoryMB: number;
  cpuCores: number;
  /** Docker: host path bind-mounted into the container.
   *  K8s:    host-node path used via hostPath volume. */
  dataDir: string;
}

export interface CreateWorkspaceResult {
  /** URL for GatewayWsClient to connect to the new gateway. */
  gatewayUrl: string;
  /** Docker-only — persisted to opcify-meta.json so the port is reused across restarts. */
  gatewayHostPort?: number;
}

export type ContainerState = "running" | "stopped" | "missing";

export interface WorkspaceInspectResult {
  gateway: ContainerState;
  /** Docker-only — port binding the gateway container is currently using. */
  gatewayHostPort?: number;
  /** Docker-only — network existence. Always true for K8s mode. */
  networkExists: boolean;
}

export interface WorkspaceRuntime {
  /** Ensure the gateway image is available. No-op on K8s (kubelet handles pulls). */
  ensureImage(image: string): Promise<void>;

  /** Provision + start the per-workspace gateway. Blocks until reachable. */
  create(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult>;

  /** Start an existing (stopped) gateway. */
  start(workspaceId: string): Promise<void>;

  /** Gracefully stop the gateway. */
  stop(workspaceId: string, gracefulTimeoutSec?: number): Promise<void>;

  /** Tear down the gateway (resource removal). */
  delete(workspaceId: string): Promise<void>;

  /** Read current runtime state. Returns `missing` when nothing exists yet. */
  inspect(workspaceId: string): Promise<WorkspaceInspectResult>;

  /** List workspace ids discovered at startup (matches the naming convention). */
  listWorkspaceIds(): Promise<string[]>;

  /** Resolve the WS RPC URL for an existing gateway (nullable if not found). */
  getGatewayUrl(workspaceId: string): Promise<string | null>;

  /** Read a single env var from the existing gateway's spec (null if not present). */
  readEnvVar(workspaceId: string, name: string): Promise<string | null>;
}

// ─── Singleton factory ───────────────────────────────────────────────

let singleton: WorkspaceRuntime | null = null;

export function getRuntime(): WorkspaceRuntime {
  if (singleton) return singleton;
  const mode = resolveMode();
  if (mode === "k8s") {
    log.info("Workspace runtime: k8s — using Kubernetes Deployments/Services");
    singleton = new K8sRuntime();
  } else {
    log.info("Workspace runtime: docker — using Dockerode lifecycle");
    singleton = new DockerRuntime();
  }
  return singleton;
}

export function __resetRuntimeForTests(): void {
  singleton = null;
}
