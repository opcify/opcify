import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExec = vi.fn();
const mockStart = vi.fn();
const mockInspect = vi.fn();
const mockGetContainer = vi.fn();

vi.mock("../../docker/DockerClient.js", () => ({
  docker: {
    getContainer: (...args: unknown[]) => mockGetContainer(...args),
  },
}));

vi.mock("../../workspace/WorkspaceConfig.js", () => ({
  containerNames: (workspaceId: string) => ({
    gateway: `openclaw-gateway-${workspaceId}`,
    browser: `openclaw-browser-${workspaceId}`,
    network: `opcify-ws-${workspaceId}`,
  }),
}));

import { DockerExecutor } from "../docker-executor.js";

/** Build a Docker multiplexed frame: 8-byte header (byte 0 = stream type) + payload. */
function frame(streamType: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload, "utf-8");
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function simulateExec(frames: Buffer[], exitCode: number) {
  const concatenated = Buffer.concat(frames);
  const fakeStream = {
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === "data") cb(concatenated);
      if (event === "end") setTimeout(() => cb(), 0);
      return fakeStream;
    },
  };
  mockStart.mockResolvedValue(fakeStream);
  mockInspect.mockResolvedValue({ ExitCode: exitCode });
  mockExec.mockResolvedValue({ start: mockStart, inspect: mockInspect });
  mockGetContainer.mockReturnValue({ exec: mockExec });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DockerExecutor", () => {
  it("demuxes stdout and stderr by frame type", async () => {
    simulateExec(
      [frame(1, "hello from stdout"), frame(2, "warning on stderr"), frame(1, "\nmore stdout")],
      0,
    );

    const exe = new DockerExecutor();
    const result = await exe.exec("ws1", ["echo", "hi"]);

    expect(result.stdout).toBe("hello from stdout\nmore stdout");
    expect(result.stderr).toBe("warning on stderr");
    expect(result.exitCode).toBe(0);
  });

  it("reports non-zero exit code", async () => {
    simulateExec([frame(2, "oops")], 42);

    const result = await new DockerExecutor().exec("ws1", ["false"]);
    expect(result.exitCode).toBe(42);
    expect(result.stderr).toBe("oops");
    expect(result.stdout).toBe("");
  });

  it("falls back to raw buffer when no valid framing found", async () => {
    const fakeStream = {
      on(event: string, cb: (chunk?: Buffer) => void) {
        if (event === "data") cb(Buffer.from("unframed output", "utf-8"));
        if (event === "end") setTimeout(() => cb(), 0);
        return fakeStream;
      },
    };
    mockStart.mockResolvedValue(fakeStream);
    mockInspect.mockResolvedValue({ ExitCode: 0 });
    mockExec.mockResolvedValue({ start: mockStart, inspect: mockInspect });
    mockGetContainer.mockReturnValue({ exec: mockExec });

    const result = await new DockerExecutor().exec("ws1", ["ls"]);
    expect(result.stdout).toBe("unframed output");
    expect(result.stderr).toBe("");
  });

  it("targets the workspace gateway container by name", async () => {
    simulateExec([frame(1, "ok")], 0);
    await new DockerExecutor().exec("abc123", ["echo", "hi"]);
    expect(mockGetContainer).toHaveBeenCalledWith("openclaw-gateway-abc123");
    expect(mockExec).toHaveBeenCalledWith({
      Cmd: ["echo", "hi"],
      AttachStdout: true,
      AttachStderr: true,
    });
  });

  it("propagates docker client errors", async () => {
    mockGetContainer.mockReturnValue({
      exec: vi.fn().mockRejectedValue(new Error("container not found")),
    });
    await expect(new DockerExecutor().exec("missing", ["echo"])).rejects.toThrow(
      "container not found",
    );
  });
});
