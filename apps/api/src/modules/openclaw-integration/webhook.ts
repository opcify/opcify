import { execFile } from "node:child_process";
import { createLogger } from "../../logger.js";

const log = createLogger("openclaw_webhook");

interface TaskPayload {
  id: string;
  title: string;
  description?: string | null;
  priority: string;
}

/**
 * Sends a task to the OpenClaw Gateway agent via the `openclaw agent` CLI.
 * This is the webhook trigger that fires when a task is created or reassigned.
 *
 * The agent, guided by its opcify/SKILL.md, will call back to Opcify's API
 * to update the task status and report results.
 */
export async function dispatchTaskToGateway(task: TaskPayload): Promise<{ success: boolean; error?: string }> {
  const gatewayAgent = process.env.OPENCLAW_GATEWAY_AGENT || "main";
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || "";

  if (!gatewayToken) {
    log.warn("OPENCLAW_GATEWAY_TOKEN not set, skipping gateway dispatch", { taskId: task.id });
    return { success: false, error: "OPENCLAW_GATEWAY_TOKEN not configured" };
  }

  const message = [
    "[OPCIFY-TASK]",
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Description: ${task.description || "(none)"}`,
    `Priority: ${task.priority}`,
    "[/OPCIFY-TASK]",
    "",
    "You have a new task from Opcify. Read skills/opcify/SKILL.md for instructions.",
    "Immediately set the task status to running, then execute the task.",
  ].join("\n");

  const args = [
    "agent",
    "--agent", gatewayAgent,
    "--message", message,
    "--json",
    "--timeout", "300",
  ];

  if (gatewayToken) {
    args.push("--token", gatewayToken);
  }

  return new Promise((resolve) => {
    log.info("Dispatching task to OpenClaw Gateway", { taskId: task.id, agent: gatewayAgent });

    execFile("openclaw", args, { timeout: 310_000 }, (error, stdout, stderr) => {
      if (error) {
        log.error("Gateway dispatch failed", { taskId: task.id, error: error.message, stderr });
        resolve({ success: false, error: error.message });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        if (result.status === "ok") {
          log.info("Gateway dispatch succeeded", { taskId: task.id, runId: result.runId });
          resolve({ success: true });
        } else {
          log.warn("Gateway dispatch returned non-ok status", { taskId: task.id, result });
          resolve({ success: false, error: `Agent returned status: ${result.status}` });
        }
      } catch {
        log.warn("Could not parse gateway response", { taskId: task.id, stdout: stdout.slice(0, 200) });
        // Non-JSON output likely means the agent responded — treat as success
        resolve({ success: true });
      }
    });
  });
}

/**
 * Fire-and-forget wrapper. Logs errors but does not block the caller.
 * Used in route handlers where the webhook is a side-effect.
 */
export function fireWebhookAsync(task: TaskPayload): void {
  dispatchTaskToGateway(task).catch((err) => {
    log.error("Unhandled webhook error", { taskId: task.id, error: String(err) });
  });
}
