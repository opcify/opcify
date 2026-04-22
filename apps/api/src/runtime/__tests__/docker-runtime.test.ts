import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetContainer = vi.fn();
const mockGetNetwork = vi.fn();
const mockCreateContainer = vi.fn();
const mockCreateNetwork = vi.fn();
const mockListContainers = vi.fn();
const mockPruneNetworks = vi.fn();
const mockStartContainer = vi.fn();
const mockStopContainer = vi.fn();
const mockRemoveContainer = vi.fn();
const mockInspectContainer = vi.fn();
const mockInspectNetwork = vi.fn();
const mockRemoveNetwork = vi.fn();

vi.mock("../../docker/DockerClient.js", () => ({
  docker: {
    getContainer: (...args: unknown[]) => mockGetContainer(...args),
    getNetwork: (...args: unknown[]) => mockGetNetwork(...args),
    createContainer: (...args: unknown[]) => mockCreateContainer(...args),
    createNetwork: (...args: unknown[]) => mockCreateNetwork(...args),
    listContainers: (...args: unknown[]) => mockListContainers(...args),
    pruneNetworks: () => mockPruneNetworks(),
  },
  ensureImage: vi.fn().mockResolvedValue(undefined),
  IMAGES: { gateway: "test/image:latest" },
}));

vi.mock("../../workspace/WorkspaceConfig.js", () => ({
  containerNames: (workspaceId: string) => ({
    gateway: `openclaw-gateway-${workspaceId}`,
    browser: `openclaw-browser-${workspaceId}`,
    network: `opcify-ws-${workspaceId}`,
  }),
}));

import { DockerRuntime } from "../docker-runtime.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetContainer.mockReturnValue({
    start: mockStartContainer,
    stop: mockStopContainer,
    remove: mockRemoveContainer,
    inspect: mockInspectContainer,
  });
  mockGetNetwork.mockReturnValue({
    inspect: mockInspectNetwork,
    remove: mockRemoveNetwork,
  });
  mockStartContainer.mockResolvedValue(undefined);
  mockStopContainer.mockResolvedValue(undefined);
  mockRemoveContainer.mockResolvedValue(undefined);
  mockInspectNetwork.mockRejectedValue(new Error("no such network"));
  mockListContainers.mockResolvedValue([]);
});

describe("DockerRuntime.create", () => {
  it("creates network and container, allocates host port, starts container", async () => {
    mockInspectNetwork.mockRejectedValue(new Error("no such network"));
    mockCreateNetwork.mockResolvedValue({});
    mockCreateContainer.mockResolvedValue({ start: mockStartContainer });

    const runtime = new DockerRuntime();
    const result = await runtime.create({
      workspaceId: "ws-1",
      image: "test/image:latest",
      env: { FOO: "bar", GATEWAY_TOKEN: "t" },
      memoryMB: 2048,
      cpuCores: 1,
      dataDir: "/tmp/ws-1",
    });

    expect(mockCreateNetwork).toHaveBeenCalledWith({
      Name: "opcify-ws-ws-1",
      Driver: "bridge",
    });
    const createArgs = mockCreateContainer.mock.calls[0][0] as {
      name: string;
      Image: string;
      Env: string[];
      HostConfig: { Memory: number; NanoCpus: number; Binds: string[] };
    };
    expect(createArgs.name).toBe("openclaw-gateway-ws-1");
    expect(createArgs.Image).toBe("test/image:latest");
    expect(createArgs.Env).toEqual(expect.arrayContaining(["FOO=bar", "GATEWAY_TOKEN=t"]));
    expect(createArgs.HostConfig.Memory).toBe(2048 * 1024 * 1024);
    expect(createArgs.HostConfig.NanoCpus).toBe(1e9);
    expect(createArgs.HostConfig.Binds).toEqual(["/tmp/ws-1:/home/node/.openclaw"]);
    expect(mockStartContainer).toHaveBeenCalled();
    expect(result.gatewayHostPort).toBeGreaterThanOrEqual(19000);
    expect(result.gatewayHostPort).toBeLessThanOrEqual(19999);
    expect(result.gatewayUrl).toBe(`http://localhost:${result.gatewayHostPort}`);
  });

  it("prunes networks and retries when the subnet pool is exhausted", async () => {
    mockInspectNetwork.mockRejectedValue(new Error("no such network"));
    mockCreateNetwork
      .mockRejectedValueOnce(new Error("all predefined address pools have been fully subnetted"))
      .mockResolvedValueOnce({});
    mockCreateContainer.mockResolvedValue({ start: mockStartContainer });

    await new DockerRuntime().create({
      workspaceId: "ws-prune",
      image: "test/image:latest",
      env: {},
      memoryMB: 1024,
      cpuCores: 1,
      dataDir: "/tmp/ws-prune",
    });

    expect(mockPruneNetworks).toHaveBeenCalledOnce();
    expect(mockCreateNetwork).toHaveBeenCalledTimes(2);
  });
});

describe("DockerRuntime.stop / start / delete", () => {
  it("start() calls container.start()", async () => {
    await new DockerRuntime().start("ws-1");
    expect(mockGetContainer).toHaveBeenCalledWith("openclaw-gateway-ws-1");
    expect(mockStartContainer).toHaveBeenCalled();
  });

  it("stop() passes timeout to container.stop()", async () => {
    await new DockerRuntime().stop("ws-1", 20);
    expect(mockStopContainer).toHaveBeenCalledWith({ t: 20 });
  });

  it("stop() tolerates 'is not running'", async () => {
    mockStopContainer.mockRejectedValue(new Error("Container is not running"));
    await expect(new DockerRuntime().stop("ws-1")).resolves.toBeUndefined();
  });

  it("delete() removes container (force) and network", async () => {
    mockRemoveNetwork.mockResolvedValue(undefined);
    await new DockerRuntime().delete("ws-1");
    expect(mockStopContainer).toHaveBeenCalled();
    expect(mockRemoveContainer).toHaveBeenCalledWith({ force: true });
    expect(mockRemoveNetwork).toHaveBeenCalled();
  });
});

describe("DockerRuntime.inspect", () => {
  it("maps Running=true to running", async () => {
    mockInspectContainer.mockResolvedValue({
      State: { Running: true },
      HostConfig: { PortBindings: { "18789/tcp": [{ HostPort: "19005" }] } },
    });
    mockInspectNetwork.mockResolvedValue({});
    const result = await new DockerRuntime().inspect("ws-1");
    expect(result.gateway).toBe("running");
    expect(result.gatewayHostPort).toBe(19005);
    expect(result.networkExists).toBe(true);
  });

  it("maps Running=false to stopped", async () => {
    mockInspectContainer.mockResolvedValue({ State: { Running: false } });
    const result = await new DockerRuntime().inspect("ws-1");
    expect(result.gateway).toBe("stopped");
  });

  it("maps inspect error to missing", async () => {
    mockInspectContainer.mockRejectedValue(new Error("no such container"));
    const result = await new DockerRuntime().inspect("ws-1");
    expect(result.gateway).toBe("missing");
    expect(result.networkExists).toBe(false);
  });
});

describe("DockerRuntime.listWorkspaceIds", () => {
  it("extracts workspace ids from container names", async () => {
    mockListContainers.mockResolvedValue([
      { Names: ["/openclaw-gateway-abc123"] },
      { Names: ["/some-other-container"] },
      { Names: ["/openclaw-gateway-def456", "/alias"] },
    ]);
    const ids = await new DockerRuntime().listWorkspaceIds();
    expect(ids.sort()).toEqual(["abc123", "def456"]);
  });

  it("returns [] on docker error", async () => {
    mockListContainers.mockRejectedValue(new Error("docker down"));
    const ids = await new DockerRuntime().listWorkspaceIds();
    expect(ids).toEqual([]);
  });
});

describe("DockerRuntime.readEnvVar", () => {
  it("parses env array for a var", async () => {
    mockInspectContainer.mockResolvedValue({
      Config: { Env: ["FOO=bar", "OPCIFY_API_KEY=secret-key-123"] },
    });
    const value = await new DockerRuntime().readEnvVar("ws-1", "OPCIFY_API_KEY");
    expect(value).toBe("secret-key-123");
  });

  it("returns null when var is missing", async () => {
    mockInspectContainer.mockResolvedValue({ Config: { Env: ["FOO=bar"] } });
    const value = await new DockerRuntime().readEnvVar("ws-1", "MISSING");
    expect(value).toBeNull();
  });

  it("returns null on inspect error", async () => {
    mockInspectContainer.mockRejectedValue(new Error("gone"));
    const value = await new DockerRuntime().readEnvVar("ws-1", "ANY");
    expect(value).toBeNull();
  });
});

describe("DockerRuntime.getGatewayUrl", () => {
  it("returns localhost URL with bound port", async () => {
    mockInspectContainer.mockResolvedValue({
      HostConfig: { PortBindings: { "18789/tcp": [{ HostPort: "19042" }] } },
    });
    const url = await new DockerRuntime().getGatewayUrl("ws-1");
    expect(url).toBe("http://localhost:19042");
  });

  it("returns null if port binding missing", async () => {
    mockInspectContainer.mockResolvedValue({});
    const url = await new DockerRuntime().getGatewayUrl("ws-1");
    expect(url).toBeNull();
  });
});
