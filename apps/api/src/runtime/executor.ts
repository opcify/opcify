import { createLogger } from "../logger.js";
import { DockerExecutor } from "./docker-executor.js";
import { K8sExecutor } from "./k8s-executor.js";

const log = createLogger("runtime");

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ContainerExecutor {
  exec(workspaceId: string, cmd: string[]): Promise<ExecResult>;
}

export type RuntimeMode = "docker" | "k8s";

function resolveMode(): RuntimeMode {
  const raw = (process.env.OPCIFY_RUNTIME_MODE ?? "docker").toLowerCase();
  if (raw === "k8s" || raw === "kubernetes") return "k8s";
  return "docker";
}

let singleton: ContainerExecutor | null = null;

export function getExecutor(): ContainerExecutor {
  if (singleton) return singleton;
  const mode = resolveMode();
  if (mode === "k8s") {
    log.info("Runtime mode: k8s — using Kubernetes Exec API");
    singleton = new K8sExecutor();
  } else {
    log.info("Runtime mode: docker — using Dockerode exec");
    singleton = new DockerExecutor();
  }
  return singleton;
}

export function __resetExecutorForTests(): void {
  singleton = null;
}
