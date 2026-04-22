import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockLoadFromDefault,
  mockCreateNamespacedDeployment,
  mockReadNamespacedDeployment,
  mockPatchNamespacedDeployment,
  mockDeleteNamespacedDeployment,
  mockListNamespacedDeployment,
  mockCreateNamespacedService,
  mockDeleteNamespacedService,
  MockApiException,
} = vi.hoisted(() => {
  class MockApiException extends Error {
    code: number;
    body: unknown;
    headers: Record<string, string>;
    constructor(code: number, message: string) {
      super(message);
      this.code = code;
      this.body = {};
      this.headers = {};
    }
  }
  return {
    mockLoadFromDefault: vi.fn(),
    mockCreateNamespacedDeployment: vi.fn(),
    mockReadNamespacedDeployment: vi.fn(),
    mockPatchNamespacedDeployment: vi.fn(),
    mockDeleteNamespacedDeployment: vi.fn(),
    mockListNamespacedDeployment: vi.fn(),
    mockCreateNamespacedService: vi.fn(),
    mockDeleteNamespacedService: vi.fn(),
    MockApiException,
  };
});

vi.mock("@kubernetes/client-node", () => {
  class KubeConfig {
    loadFromDefault = mockLoadFromDefault;
    makeApiClient(cls: new () => unknown) {
      if (cls === AppsV1Api) {
        return {
          createNamespacedDeployment: mockCreateNamespacedDeployment,
          readNamespacedDeployment: mockReadNamespacedDeployment,
          patchNamespacedDeployment: mockPatchNamespacedDeployment,
          deleteNamespacedDeployment: mockDeleteNamespacedDeployment,
          listNamespacedDeployment: mockListNamespacedDeployment,
        };
      }
      if (cls === CoreV1Api) {
        return {
          createNamespacedService: mockCreateNamespacedService,
          deleteNamespacedService: mockDeleteNamespacedService,
        };
      }
      throw new Error("unexpected api client");
    }
  }
  class AppsV1Api {}
  class CoreV1Api {}
  return {
    KubeConfig,
    AppsV1Api,
    CoreV1Api,
    ApiException: MockApiException,
    PatchStrategy: {
      MergePatch: "application/merge-patch+json",
    },
    setHeaderOptions: (key: string, value: string) => ({ headers: { [key]: value } }),
  };
});

vi.mock("../../workspace/WorkspaceConfig.js", () => ({
  containerNames: (id: string) => ({
    gateway: `openclaw-gateway-${id}`,
    browser: `openclaw-browser-${id}`,
    network: `opcify-ws-${id}`,
  }),
}));

import { K8sRuntime } from "../k8s-runtime.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OPCIFY_K8S_NAMESPACE;
  delete process.env.OPCIFY_K8S_GATEWAY_CONTAINER;
  delete process.env.OPCIFY_K8S_NODE_SELECTOR_LABEL;
  delete process.env.OPCIFY_K8S_NODE_SELECTOR_VALUE;
  delete process.env.OPCIFY_K8S_HOSTPATH_ROOT;
});

afterEach(() => {
  delete process.env.OPCIFY_K8S_NAMESPACE;
  delete process.env.OPCIFY_K8S_GATEWAY_CONTAINER;
});

describe("K8sRuntime.create", () => {
  it("creates Deployment + Service with expected shape and waits for readiness", async () => {
    mockCreateNamespacedDeployment.mockResolvedValue({});
    mockCreateNamespacedService.mockResolvedValue({});
    mockReadNamespacedDeployment.mockResolvedValue({
      status: { readyReplicas: 1 },
      spec: { replicas: 1 },
    });

    const result = await new K8sRuntime().create({
      workspaceId: "ws-abc",
      image: "qiguangyang/openclaw:latest",
      env: { FOO: "bar", GATEWAY_TOKEN: "t" },
      memoryMB: 2048,
      cpuCores: 1,
      dataDir: "/data/workspaces/ws-abc",
    });

    expect(result.gatewayUrl).toBe(
      "http://openclaw-gateway-ws-abc.openclaw.svc.cluster.local:18789",
    );
    expect(result.gatewayHostPort).toBeUndefined();

    const { namespace, body } = mockCreateNamespacedDeployment.mock.calls[0][0];
    expect(namespace).toBe("openclaw");
    expect(body.metadata.name).toBe("openclaw-gateway-ws-abc");
    expect(body.spec.replicas).toBe(1);
    expect(body.spec.template.spec.nodeSelector).toEqual({ "opcify.io/node-role": "data" });

    const container = body.spec.template.spec.containers[0];
    expect(container.name).toBe("gateway");
    expect(container.image).toBe("qiguangyang/openclaw:latest");
    expect(container.env).toEqual(
      expect.arrayContaining([
        { name: "FOO", value: "bar" },
        { name: "GATEWAY_TOKEN", value: "t" },
      ]),
    );
    expect(container.resources.limits.memory).toBe("2048Mi");
    expect(container.volumeMounts[0].mountPath).toBe("/home/node/.openclaw");

    const volume = body.spec.template.spec.volumes[0];
    expect(volume.hostPath.path).toBe("/var/opcify/workspaces/ws-abc");

    // hostPath volumes are created root:root, so the gateway container
    // (uid 1000) would EACCES without a chown pass in an initContainer.
    const init = body.spec.template.spec.initContainers?.[0];
    expect(init?.name).toBe("chown-workspace");
    expect(init?.securityContext?.runAsUser).toBe(0);
    expect(init?.image).toBe("qiguangyang/openclaw:latest");

    const svc = mockCreateNamespacedService.mock.calls[0][0];
    expect(svc.body.spec.ports[0].port).toBe(18789);
    expect(svc.body.spec.selector["opcify.workspace"]).toBe("ws-abc");
  });

  it("skips create on 409 already-exists", async () => {
    mockCreateNamespacedDeployment.mockRejectedValue(new MockApiException(409, "exists"));
    mockCreateNamespacedService.mockRejectedValue(new MockApiException(409, "exists"));
    mockReadNamespacedDeployment.mockResolvedValue({
      status: { readyReplicas: 1 },
      spec: { replicas: 1 },
    });

    await expect(
      new K8sRuntime().create({
        workspaceId: "ws-x",
        image: "img",
        env: {},
        memoryMB: 1024,
        cpuCores: 1,
        dataDir: "/d",
      }),
    ).resolves.toMatchObject({
      gatewayUrl: expect.stringContaining("openclaw-gateway-ws-x"),
    });
  });

  it("throws non-409 create errors", async () => {
    mockCreateNamespacedDeployment.mockRejectedValue(new MockApiException(403, "forbidden"));
    await expect(
      new K8sRuntime().create({
        workspaceId: "ws-deny",
        image: "img",
        env: {},
        memoryMB: 1024,
        cpuCores: 1,
        dataDir: "/d",
      }),
    ).rejects.toThrow(/forbidden/);
  });

  it("honors OPCIFY_K8S_NAMESPACE override", async () => {
    process.env.OPCIFY_K8S_NAMESPACE = "custom-ns";
    mockCreateNamespacedDeployment.mockResolvedValue({});
    mockCreateNamespacedService.mockResolvedValue({});
    mockReadNamespacedDeployment.mockResolvedValue({
      status: { readyReplicas: 1 },
      spec: { replicas: 1 },
    });

    const result = await new K8sRuntime().create({
      workspaceId: "ws-y",
      image: "img",
      env: {},
      memoryMB: 1024,
      cpuCores: 1,
      dataDir: "/d",
    });

    expect(mockCreateNamespacedDeployment.mock.calls[0][0].namespace).toBe("custom-ns");
    expect(result.gatewayUrl).toContain("custom-ns.svc.cluster.local");
  });
});

describe("K8sRuntime.start / stop", () => {
  it("start patches replicas=1 and waits for readiness", async () => {
    mockPatchNamespacedDeployment.mockResolvedValue({});
    mockReadNamespacedDeployment.mockResolvedValue({
      status: { readyReplicas: 1 },
      spec: { replicas: 1 },
    });

    await new K8sRuntime().start("ws-1");

    const call = mockPatchNamespacedDeployment.mock.calls[0][0];
    expect(call.name).toBe("openclaw-gateway-ws-1");
    expect(call.body).toEqual({ spec: { replicas: 1 } });
    const headerOpts = mockPatchNamespacedDeployment.mock.calls[0][1];
    expect(headerOpts.headers["Content-Type"]).toBe("application/merge-patch+json");
  });

  it("stop patches replicas=0", async () => {
    mockPatchNamespacedDeployment.mockResolvedValue({});
    await new K8sRuntime().stop("ws-1");
    expect(mockPatchNamespacedDeployment.mock.calls[0][0].body).toEqual({
      spec: { replicas: 0 },
    });
  });

  it("stop ignores 404 (already gone)", async () => {
    mockPatchNamespacedDeployment.mockRejectedValue(new MockApiException(404, "not found"));
    await expect(new K8sRuntime().stop("ws-1")).resolves.toBeUndefined();
  });
});

describe("K8sRuntime.delete / inspect / list / readEnvVar", () => {
  it("delete removes Deployment and Service", async () => {
    mockDeleteNamespacedDeployment.mockResolvedValue({});
    mockDeleteNamespacedService.mockResolvedValue({});
    await new K8sRuntime().delete("ws-1");
    expect(mockDeleteNamespacedDeployment).toHaveBeenCalledWith({
      name: "openclaw-gateway-ws-1",
      namespace: "openclaw",
      propagationPolicy: "Foreground",
    });
    expect(mockDeleteNamespacedService).toHaveBeenCalled();
  });

  it("delete tolerates 404 on either resource", async () => {
    mockDeleteNamespacedDeployment.mockRejectedValue(new MockApiException(404, "gone"));
    mockDeleteNamespacedService.mockRejectedValue(new MockApiException(404, "gone"));
    await expect(new K8sRuntime().delete("ws-1")).resolves.toBeUndefined();
  });

  it("inspect maps readyReplicas >= 1 to running", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      status: { readyReplicas: 1 },
    });
    const result = await new K8sRuntime().inspect("ws-1");
    expect(result.gateway).toBe("running");
    expect(result.networkExists).toBe(true);
  });

  it("inspect maps readyReplicas 0 to stopped", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({ status: { readyReplicas: 0 } });
    const result = await new K8sRuntime().inspect("ws-1");
    expect(result.gateway).toBe("stopped");
  });

  it("inspect maps 404 to missing with networkExists=false", async () => {
    mockReadNamespacedDeployment.mockRejectedValue(new MockApiException(404, "gone"));
    const result = await new K8sRuntime().inspect("ws-1");
    expect(result.gateway).toBe("missing");
    expect(result.networkExists).toBe(false);
  });

  it("listWorkspaceIds strips the openclaw-gateway- prefix", async () => {
    mockListNamespacedDeployment.mockResolvedValue({
      items: [
        { metadata: { name: "openclaw-gateway-alpha" } },
        { metadata: { name: "openclaw-gateway-beta" } },
        { metadata: { name: "unrelated" } },
      ],
    });
    const ids = await new K8sRuntime().listWorkspaceIds();
    expect(ids).toEqual(["alpha", "beta"]);
  });

  it("readEnvVar finds a value on the gateway container", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: "gateway",
                env: [{ name: "OPCIFY_API_KEY", value: "k123" }],
              },
            ],
          },
        },
      },
    });
    const value = await new K8sRuntime().readEnvVar("ws-1", "OPCIFY_API_KEY");
    expect(value).toBe("k123");
  });

  it("readEnvVar returns null when the deployment is missing", async () => {
    mockReadNamespacedDeployment.mockRejectedValue(new MockApiException(404, "gone"));
    const value = await new K8sRuntime().readEnvVar("ws-1", "ANY");
    expect(value).toBeNull();
  });
});

describe("K8sRuntime.getGatewayUrl", () => {
  it("returns the Service DNS URL when the deployment exists", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({ status: { readyReplicas: 1 } });
    const url = await new K8sRuntime().getGatewayUrl("ws-1");
    expect(url).toBe("http://openclaw-gateway-ws-1.openclaw.svc.cluster.local:18789");
  });

  it("returns null when the deployment is missing", async () => {
    mockReadNamespacedDeployment.mockRejectedValue(new MockApiException(404, "gone"));
    const url = await new K8sRuntime().getGatewayUrl("ws-1");
    expect(url).toBeNull();
  });
});
