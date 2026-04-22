/**
 * Live end-to-end smoke test for DockerRuntime against the local Docker
 * daemon. Not part of the unit suite — run on demand to verify the
 * Docker-mode code path actually exercises Dockerode without mocks.
 *
 * Usage:   pnpm --filter @opcify/api exec tsx scripts/smoke-docker-runtime.mts
 */
import { getRuntime, __resetRuntimeForTests } from "../src/runtime/workspace-runtime.js";

process.env.OPCIFY_RUNTIME_MODE = "docker";
__resetRuntimeForTests();

async function main() {
  const runtime = getRuntime();
  console.log("runtime class:", runtime.constructor.name);

  const ids = await runtime.listWorkspaceIds();
  console.log("existing workspace containers:", ids);

  const missing = await runtime.inspect("__smoke-test-missing-id__");
  console.log("inspect missing →", JSON.stringify(missing));

  if (ids.length) {
    const existing = await runtime.inspect(ids[0]);
    console.log("inspect first existing →", JSON.stringify(existing));
    const url = await runtime.getGatewayUrl(ids[0]);
    console.log("getGatewayUrl →", url);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
