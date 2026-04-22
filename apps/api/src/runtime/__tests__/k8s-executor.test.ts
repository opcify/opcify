import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const mockExecCall = vi.fn();
const mockLoadFromDefault = vi.fn();

vi.mock("@kubernetes/client-node", () => {
  class KubeConfig {
    loadFromDefault = mockLoadFromDefault;
  }
  class Exec {
    constructor(_kc: unknown) {}
    exec = (...args: unknown[]) => mockExecCall(...args);
  }
  return { KubeConfig, Exec };
});

vi.mock("../../workspace/WorkspaceConfig.js", () => ({
  containerNames: (workspaceId: string) => ({
    gateway: `openclaw-gateway-${workspaceId}`,
    browser: `openclaw-browser-${workspaceId}`,
    network: `opcify-ws-${workspaceId}`,
  }),
}));

import { K8sExecutor } from "../k8s-executor.js";

type ExecArgs = [
  string,
  string,
  string,
  string | string[],
  NodeJS.WritableStream,
  NodeJS.WritableStream,
  NodeJS.ReadableStream | null,
  boolean,
  (status: unknown) => void,
];

function makeMockWs(): EventEmitter {
  return new EventEmitter();
}

/**
 * Drive the mocked k8s exec: write provided bytes to stdout/stderr then emit
 * the given status and close the fake websocket.
 */
function simulate(opts: {
  stdout?: string;
  stderr?: string;
  status: unknown;
}): EventEmitter {
  const ws = makeMockWs();
  mockExecCall.mockImplementation(async (...args: unknown[]) => {
    const [, , , , stdoutStream, stderrStream, , , statusCb] = args as ExecArgs;
    setTimeout(() => {
      if (opts.stdout) stdoutStream.write(opts.stdout);
      if (opts.stderr) stderrStream.write(opts.stderr);
      statusCb(opts.status);
      ws.emit("close");
    }, 0);
    return ws;
  });
  return ws;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OPCIFY_K8S_NAMESPACE;
  delete process.env.OPCIFY_K8S_GATEWAY_CONTAINER;
});

afterEach(() => {
  delete process.env.OPCIFY_K8S_NAMESPACE;
  delete process.env.OPCIFY_K8S_GATEWAY_CONTAINER;
});

describe("K8sExecutor", () => {
  it("captures stdout/stderr and reports exit 0 on Success", async () => {
    simulate({
      stdout: "hello",
      stderr: "warn",
      status: { status: "Success" },
    });

    const result = await new K8sExecutor().exec("ws1", ["echo", "hi"]);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("warn");
    expect(result.exitCode).toBe(0);
  });

  it("parses ExitCode cause from Failure status", async () => {
    simulate({
      stdout: "",
      stderr: "bad",
      status: {
        status: "Failure",
        reason: "NonZeroExitCode",
        details: {
          causes: [{ reason: "ExitCode", message: "7" }],
        },
      },
    });

    const result = await new K8sExecutor().exec("ws1", ["sh", "-c", "exit 7"]);
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe("bad");
  });

  it("defaults to exit 1 when Failure has no ExitCode cause", async () => {
    simulate({ status: { status: "Failure", reason: "Unknown" } });
    const result = await new K8sExecutor().exec("ws1", ["foo"]);
    expect(result.exitCode).toBe(1);
  });

  it("passes namespace/pod/container/cmd to k8s Exec API", async () => {
    simulate({ status: { status: "Success" } });
    await new K8sExecutor().exec("abc123", ["openclaw", "skills", "list"]);

    const call = mockExecCall.mock.calls[0];
    expect(call[0]).toBe("openclaw");
    expect(call[1]).toBe("openclaw-gateway-abc123");
    expect(call[2]).toBe("gateway");
    expect(call[3]).toEqual(["openclaw", "skills", "list"]);
    expect(call[7]).toBe(false);
  });

  it("honors OPCIFY_K8S_NAMESPACE and OPCIFY_K8S_GATEWAY_CONTAINER overrides", async () => {
    process.env.OPCIFY_K8S_NAMESPACE = "my-ns";
    process.env.OPCIFY_K8S_GATEWAY_CONTAINER = "gw-v2";
    simulate({ status: { status: "Success" } });

    await new K8sExecutor().exec("ws1", ["true"]);

    const call = mockExecCall.mock.calls[0];
    expect(call[0]).toBe("my-ns");
    expect(call[2]).toBe("gw-v2");
  });

  it("propagates k8s client errors", async () => {
    mockExecCall.mockRejectedValue(new Error("forbidden: pods/exec"));
    await expect(new K8sExecutor().exec("ws1", ["true"])).rejects.toThrow("forbidden");
  });
});
