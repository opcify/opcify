import Dockerode from "dockerode";
import { createLogger } from "../logger.js";

const log = createLogger("docker");

// ─── Docker client singleton ────────────────────────────────────────

const socketPath =
  process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

export const docker = new Dockerode({ socketPath });

// ─── Image constants ────────────────────────────────────────────────

export const IMAGES = {
  /** Base OpenClaw runtime (no browser-use pre-installed) */
  gatewayBase: "ghcr.io/openclaw/openclaw:latest",
  /** OpenClaw with browser-use CLI, Playwright + Chromium baked in */
  gateway: "qiguangyang/openclaw:latest",
} as const;

// ─── Image management ───────────────────────────────────────────────

export async function ensureImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    log.info(`Image already exists: ${image}`);
    return;
  } catch {
    // Image not found locally — pull it
  }

  log.info(`Pulling image: ${image}`);

  const stream = await docker.pull(image);

  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err: Error | null) => {
        if (err) {
          log.error(`Failed to pull image ${image}: ${err.message}`);
          reject(err);
        } else {
          log.info(`Successfully pulled image: ${image}`);
          resolve();
        }
      },
      (event: { status?: string; progress?: string }) => {
        if (event.status) {
          log.info(`  ${event.status}${event.progress ? ` ${event.progress}` : ""}`);
        }
      },
    );
  });
}
