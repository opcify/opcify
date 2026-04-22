import { getRuntime } from "../runtime/workspace-runtime.js";
import type { WorkspaceDockerState } from "./types.js";

/**
 * Detect the runtime state of a workspace's gateway (and the network Docker
 * mode scaffolds around it). Delegates to the active `WorkspaceRuntime`, so
 * on K8s this probes the Deployment instead of inspecting Docker containers.
 *
 * Browser state is always reported "missing" — the browser-use CLI now runs
 * as a subprocess inside the gateway container rather than its own Docker
 * container, so there's nothing standalone to probe here. The field is kept
 * in the return type for API back-compat.
 */
export async function detectWorkspaceContainers(
  workspaceId: string,
): Promise<WorkspaceDockerState> {
  const state = await getRuntime().inspect(workspaceId);
  return {
    gateway: state.gateway,
    browser: "missing",
    network: state.networkExists,
  };
}
