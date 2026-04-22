import { docker } from "../docker/DockerClient.js";
import { containerNames } from "../workspace/WorkspaceConfig.js";
import { createLogger } from "../logger.js";
import type { ContainerExecutor, ExecResult } from "./executor.js";

const log = createLogger("runtime-docker");

/**
 * Exec backend backed by Dockerode's container.exec. Used when
 * OPCIFY_RUNTIME_MODE is unset or "docker" — the current deployment shape
 * where Opcify talks to `/var/run/docker.sock` directly.
 */
export class DockerExecutor implements ContainerExecutor {
  async exec(workspaceId: string, cmd: string[]): Promise<ExecResult> {
    const names = containerNames(workspaceId);
    try {
      const container = docker.getContainer(names.gateway);
      const exec = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false });
      const { stdout, stderr } = await demuxStream(stream);
      const inspect = await exec.inspect();
      return {
        stdout,
        stderr,
        exitCode: inspect.ExitCode ?? 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`docker exec failed on ${names.gateway}: ${msg}`);
      throw err instanceof Error ? err : new Error(msg);
    }
  }
}

/**
 * Demultiplex a Dockerode exec stream into stdout/stderr. The wire format
 * is 8-byte frame headers: byte 0 = stream type (1=stdout, 2=stderr),
 * bytes 4-7 = big-endian payload length.
 *
 * If no valid frames are found (e.g. TTY mode), the whole buffer is
 * returned as stdout — matching the forgiving behavior the previous
 * per-file streamToString helpers provided.
 */
function demuxStream(stream: NodeJS.ReadableStream): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks);
      const stdoutParts: string[] = [];
      const stderrParts: string[] = [];
      let offset = 0;
      let framedBytes = 0;
      while (offset + 8 <= raw.length) {
        const streamType = raw.readUInt8(offset);
        const size = raw.readUInt32BE(offset + 4);
        if (offset + 8 + size > raw.length) break;
        const payload = raw.subarray(offset + 8, offset + 8 + size).toString("utf-8");
        if (streamType === 2) stderrParts.push(payload);
        else stdoutParts.push(payload);
        offset += 8 + size;
        framedBytes = offset;
      }
      if (framedBytes === 0 && raw.length > 0) {
        resolve({ stdout: raw.toString("utf-8"), stderr: "" });
      } else {
        resolve({ stdout: stdoutParts.join(""), stderr: stderrParts.join("") });
      }
    });
    stream.on("error", reject);
  });
}
