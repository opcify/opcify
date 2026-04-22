import { createServer } from "node:net";
import { docker, ensureImage as ensureImageImpl } from "../docker/DockerClient.js";
import { containerNames } from "../workspace/WorkspaceConfig.js";
import { createLogger } from "../logger.js";
import type {
  ContainerState,
  CreateWorkspaceInput,
  CreateWorkspaceResult,
  WorkspaceInspectResult,
  WorkspaceRuntime,
} from "./workspace-runtime.js";

const log = createLogger("docker-runtime");

const GATEWAY_PORT_START = 19000;
const GATEWAY_PORT_END = 19999;

/**
 * Runtime backed by Dockerode — the local Docker daemon through
 * `/var/run/docker.sock`. Used when `OPCIFY_RUNTIME_MODE=docker` (default).
 *
 * Owns the port allocation that used to live in WorkspaceService, since
 * host-port binding is a Docker-specific concern (K8s pods use Services).
 */
export class DockerRuntime implements WorkspaceRuntime {
  /** Round-robin cursor; private to this instance so tests can reset. */
  private nextPort = GATEWAY_PORT_START;

  async ensureImage(image: string): Promise<void> {
    await ensureImageImpl(image);
  }

  async create(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
    const names = containerNames(input.workspaceId);
    const hostPort = await this.findAvailablePort();

    await this.ensureNetwork(names.network);
    await this.createAndStartContainer(input, names.gateway, names.network, hostPort);

    return {
      gatewayUrl: `http://localhost:${hostPort}`,
      gatewayHostPort: hostPort,
    };
  }

  async start(workspaceId: string): Promise<void> {
    const names = containerNames(workspaceId);
    await docker.getContainer(names.gateway).start();
  }

  async stop(workspaceId: string, gracefulTimeoutSec = 10): Promise<void> {
    const names = containerNames(workspaceId);
    try {
      await docker.getContainer(names.gateway).stop({ t: gracefulTimeoutSec });
    } catch (err) {
      // Already stopped or missing — both are acceptable.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/is not running|No such container/i.test(msg)) throw err;
    }
  }

  async delete(workspaceId: string): Promise<void> {
    const names = containerNames(workspaceId);

    // Force-remove the container, best effort.
    try {
      const container = docker.getContainer(names.gateway);
      try {
        await container.stop({ t: 5 });
      } catch {
        // Already stopped
      }
      await container.remove({ force: true });
      log.info(`Removed container ${names.gateway}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/No such container/i.test(msg)) {
        log.warn(`Could not remove container ${names.gateway}: ${msg}`);
      }
    }

    try {
      await docker.getNetwork(names.network).remove();
      log.info(`Removed network ${names.network}`);
    } catch {
      // Network may not exist
    }
  }

  async inspect(workspaceId: string): Promise<WorkspaceInspectResult> {
    const names = containerNames(workspaceId);

    let gateway: ContainerState = "missing";
    let gatewayHostPort: number | undefined;

    try {
      const info = await docker.getContainer(names.gateway).inspect();
      gateway = info.State?.Running ? "running" : "stopped";
      gatewayHostPort = extractHostPort(info);
    } catch {
      gateway = "missing";
    }

    let networkExists = false;
    try {
      await docker.getNetwork(names.network).inspect();
      networkExists = true;
    } catch {
      networkExists = false;
    }

    return { gateway, gatewayHostPort, networkExists };
  }

  async listWorkspaceIds(): Promise<string[]> {
    const ids: string[] = [];
    try {
      const containers = await docker.listContainers({ all: true });
      const prefix = "/openclaw-gateway-";
      for (const c of containers) {
        for (const raw of c.Names ?? []) {
          if (raw.startsWith(prefix)) {
            ids.push(raw.slice(prefix.length));
            break;
          }
        }
      }
    } catch (err) {
      log.warn(`listContainers failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return ids;
  }

  async getGatewayUrl(workspaceId: string): Promise<string | null> {
    const names = containerNames(workspaceId);
    try {
      const info = await docker.getContainer(names.gateway).inspect();
      const port = extractHostPort(info);
      return port ? `http://localhost:${port}` : null;
    } catch {
      return null;
    }
  }

  async readEnvVar(workspaceId: string, name: string): Promise<string | null> {
    const names = containerNames(workspaceId);
    try {
      const info = await docker.getContainer(names.gateway).inspect();
      const env = info.Config?.Env ?? [];
      const prefix = `${name}=`;
      const match = env.find((e) => e.startsWith(prefix));
      return match ? match.slice(prefix.length) : null;
    } catch {
      return null;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async findAvailablePort(): Promise<number> {
    const dockerPorts = await this.getDockerAllocatedPorts();
    for (let attempt = 0; attempt < GATEWAY_PORT_END - GATEWAY_PORT_START; attempt++) {
      const port = this.nextPort;
      this.nextPort = this.nextPort >= GATEWAY_PORT_END ? GATEWAY_PORT_START : this.nextPort + 1;
      if (dockerPorts.has(port)) continue;
      if (await isPortAvailable(port)) return port;
    }
    throw new Error("No available ports in range 19000-19999 for gateway");
  }

  private async getDockerAllocatedPorts(): Promise<Set<number>> {
    const ports = new Set<number>();
    try {
      const containers = await docker.listContainers({ all: true });
      for (const c of containers) {
        for (const p of c.Ports ?? []) {
          if (p.PublicPort) ports.add(p.PublicPort);
        }
      }
    } catch {
      // Docker daemon may be unavailable — fall through.
    }
    return ports;
  }

  private async ensureNetwork(name: string): Promise<void> {
    try {
      await docker.getNetwork(name).inspect();
      log.info(`Network ${name} already exists`);
      return;
    } catch {
      // Network missing — create below.
    }

    log.info(`Creating network ${name}`);
    try {
      await docker.createNetwork({ Name: name, Driver: "bridge" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The subnet pool is finite — prune unused networks and retry once.
      if (msg.includes("address pools have been fully subnetted")) {
        log.warn("Docker network pool exhausted — pruning unused networks and retrying");
        await docker.pruneNetworks();
        await docker.createNetwork({ Name: name, Driver: "bridge" });
        return;
      }
      throw err;
    }
  }

  private async createAndStartContainer(
    input: CreateWorkspaceInput,
    containerName: string,
    networkName: string,
    hostPort: number,
  ): Promise<void> {
    const envArray = Object.entries(input.env).map(([k, v]) => `${k}=${v}`);

    const container = await docker.createContainer({
      name: containerName,
      Image: input.image,
      Env: envArray,
      ExposedPorts: { "18789/tcp": {} },
      HostConfig: {
        NetworkMode: networkName,
        Binds: [`${input.dataDir}:/home/node/.openclaw`],
        Memory: input.memoryMB * 1024 * 1024,
        NanoCpus: input.cpuCores * 1e9,
        RestartPolicy: { Name: "unless-stopped" },
        PortBindings: {
          "18789/tcp": [{ HostPort: String(hostPort) }],
        },
      },
    });

    await container.start();
    log.info(`Gateway container ${containerName} started — host port ${hostPort}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function extractHostPort(info: unknown): number | undefined {
  const typed = info as {
    HostConfig?: { PortBindings?: Record<string, Array<{ HostPort?: string }>> };
    NetworkSettings?: { Ports?: Record<string, Array<{ HostPort?: string }>> };
  };
  const bindings =
    typed.HostConfig?.PortBindings?.["18789/tcp"] ??
    typed.NetworkSettings?.Ports?.["18789/tcp"];
  const raw = bindings?.[0]?.HostPort;
  const port = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(port) ? port : undefined;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}
