import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  ApiException,
  PatchStrategy,
  setHeaderOptions,
  type V1Deployment,
  type V1Service,
} from "@kubernetes/client-node";
import { containerNames } from "../workspace/WorkspaceConfig.js";
import { createLogger } from "../logger.js";
import type {
  CreateWorkspaceInput,
  CreateWorkspaceResult,
  WorkspaceInspectResult,
  WorkspaceRuntime,
} from "./workspace-runtime.js";

const log = createLogger("k8s-runtime");

const GATEWAY_PORT = 18789;
const WORKSPACE_LABEL = "opcify.workspace";
const APP_LABEL_VALUE = "openclaw-gateway";
const DEPLOYMENT_READY_TIMEOUT_MS = 120_000;
const DEPLOYMENT_POLL_INTERVAL_MS = 2_000;

/**
 * Runtime backed by the Kubernetes API. Used when `OPCIFY_RUNTIME_MODE=k8s`.
 *
 * Each workspace becomes one Deployment + one Service in `OPCIFY_K8S_NAMESPACE`
 * (default `openclaw`). Names mirror the Docker naming convention so both
 * runtimes can co-exist in the same codebase.
 *
 * Volume strategy: workspace data lives on a hostPath node volume shared
 * between the opcify-api pod and the gateway pod (`/var/opcify/workspaces/<id>`).
 * This requires both pods to be scheduled on the same node, so the Deployment
 * carries the same `nodeSelector` the API pod uses. See k8s/README.md for
 * the prod story (ReadWriteMany PVC).
 */
export class K8sRuntime implements WorkspaceRuntime {
  private kc: KubeConfig | null = null;
  private appsClient: AppsV1Api | null = null;
  private coreClient: CoreV1Api | null = null;

  private get apps(): AppsV1Api {
    if (!this.appsClient) {
      this.appsClient = this.getKubeConfig().makeApiClient(AppsV1Api);
    }
    return this.appsClient;
  }

  private get core(): CoreV1Api {
    if (!this.coreClient) {
      this.coreClient = this.getKubeConfig().makeApiClient(CoreV1Api);
    }
    return this.coreClient;
  }

  private getKubeConfig(): KubeConfig {
    if (!this.kc) {
      this.kc = new KubeConfig();
      this.kc.loadFromDefault();
    }
    return this.kc;
  }

  private get namespace(): string {
    return process.env.OPCIFY_K8S_NAMESPACE || "openclaw";
  }

  private get containerName(): string {
    return process.env.OPCIFY_K8S_GATEWAY_CONTAINER || "gateway";
  }

  private get nodeSelectorLabel(): string {
    return process.env.OPCIFY_K8S_NODE_SELECTOR_LABEL || "opcify.io/node-role";
  }

  private get nodeSelectorValue(): string {
    return process.env.OPCIFY_K8S_NODE_SELECTOR_VALUE || "data";
  }

  private get hostPathRoot(): string {
    return process.env.OPCIFY_K8S_HOSTPATH_ROOT || "/var/opcify/workspaces";
  }

  async ensureImage(_image: string): Promise<void> {
    // No-op: kubelet pulls images on scheduling.
  }

  async create(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
    const name = containerNames(input.workspaceId).gateway;
    const deployment = this.buildDeployment(input, name);
    const service = this.buildService(input.workspaceId, name);

    try {
      await this.apps.createNamespacedDeployment({ namespace: this.namespace, body: deployment });
    } catch (err) {
      if (!isAlreadyExists(err)) throw wrapApi(err, `create deployment ${name}`);
      log.info(`Deployment ${name} already exists — skipping create`);
    }

    try {
      await this.core.createNamespacedService({ namespace: this.namespace, body: service });
    } catch (err) {
      if (!isAlreadyExists(err)) throw wrapApi(err, `create service ${name}`);
      log.info(`Service ${name} already exists — skipping create`);
    }

    await this.waitForDeploymentReady(name);

    return {
      gatewayUrl: this.gatewayUrlFor(input.workspaceId),
    };
  }

  async start(workspaceId: string): Promise<void> {
    const name = containerNames(workspaceId).gateway;
    await this.patchReplicas(name, 1);
    await this.waitForDeploymentReady(name);
  }

  async stop(workspaceId: string, _gracefulTimeoutSec?: number): Promise<void> {
    const name = containerNames(workspaceId).gateway;
    try {
      await this.patchReplicas(name, 0);
    } catch (err) {
      if (isNotFound(err)) return;
      throw wrapApi(err, `scale deployment ${name} to 0`);
    }
  }

  async delete(workspaceId: string): Promise<void> {
    const name = containerNames(workspaceId).gateway;

    try {
      await this.apps.deleteNamespacedDeployment({
        name,
        namespace: this.namespace,
        propagationPolicy: "Foreground",
      });
      log.info(`Deleted deployment ${name}`);
    } catch (err) {
      if (!isNotFound(err)) log.warn(`delete deployment ${name}: ${errMsg(err)}`);
    }

    try {
      await this.core.deleteNamespacedService({ name, namespace: this.namespace });
      log.info(`Deleted service ${name}`);
    } catch (err) {
      if (!isNotFound(err)) log.warn(`delete service ${name}: ${errMsg(err)}`);
    }
  }

  async inspect(workspaceId: string): Promise<WorkspaceInspectResult> {
    const name = containerNames(workspaceId).gateway;
    try {
      const dep = await this.apps.readNamespacedDeployment({ name, namespace: this.namespace });
      const ready = dep.status?.readyReplicas ?? 0;
      // `networkExists` is overloaded in WorkspaceService: it's used both to
      // detect "is there scaffolding to tear down" and as a create-guard that
      // trips when *any* resource for this workspace already exists. On K8s
      // we have no network object, so tie it to Deployment presence — that
      // way create() runs clean on first provision and delete() still sees
      // the resource to reap.
      return {
        gateway: ready >= 1 ? "running" : "stopped",
        networkExists: true,
      };
    } catch (err) {
      if (isNotFound(err)) {
        return { gateway: "missing", networkExists: false };
      }
      throw wrapApi(err, `inspect deployment ${name}`);
    }
  }

  async listWorkspaceIds(): Promise<string[]> {
    try {
      const list = await this.apps.listNamespacedDeployment({
        namespace: this.namespace,
        labelSelector: `app.kubernetes.io/name=${APP_LABEL_VALUE}`,
      });
      const prefix = "openclaw-gateway-";
      const ids: string[] = [];
      for (const item of list.items ?? []) {
        const n = item.metadata?.name;
        if (n && n.startsWith(prefix)) ids.push(n.slice(prefix.length));
      }
      return ids;
    } catch (err) {
      log.warn(`listNamespacedDeployment failed: ${errMsg(err)}`);
      return [];
    }
  }

  async getGatewayUrl(workspaceId: string): Promise<string | null> {
    // Deterministic from the naming convention — no API call needed.
    // Return null only if the deployment is confirmed missing so the caller
    // can fall back cleanly (mirrors DockerRuntime.getGatewayUrl semantics).
    const state = await this.inspect(workspaceId);
    if (state.gateway === "missing") return null;
    return this.gatewayUrlFor(workspaceId);
  }

  async readEnvVar(workspaceId: string, name: string): Promise<string | null> {
    const depName = containerNames(workspaceId).gateway;
    try {
      const dep = await this.apps.readNamespacedDeployment({
        name: depName,
        namespace: this.namespace,
      });
      const container = dep.spec?.template?.spec?.containers?.find(
        (c) => c.name === this.containerName,
      );
      const entry = container?.env?.find((e) => e.name === name);
      return entry?.value ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw wrapApi(err, `read env from ${depName}`);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private gatewayUrlFor(workspaceId: string): string {
    const name = containerNames(workspaceId).gateway;
    return `http://${name}.${this.namespace}.svc.cluster.local:${GATEWAY_PORT}`;
  }

  private async patchReplicas(name: string, replicas: number): Promise<void> {
    await this.apps.patchNamespacedDeployment(
      {
        name,
        namespace: this.namespace,
        body: { spec: { replicas } },
      },
      setHeaderOptions("Content-Type", PatchStrategy.MergePatch),
    );
  }

  private async waitForDeploymentReady(name: string): Promise<void> {
    const deadline = Date.now() + DEPLOYMENT_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const dep = await this.apps.readNamespacedDeployment({
          name,
          namespace: this.namespace,
        });
        const ready = dep.status?.readyReplicas ?? 0;
        const desired = dep.spec?.replicas ?? 1;
        if (ready >= desired && ready >= 1) {
          log.info(`Deployment ${name} ready (${ready}/${desired})`);
          return;
        }
      } catch (err) {
        if (!isNotFound(err)) throw wrapApi(err, `read deployment ${name}`);
      }
      await sleep(DEPLOYMENT_POLL_INTERVAL_MS);
    }
    throw new Error(
      `Deployment ${this.namespace}/${name} did not become ready within ${DEPLOYMENT_READY_TIMEOUT_MS}ms`,
    );
  }

  private buildDeployment(input: CreateWorkspaceInput, name: string): V1Deployment {
    const envEntries = Object.entries(input.env).map(([k, v]) => ({ name: k, value: v }));
    const memoryMi = `${input.memoryMB}Mi`;
    const cpuMillis = `${Math.max(1, Math.round(input.cpuCores * 1000))}m`;

    const labels = {
      "app.kubernetes.io/name": APP_LABEL_VALUE,
      "app.kubernetes.io/instance": input.workspaceId,
      [WORKSPACE_LABEL]: input.workspaceId,
    };

    return {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name, namespace: this.namespace, labels },
      spec: {
        replicas: 1,
        strategy: { type: "Recreate" },
        selector: { matchLabels: { [WORKSPACE_LABEL]: input.workspaceId } },
        template: {
          metadata: { labels },
          spec: {
            nodeSelector: { [this.nodeSelectorLabel]: this.nodeSelectorValue },
            // The OpenClaw image runs as uid/gid 1000 ("node"). hostPath
            // volumes are created by kubelet as root:root and ignore fsGroup,
            // so without this initContainer writes from the gateway EACCES
            // on first boot. Run `chown -R 1000:1000` once, as root, to
            // align ownership with the main container's runtime user.
            //
            // We reuse the gateway image for the init so there's no extra
            // pull — the image is already on the node by the time the main
            // container schedules. If you swap to a minimal distroless
            // gateway image later, change this to `busybox` + a second pull.
            initContainers: [
              {
                name: "chown-workspace",
                image: input.image,
                imagePullPolicy: "IfNotPresent",
                command: [
                  "sh",
                  "-c",
                  "chown -R 1000:1000 /home/node/.openclaw && chmod -R u+rwX /home/node/.openclaw",
                ],
                securityContext: { runAsUser: 0, runAsGroup: 0 },
                volumeMounts: [
                  { name: "openclaw-data", mountPath: "/home/node/.openclaw" },
                ],
              },
            ],
            containers: [
              {
                name: this.containerName,
                image: input.image,
                imagePullPolicy: "IfNotPresent",
                ports: [{ name: "gateway", containerPort: GATEWAY_PORT }],
                env: envEntries,
                resources: {
                  requests: { cpu: "250m", memory: "512Mi" },
                  limits: { cpu: cpuMillis, memory: memoryMi },
                },
                volumeMounts: [
                  { name: "openclaw-data", mountPath: "/home/node/.openclaw" },
                ],
                readinessProbe: {
                  tcpSocket: { port: GATEWAY_PORT },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                },
              },
            ],
            volumes: [
              {
                name: "openclaw-data",
                hostPath: {
                  path: `${this.hostPathRoot}/${input.workspaceId}`,
                  type: "DirectoryOrCreate",
                },
              },
            ],
          },
        },
      },
    };
  }

  private buildService(workspaceId: string, name: string): V1Service {
    return {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name,
        namespace: this.namespace,
        labels: {
          "app.kubernetes.io/name": APP_LABEL_VALUE,
          "app.kubernetes.io/instance": workspaceId,
          [WORKSPACE_LABEL]: workspaceId,
        },
      },
      spec: {
        type: "ClusterIP",
        selector: { [WORKSPACE_LABEL]: workspaceId },
        ports: [
          { name: "gateway", port: GATEWAY_PORT, targetPort: GATEWAY_PORT },
        ],
      },
    };
  }
}

// ─── Error helpers ───────────────────────────────────────────────────

function isApiException(err: unknown): err is ApiException<unknown> {
  return err instanceof ApiException;
}

function isNotFound(err: unknown): boolean {
  return isApiException(err) && err.code === 404;
}

function isAlreadyExists(err: unknown): boolean {
  return isApiException(err) && err.code === 409;
}

function errMsg(err: unknown): string {
  if (isApiException(err)) return `HTTP ${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function wrapApi(err: unknown, context: string): Error {
  return new Error(`[k8s] ${context}: ${errMsg(err)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
