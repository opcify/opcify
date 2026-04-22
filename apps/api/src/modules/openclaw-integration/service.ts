import { randomUUID } from "node:crypto";
import type { OpenClawExecuteCommand, OpenClawDispatchResult } from "@opcify/core";
import { openClawExecuteCommandSchema } from "../tasks/schemas.js";
import { agentSlug } from "../agents/workspace-sync.js";
import { chatService, toGatewaySessionKey } from "../chat/service.js";

export interface OpenClawClient {
  execute(command: OpenClawExecuteCommand): Promise<OpenClawDispatchResult>;
}

/**
 * HTTP client that dispatches commands to a running OpenClaw runtime.
 * Used when OPENCLAW_BASE_URL is set (direct execution API).
 */
export class HttpOpenClawClient implements OpenClawClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.authToken = authToken || "";
  }

  async execute(command: OpenClawExecuteCommand): Promise<OpenClawDispatchResult> {
    const validated = openClawExecuteCommandSchema.parse(command);

    const url = `${this.baseUrl}/execute`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(validated),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "unknown error");
        return { success: false, error: `OpenClaw returned ${res.status}: ${text}` };
      }

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown dispatch error";
      return { success: false, error: `Failed to reach OpenClaw at ${url}: ${message}` };
    }
  }
}

/**
 * Build the task-context message handed to the agent. All procedural knowledge
 * (identity, role, team, workflow, callback format, graceful stop, etc.) lives
 * in each agent's AGENTS.md and the opcify skill — see
 * templates/skills/opcify/SKILL.md and templates/workspaces/*\/agents/*\/AGENTS.md.
 */
function buildTaskMessage(command: OpenClawExecuteCommand): string {
  const callbackUrl = command.callbackUrl || "";
  const callbackToken = command.callbackToken || "";
  const taskFolder = `/home/node/.openclaw/data/task-${command.sourceTaskId || command.taskId}`;
  return [
    `## Task`,
    `- **Task ID:** ${command.taskId}`,
    `- **Goal:** ${command.goal}`,
    `- **Description:** ${command.description || "(none)"}`,
    `- **Priority:** ${command.priority}`,
    `- **Task folder:** ${taskFolder}`,
    ``,
    `## Opcify Callback`,
    `- **URL:** ${callbackUrl}`,
    ...(callbackToken ? [`- **Token:** ${callbackToken}`] : []),
    ...(command.sourceTaskId ? [
      ``,
      `## Follow-up`,
      `This is a follow-up to task \`${command.sourceTaskId}\`. Handle it per your AGENTS.md §Follow-up Tasks — fetch the source task with the opcify skill before planning.`,
    ] : []),
    ``,
    `Follow your AGENTS.md and the opcify skill for the workflow. The opcify skill defines the callback payload format and task lifecycle; your AGENTS.md defines your role, team (if any), and how you handle tasks.`,
  ].join("\n");
}

/**
 * Per-workspace dispatch client that hands off task runs to the workspace's
 * OpenClaw gateway via JSON-RPC over the shared WebSocket connection (pooled
 * by chatService). Each task run is routed to its own session key
 * `agent:<slug>:task-<taskId>` so it gets an isolated context window and does
 * not pollute the agent's main chat conversation.
 *
 * The gateway `agent` method responds `{status:"accepted"}` immediately and
 * runs the agent in the background — the agent reports completion via the
 * callback URL embedded in the task message.
 */
export class GatewayRpcClient implements OpenClawClient {
  private workspaceId: string;

  constructor(workspaceId: string, _token: string) {
    this.workspaceId = workspaceId;
  }

  async execute(command: OpenClawExecuteCommand): Promise<OpenClawDispatchResult> {
    // Use the slug as agent ID (matches openclaw.json agents.list[].id)
    const agentId = command.agent?.name ? agentSlug(command.agent.name) : "main";
    const sessionKey = toGatewaySessionKey(agentId, `task-${command.taskId}`);
    const message = buildTaskMessage(command);

    try {
      const wsClient = await chatService.getClient(this.workspaceId);
      const res = await wsClient.request<{ runId?: string; status?: string }>("agent", {
        agentId,
        sessionKey,
        message,
        idempotencyKey: randomUUID(),
        timeout: 1800,
        deliver: false,
      });
      if (res?.status && res.status !== "accepted") {
        return { success: false, error: `Gateway rejected agent run: ${res.status}` };
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Gateway RPC dispatch failed: ${msg}` };
    }
  }
}

export function createOpenClawClient(): OpenClawClient {
  const openclawBaseUrl = process.env.OPENCLAW_BASE_URL;

  if (!openclawBaseUrl) {
    console.log("[OpenClaw] OPENCLAW_BASE_URL not set — dispatch will use per-workspace gateway CLI");
    // Return a stub; per-workspace GatewayRpcClient is resolved in dispatch.ts
    return {
      async execute(): Promise<OpenClawDispatchResult> {
        return { success: false, error: "No global OPENCLAW_BASE_URL configured — use per-workspace dispatch" };
      },
    };
  }

  const authToken = process.env.OPENCLAW_AUTH_TOKEN || "";
  console.log(`[OpenClaw] Using HttpOpenClawClient → ${openclawBaseUrl}`);
  return new HttpOpenClawClient(openclawBaseUrl, authToken);
}
