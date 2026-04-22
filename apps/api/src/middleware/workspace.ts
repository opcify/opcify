import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db.js";
import { verifyJwt } from "../modules/auth/service.js";
import { loadWorkspaceFromDisk } from "../workspace/WorkspaceConfig.js";

declare module "fastify" {
  interface FastifyRequest {
    workspaceId?: string;
  }
}

export type WorkspaceAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Core workspace bearer-token validation. Accepts EITHER:
 *
 *   1. A JWT Bearer token whose user owns `workspaceId`, OR
 *   2. A Bearer token matching the workspace's per-workspace API key
 *      (`opcifyApiKey` in `opcify-meta.json`, exposed to agents as
 *      `$OPCIFY_API_KEY`).
 *
 * Status semantics:
 *   - 401 — no bearer token or a bearer we can't parse
 *   - 403 — bearer is valid but the caller is not a member/owner of an
 *           existing workspace (lets the web UI redirect back to /dashboard)
 *   - 404 — the workspace id does not exist at all
 *
 * On success, sets `req.workspaceId` (and `req.userId` for the JWT branch).
 * Returns a structured result rather than sending the reply so the caller
 * can decide between preHandler-style enforcement and handler-level inline
 * auth (used by `/dashboard/summary`).
 */
export async function validateWorkspaceBearer(
  req: FastifyRequest,
  workspaceId: string,
): Promise<WorkspaceAuthResult> {
  const auth = req.headers.authorization;
  let bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  // EventSource cannot set custom headers, so SSE routes pass the bearer as
  // `?_token=...` on the URL instead. The query fallback is only consulted
  // when no Authorization header is present.
  if (!bearer) {
    const q = req.query as { _token?: string } | null;
    if (q && typeof q._token === "string" && q._token.length > 0) {
      bearer = q._token;
    }
  }
  if (!bearer) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  // Load the workspace once so 403-vs-404 is decidable in both branches.
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true },
  });

  // 1) Try JWT first — the common case for the web UI.
  const jwtPayload = verifyJwt(bearer);
  if (jwtPayload) {
    if (!workspace) {
      return { ok: false, status: 404, error: "Workspace not found" };
    }
    if (workspace.userId !== jwtPayload.sub) {
      return {
        ok: false,
        status: 403,
        error: "Forbidden: not a member of this workspace",
      };
    }
    req.userId = jwtPayload.sub;
    req.workspaceId = workspace.id;
    return { ok: true };
  }

  // 2) Fall back to per-workspace API key (agents in containers).
  if (!workspace) {
    return { ok: false, status: 404, error: "Workspace not found" };
  }
  const meta = await loadWorkspaceFromDisk(workspaceId);
  if (meta?.opcifyApiKey && bearer === meta.opcifyApiKey) {
    req.workspaceId = workspaceId;
    return { ok: true };
  }

  // Bearer provided, workspace exists, but neither JWT nor API key matched.
  return {
    ok: false,
    status: 403,
    error: "Forbidden: invalid credential for this workspace",
  };
}

/**
 * Workspace-scoped auth preHandler for routes that carry `:workspaceId` in
 * their path params. Delegates to `validateWorkspaceBearer`.
 */
export async function requireWorkspaceAuth(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const params = req.params as { workspaceId?: string };
  const workspaceId = params?.workspaceId;
  if (!workspaceId) {
    return reply.status(400).send({ error: "Missing workspaceId" });
  }

  const result = await validateWorkspaceBearer(req, workspaceId);
  if (!result.ok) {
    return reply.status(result.status).send({ error: result.error });
  }
}

/**
 * Throws a tagged error if a resource id exists but in a different workspace.
 * Callers should map `WorkspaceScopeError` → 404 so resource existence isn't
 * leaked across workspace boundaries.
 */
export class WorkspaceScopeError extends Error {
  constructor(message = "Resource not in workspace") {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

export async function assertTaskInWorkspace(
  taskId: string,
  workspaceId: string,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { workspaceId: true },
  });
  if (!task || task.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Task not in workspace");
  }
}

export async function assertAgentInWorkspace(
  agentId: string,
  workspaceId: string,
): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { workspaceId: true },
  });
  if (!agent || agent.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Agent not in workspace");
  }
}

export async function assertNoteInWorkspace(
  noteId: string,
  workspaceId: string,
): Promise<void> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { workspaceId: true },
  });
  if (!note || note.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Note not in workspace");
  }
}

export async function assertRecurringRuleInWorkspace(
  ruleId: string,
  workspaceId: string,
): Promise<void> {
  const rule = await prisma.recurringRule.findUnique({
    where: { id: ruleId },
    select: { workspaceId: true },
  });
  if (!rule || rule.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Recurring rule not in workspace");
  }
}

export async function assertTaskGroupInWorkspace(
  groupId: string,
  workspaceId: string,
): Promise<void> {
  const group = await prisma.taskGroup.findUnique({
    where: { id: groupId },
    select: { workspaceId: true },
  });
  if (!group || group.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Task group not in workspace");
  }
}

/**
 * Task templates are either "built-in" (`workspaceId IS NULL`, seeded from
 * `templates/...`) or user-owned. Built-ins are readable by any workspace but
 * **not mutable**, so assertions come in two flavors:
 *
 *   - `assertTaskTemplateReadableInWorkspace` — ok for built-in OR caller-owned
 *   - `assertTaskTemplateWritableInWorkspace` — ok ONLY for caller-owned
 */
export async function assertTaskTemplateReadableInWorkspace(
  templateId: string,
  workspaceId: string,
): Promise<void> {
  const template = await prisma.taskTemplate.findUnique({
    where: { id: templateId },
    select: { workspaceId: true },
  });
  if (!template) {
    throw new WorkspaceScopeError("Task template not found");
  }
  if (template.workspaceId !== null && template.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Task template not in workspace");
  }
}

export async function assertTaskTemplateWritableInWorkspace(
  templateId: string,
  workspaceId: string,
): Promise<void> {
  const template = await prisma.taskTemplate.findUnique({
    where: { id: templateId },
    select: { workspaceId: true },
  });
  if (!template || template.workspaceId !== workspaceId) {
    throw new WorkspaceScopeError("Task template not in workspace");
  }
}
