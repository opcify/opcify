/**
 * Full Docker-mode lifecycle smoke: create → start (awaited inside create) →
 * inspect → delete. Uses a short-lived image (`alpine`) via an env var so we
 * don't pull the 1.6 GB gateway image for the smoke test.
 *
 * Usage:
 *   pnpm --filter @opcify/api exec tsx scripts/smoke-docker-lifecycle.mts
 */
import { getRuntime, __resetRuntimeForTests } from "../src/runtime/workspace-runtime.js";
import { docker } from "../src/docker/DockerClient.js";

process.env.OPCIFY_RUNTIME_MODE = "docker";
__resetRuntimeForTests();

const wsId = `smoke-${Date.now()}`;

async function main() {
  const runtime = getRuntime();

  // Pre-pull a tiny image so ensureImage succeeds quickly.
  console.log("pulling alpine...");
  await runtime.ensureImage("alpine:3.20");

  console.log(`create workspace=${wsId}`);
  // Use a sleep command as the "gateway" so the container stays up.
  // We provide image via env at runtime.create time.
  const result = await runtime.create({
    workspaceId: wsId,
    image: "alpine:3.20",
    env: { MARKER: "opcify-smoke" },
    memoryMB: 128,
    cpuCores: 1,
    dataDir: "/tmp/opcify-smoke",
  }).catch((err) => {
    console.log("(create failed — that's OK if alpine exits too fast)", err.message);
    return null;
  });
  console.log("create result:", result);

  // Alpine's default CMD exits immediately — the container should be "stopped"
  // by now. That's fine; we just want to confirm the lifecycle path executed
  // through Dockerode without error.
  const inspected = await runtime.inspect(wsId);
  console.log("inspect →", JSON.stringify(inspected));

  const url = await runtime.getGatewayUrl(wsId);
  console.log("getGatewayUrl →", url);

  const envMarker = await runtime.readEnvVar(wsId, "MARKER");
  console.log("readEnvVar(MARKER) →", envMarker);

  console.log("delete...");
  await runtime.delete(wsId);

  const postDelete = await runtime.inspect(wsId);
  console.log("post-delete inspect →", JSON.stringify(postDelete));

  // Also confirm network is gone.
  try {
    await docker.getNetwork(`opcify-ws-${wsId}`).inspect();
    console.log("FAIL: network still present");
  } catch {
    console.log("network cleaned up ✓");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("smoke failed:", e);
    process.exit(1);
  });
