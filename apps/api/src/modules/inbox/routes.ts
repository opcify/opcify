import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";
import { requireWorkspaceAuth } from "../../middleware/workspace.js";
import {
  saveDraftAttachment,
  removeDraftAttachments,
  type EmailAttachmentMeta,
} from "./email-attachments.js";
import { getGmailStatus } from "../auth/gmail-service.js";

const log = createLogger("inbox");

// --- Zod schemas ---

const workspaceParams = z.object({
  workspaceId: z.string().min(1),
});

const workspaceIdParams = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
});

const listQuery = z.object({
  // "archived" is a virtual filter — there is no `status: "archived"` row in
  // the DB. The archive action sets `status: "processed"` + `actionTaken:
  // "archived"`, so when we receive `status=archived` here we translate it
  // into that compound where clause in the handler below.
  status: z
    .enum(["inbox", "clarified", "processed", "snoozed", "draft", "archived"])
    .optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  source: z.enum(["manual", "agent", "system", "client", "email", "compose"]).optional(),
  q: z.string().optional(),
});

const createBody = z.object({
  content: z.string().min(1),
  kind: z.enum(["idea", "request", "follow_up", "reminder", "email"]).optional(),
  source: z.enum(["manual", "agent", "system", "client", "email"]).optional(),
  emailMessageId: z.string().optional(),
  emailFrom: z.string().optional(),
  emailTo: z.string().optional(),
  emailSubject: z.string().optional(),
  emailDate: z.string().optional(),
  emailThreadId: z.string().optional(),
  emailInReplyTo: z.string().optional(),
  emailLabels: z.string().optional(),
  aiSummary: z.string().optional(),
  aiUrgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  aiSuggestedAction: z
    .enum([
      "create_task",
      "break_down",
      "snooze",
      "approve_draft",
      "reply",
      "delegate",
      "forward",
    ])
    .nullable()
    .optional(),
  aiDraftReply: z.string().optional(),
});

const updateBody = z.object({
  content: z.string().optional(),
  status: z.enum(["inbox", "clarified", "processed", "snoozed", "draft"]).optional(),
  kind: z
    .enum(["idea", "request", "follow_up", "reminder", "email"])
    .nullable()
    .optional(),
  snoozedUntil: z.string().nullable().optional(),
  convertedTaskId: z.string().nullable().optional(),
  convertedGroupId: z.string().nullable().optional(),
  emailIsRead: z.boolean().optional(),
  actionTaken: z
    .enum(["approved", "delegated", "replied", "converted", "snoozed", "archived"])
    .optional(),
  actionAgentId: z.string().nullable().optional(),
  linkedClientId: z.string().nullable().optional(),
  aiDraftReply: z.string().nullable().optional(),
});

const actionBody = z.object({
  action: z.enum([
    "approve_draft",
    "delegate",
    "reply",
    "convert_task",
    "snooze",
    "archive",
    "forward",
  ]),
  editedDraft: z.string().optional(),
  agentId: z.string().optional(),
  replyContent: z.string().optional(),
  taskTitle: z.string().optional(),
  taskDescription: z.string().optional(),
  taskAgentId: z.string().optional(),
  taskPriority: z.enum(["low", "medium", "high"]).optional(),
  snoozeUntil: z.string().optional(),
  forwardTo: z.string().optional(),
  clientId: z.string().optional(),
});

const batchBody = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["archive", "snooze", "mark_read"]),
  snoozeUntil: z.string().optional(),
});

// --- Email compose schemas ---

const draftCreateBody = z.object({
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
});

const draftUpdateBody = z.object({
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  attachments: z
    .array(
      z.object({
        path: z.string(),
        fileName: z.string(),
        mediaType: z.string(),
        size: z.number(),
      }),
    )
    .optional(),
});

const draftAttachmentBody = z.object({
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  data: z.string().min(1), // base64
});

const composeBody = z.object({
  agentId: z.string().min(1),
  draftId: z.string().optional(),
  to: z.array(z.string().min(1)).min(1),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

// Strip empty strings, normalize comma-separated form for emailTo/emailCc/emailBcc.
function joinAddresses(list: string[] | undefined): string | null {
  if (!list) return null;
  const cleaned = list.map((s) => s.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : null;
}

// ── Placeholder dedup helpers ────────────────────────────────────

/** Extract a bare email address ("a@b.com") from "Name <a@b.com>" or similar. */
function parseEmailAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Parse a comma-separated header field into a Set of bare email addresses. */
function parseEmailSet(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const addr = parseEmailAddress(part);
    if (addr) out.add(addr);
  }
  return out;
}

/** Strip Re:/Fwd: chains, lowercase, trim — for cross-row subject matching. */
function normalizeEmailSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .replace(/^(\s*(Re|RE|Fwd|FW|Fw|re|fwd|fw)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

/** Window for matching a watcher push to a placeholder created by /inbox/compose. */
const PLACEHOLDER_MATCH_WINDOW_MS = 30 * 60 * 1000;

function parseAttachmentsJson(json: string | null): EmailAttachmentMeta[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as EmailAttachmentMeta[]) : [];
  } catch {
    return [];
  }
}

/**
 * An "empty" email row has nothing worth showing — no sender, no recipient,
 * no subject, no body, and no attachments. These are usually leftover drafts
 * from a Compose window the user opened and closed without typing anything.
 * We hide them from list responses and let the cleanup endpoint delete them.
 */
function isEmptyEmailRow(item: {
  kind: string | null;
  emailFrom: string | null;
  emailTo: string | null;
  emailCc: string | null;
  emailBcc: string | null;
  emailSubject: string | null;
  content: string;
  attachmentsJson: string | null;
}): boolean {
  if (item.kind !== "email") return false;
  const has = (s: string | null | undefined) => !!s && s.trim().length > 0;
  if (has(item.emailFrom)) return false;
  if (has(item.emailTo)) return false;
  if (has(item.emailCc)) return false;
  if (has(item.emailBcc)) return false;
  if (has(item.emailSubject)) return false;
  if (has(item.content)) return false;
  if (parseAttachmentsJson(item.attachmentsJson).length > 0) return false;
  return true;
}

// --- Urgency sort order ---

const urgencyOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// --- Routes ---

export async function inboxRoutes(app: FastifyInstance) {
  const preHandler = requireWorkspaceAuth;

  // List inbox items
  app.get("/workspaces/:workspaceId/inbox", { preHandler }, async (req) => {
    const { workspaceId } = workspaceParams.parse(req.params);
    const { status, urgency, source, q } = listQuery.parse(req.query);

    const where: Record<string, unknown> = { workspaceId };

    if (status === "archived") {
      // Virtual filter — see comment on the listQuery schema.
      where.status = "processed";
      where.actionTaken = "archived";
    } else if (status) {
      where.status = status;
    }
    // Note: when no status filter is passed (the "All" tab), we exclude
    // archived rows in the application-layer filter below — Prisma's
    // `NOT { actionTaken: "archived" }` would also drop rows where
    // actionTaken IS NULL because of SQL three-valued logic.

    if (urgency) {
      where.aiUrgency = urgency;
    }

    if (source) {
      where.source = source;
    }

    if (q) {
      where.OR = [
        { content: { contains: q } },
        { emailSubject: { contains: q } },
        { emailFrom: { contains: q } },
        { aiSummary: { contains: q } },
      ];
    }

    const items = await prisma.inboxItem.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
    });

    const isAllTab = !status;

    // Drop empty email rows (no from, no to, no subject, no body, no
    // attachments). These are usually leftover drafts from a Compose window
    // the user opened and then closed without typing anything. They have
    // nothing useful to display. Also exclude archived rows when no status
    // filter was passed so the "All" tab doesn't leak archived items.
    const filtered = items.filter((item) => {
      if (isEmptyEmailRow(item)) return false;
      if (isAllTab && item.actionTaken === "archived") return false;
      return true;
    });

    // Sort by urgency then date in application layer
    filtered.sort((a, b) => {
      const ua = urgencyOrder[a.aiUrgency ?? ""] ?? 99;
      const ub = urgencyOrder[b.aiUrgency ?? ""] ?? 99;
      if (ua !== ub) return ua - ub;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return filtered;
  });

  // Stats for sidebar badge
  app.get("/workspaces/:workspaceId/inbox/stats", { preHandler }, async (req) => {
    const { workspaceId } = workspaceParams.parse(req.params);

    const [inbox, critical, high] = await Promise.all([
      prisma.inboxItem.count({
        where: { workspaceId, status: "inbox" },
      }),
      prisma.inboxItem.count({
        where: { workspaceId, status: "inbox", aiUrgency: "critical" },
      }),
      prisma.inboxItem.count({
        where: { workspaceId, status: "inbox", aiUrgency: "high" },
      }),
    ]);

    return { inbox, critical, high };
  });

  // Batch actions
  app.post("/workspaces/:workspaceId/inbox/batch", { preHandler }, async (req, reply) => {
    const { workspaceId } = workspaceParams.parse(req.params);
    const { ids, action, snoozeUntil } = batchBody.parse(req.body);

    // Restrict the set to ids that actually belong to this workspace.
    // Cross-workspace ids are silently filtered so an attacker can't mix
    // a readable id with N inaccessible ones.
    const scoped = await prisma.inboxItem.findMany({
      where: { id: { in: ids }, workspaceId },
      select: { id: true },
    });
    const scopedIds = scoped.map((r) => r.id);
    if (scopedIds.length !== ids.length) {
      return reply.status(404).send({ error: "Inbox items not found" });
    }

    if (action === "archive") {
      await prisma.inboxItem.updateMany({
        where: { id: { in: scopedIds }, workspaceId },
        data: { status: "processed", actionTaken: "archived" },
      });
    } else if (action === "snooze") {
      await prisma.inboxItem.updateMany({
        where: { id: { in: scopedIds }, workspaceId },
        data: {
          status: "snoozed",
          snoozedUntil: snoozeUntil ? new Date(snoozeUntil) : null,
          actionTaken: "snoozed",
        },
      });
    } else if (action === "mark_read") {
      await prisma.inboxItem.updateMany({
        where: { id: { in: scopedIds }, workspaceId },
        data: { emailIsRead: true },
      });
    }

    return { ok: true };
  });

  // Get single item
  app.get("/workspaces/:workspaceId/inbox/:id", { preHandler }, async (req, reply) => {
    const { workspaceId, id } = workspaceIdParams.parse(req.params);

    const item = await prisma.inboxItem.findFirst({
      where: { id, workspaceId },
    });

    if (!item) {
      return reply.status(404).send({ error: "Inbox item not found" });
    }

    return item;
  });

  // Get thread (all items sharing emailThreadId)
  app.get(
    "/workspaces/:workspaceId/inbox/:id/thread",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);

      const item = await prisma.inboxItem.findFirst({
        where: { id, workspaceId },
      });

      if (!item) {
        return reply.status(404).send({ error: "Inbox item not found" });
      }

      if (!item.emailThreadId) {
        return [item];
      }

      return prisma.inboxItem.findMany({
        where: {
          workspaceId,
          emailThreadId: item.emailThreadId,
        },
        orderBy: { createdAt: "asc" },
      });
    },
  );

  // Create inbox item (used by agents to push emails)
  app.post("/workspaces/:workspaceId/inbox", { preHandler }, async (req, reply) => {
    const { workspaceId } = workspaceParams.parse(req.params);
    const body = createBody.parse(req.body);

    // Dedup by emailMessageId
    if (body.emailMessageId) {
      const existing = await prisma.inboxItem.findFirst({
        where: { workspaceId, emailMessageId: body.emailMessageId },
      });
      if (existing) {
        log.info("Duplicate email skipped", {
          emailMessageId: body.emailMessageId,
        });
        return existing;
      }

      // Placeholder upgrade: when the Gmail Sent-folder watcher pushes a row
      // for an email that we just composed via POST /inbox/compose, the
      // compose endpoint already inserted a placeholder row with
      // `emailMessageId: null` so the user could see the message instantly.
      // Match it on subject + recipient + recency and *upgrade* the placeholder
      // with the real Gmail metadata instead of inserting a duplicate.
      const incomingSubject = normalizeEmailSubject(body.emailSubject);
      const incomingFrom = parseEmailAddress(body.emailFrom);
      const incomingTo = parseEmailSet(body.emailTo);

      if (incomingSubject && incomingTo.size > 0) {
        const cutoff = new Date(Date.now() - PLACEHOLDER_MATCH_WINDOW_MS);
        const candidates = await prisma.inboxItem.findMany({
          where: {
            workspaceId,
            emailMessageId: null,
            kind: "email",
            createdAt: { gte: cutoff },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        });

        for (const cand of candidates) {
          if (normalizeEmailSubject(cand.emailSubject) !== incomingSubject) {
            continue;
          }
          const candTo = parseEmailSet(cand.emailTo);
          let toOverlap = false;
          for (const addr of incomingTo) {
            if (candTo.has(addr)) {
              toOverlap = true;
              break;
            }
          }
          if (!toOverlap) continue;

          // emailFrom is optional but, when both sides have it, must agree.
          const candFrom = parseEmailAddress(cand.emailFrom);
          if (incomingFrom && candFrom && incomingFrom !== candFrom) continue;

          const upgraded = await prisma.inboxItem.update({
            where: { id: cand.id },
            data: {
              emailMessageId: body.emailMessageId,
              emailThreadId: body.emailThreadId || cand.emailThreadId,
              emailInReplyTo: body.emailInReplyTo || cand.emailInReplyTo,
              emailLabels: body.emailLabels || cand.emailLabels,
              emailDate: body.emailDate ? new Date(body.emailDate) : cand.emailDate,
              // Prefer the agent-supplied sender if our placeholder didn't have one
              emailFrom: cand.emailFrom || body.emailFrom || null,
            },
          });
          log.info("Sent-mail placeholder upgraded with watcher metadata", {
            placeholderId: cand.id,
            messageId: body.emailMessageId,
          });
          return reply.status(200).send(upgraded);
        }
      }
    }

    const item = await prisma.inboxItem.create({
      data: {
        content: body.content,
        kind: body.kind || null,
        source: body.source || "manual",
        emailMessageId: body.emailMessageId || null,
        emailFrom: body.emailFrom || null,
        emailTo: body.emailTo || null,
        emailSubject: body.emailSubject || null,
        emailDate: body.emailDate ? new Date(body.emailDate) : null,
        emailThreadId: body.emailThreadId || null,
        emailInReplyTo: body.emailInReplyTo || null,
        emailLabels: body.emailLabels || null,
        aiSummary: body.aiSummary || null,
        aiUrgency: body.aiUrgency || null,
        aiSuggestedAction: body.aiSuggestedAction || null,
        aiDraftReply: body.aiDraftReply || null,
        workspaceId,
      },
    });

    log.info("Inbox item created", {
      id: item.id,
      source: item.source,
      emailFrom: item.emailFrom,
    });

    return reply.status(201).send(item);
  });

  // Update inbox item
  app.patch("/workspaces/:workspaceId/inbox/:id", { preHandler }, async (req, reply) => {
    const { workspaceId, id } = workspaceIdParams.parse(req.params);
    const body = updateBody.parse(req.body);

    const data: Record<string, unknown> = {};
    if (body.content !== undefined) data.content = body.content;
    if (body.status !== undefined) data.status = body.status;
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.snoozedUntil !== undefined)
      data.snoozedUntil = body.snoozedUntil ? new Date(body.snoozedUntil) : null;
    if (body.convertedTaskId !== undefined) data.convertedTaskId = body.convertedTaskId;
    if (body.convertedGroupId !== undefined)
      data.convertedGroupId = body.convertedGroupId;
    if (body.emailIsRead !== undefined) data.emailIsRead = body.emailIsRead;
    if (body.actionTaken !== undefined) data.actionTaken = body.actionTaken;
    if (body.actionAgentId !== undefined) data.actionAgentId = body.actionAgentId;
    if (body.linkedClientId !== undefined) data.linkedClientId = body.linkedClientId;
    if (body.aiDraftReply !== undefined) data.aiDraftReply = body.aiDraftReply;

    const result = await prisma.inboxItem.updateMany({
      where: { id, workspaceId },
      data,
    });
    if (result.count === 0) {
      return reply.status(404).send({ error: "Inbox item not found" });
    }
    return prisma.inboxItem.findUnique({ where: { id } });
  });

  // Execute action on inbox item
  app.post(
    "/workspaces/:workspaceId/inbox/:id/action",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      const body = actionBody.parse(req.body);

      const item = await prisma.inboxItem.findFirst({
        where: { id, workspaceId },
      });
      if (!item) {
        return reply.status(404).send({ error: "Inbox item not found" });
      }

      const { action } = body;

      if (action === "archive") {
        await prisma.inboxItem.update({
          where: { id },
          data: { status: "processed", actionTaken: "archived" },
        });
        return { ok: true };
      }

      if (action === "snooze") {
        await prisma.inboxItem.update({
          where: { id },
          data: {
            status: "snoozed",
            snoozedUntil: body.snoozeUntil ? new Date(body.snoozeUntil) : null,
            actionTaken: "snoozed",
          },
        });
        return { ok: true };
      }

      if (action === "convert_task") {
        const agentId = body.taskAgentId;
        if (!agentId) {
          return reply
            .status(400)
            .send({ error: "taskAgentId is required for convert_task" });
        }

        const task = await prisma.task.create({
          data: {
            title: body.taskTitle || item.emailSubject || item.content.slice(0, 100),
            description:
              body.taskDescription ||
              `From email: ${item.emailFrom || "unknown"}\n\n${item.content}`,
            agentId,
            priority: body.taskPriority || "medium",
            status: "queued",
            workspaceId: item.workspaceId!,
            clientId: body.clientId || null,
          },
        });

        await prisma.inboxItem.update({
          where: { id },
          data: {
            status: "processed",
            actionTaken: "converted",
            convertedTaskId: task.id,
            linkedClientId: body.clientId || item.linkedClientId,
          },
        });

        log.info("Inbox item converted to task", {
          inboxId: id,
          taskId: task.id,
        });
        return { ok: true, resultId: task.id };
      }

      if (action === "approve_draft" || action === "reply" || action === "forward") {
        const agentId = body.agentId;
        if (!agentId) {
          return reply
            .status(400)
            .send({ error: "agentId is required for email actions" });
        }

        const draftContent =
          action === "approve_draft"
            ? body.editedDraft || item.aiDraftReply || ""
            : action === "reply"
              ? body.replyContent || ""
              : item.content;

        const actionLabel =
          action === "forward"
            ? "Forward"
            : action === "approve_draft"
              ? "Send approved reply"
              : "Send reply";

        const recipient = action === "forward" ? body.forwardTo : item.emailFrom;

        // Send a chat message directly to the Personal Assistant agent
        // instead of creating a task (which would go through the orchestrator
        // dispatch template and confuse the agent about its role).
        const { chatService } = await import("../chat/service.js");
        const { agentSlug } = await import("../agents/workspace-sync.js");

        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
        });
        if (!agent) {
          return reply.status(404).send({ error: "Agent not found" });
        }

        const slug = agentSlug(agent.name);
        const message = [
          `[INBOX-ACTION] ${actionLabel}`,
          ``,
          `The user approved this email action from the Inbox page. Please execute it now using himalaya.`,
          ``,
          `**To:** ${recipient}`,
          `**Subject:** Re: ${item.emailSubject || ""}`,
          item.emailMessageId ? `**In-Reply-To:** ${item.emailMessageId}` : "",
          ``,
          `---`,
          ``,
          draftContent,
          ``,
          `---`,
          ``,
          `After sending, update the inbox item:`,
          `curl -s -X PATCH "\${OPCIFY_API_URL}/workspaces/\${OPCIFY_WORKSPACE_ID}/inbox/${id}" -H "Content-Type: application/json" \${OPCIFY_API_KEY:+-H "Authorization: Bearer \${OPCIFY_API_KEY}"} -d '{"status":"processed","actionTaken":"${action === "approve_draft" ? "approved" : action === "reply" ? "replied" : "delegated"}"}'`,
        ]
          .filter(Boolean)
          .join("\n");

        try {
          await chatService.send(item.workspaceId!, slug, {
            sessionKey: "email",
            message,
          });
        } catch (err) {
          log.error(`Failed to send email action to agent: ${(err as Error).message}`);
          return reply.status(502).send({ error: "Failed to send message to agent" });
        }

        const actionTaken =
          action === "approve_draft"
            ? "approved"
            : action === "reply"
              ? "replied"
              : "delegated";

        await prisma.inboxItem.update({
          where: { id },
          data: {
            status: "processed",
            actionTaken: actionTaken as string,
            actionAgentId: agentId,
            linkedClientId: body.clientId || item.linkedClientId,
            aiDraftReply: null,
          },
        });

        // Save the sent reply as an InboxItem so it appears in the thread view
        if (action !== "forward") {
          await prisma.inboxItem.create({
            data: {
              content: draftContent,
              kind: "email",
              source: "email",
              emailFrom: item.emailTo || null,
              emailTo: item.emailFrom || null,
              emailSubject: item.emailSubject
                ? `Re: ${item.emailSubject.replace(/^(\s*(Re|RE|Fwd|FW|Fw|re|fwd|fw)\s*:\s*)+/i, "").trim()}`
                : null,
              emailDate: new Date(),
              emailThreadId: item.emailThreadId || null,
              emailInReplyTo: item.emailMessageId || null,
              emailIsRead: true,
              status: "processed",
              actionTaken: actionTaken as string,
              workspaceId: item.workspaceId,
            },
          });
        }

        log.info("Inbox email action sent to agent via chat", {
          inboxId: id,
          action,
          agentSlug: slug,
        });
        return { ok: true };
      }

      if (action === "delegate") {
        const agentId = body.agentId;
        if (!agentId) {
          return reply.status(400).send({ error: "agentId is required for delegate" });
        }

        // Send chat message to the agent instead of creating a task
        const { chatService } = await import("../chat/service.js");
        const { agentSlug } = await import("../agents/workspace-sync.js");

        const agent = await prisma.agent.findUnique({
          where: { id: agentId },
        });
        if (!agent) {
          return reply.status(404).send({ error: "Agent not found" });
        }

        const slug = agentSlug(agent.name);
        const message = [
          `[INBOX-ACTION] Handle this email`,
          ``,
          `The user delegated this email to you from the Inbox page. Please handle it appropriately.`,
          ``,
          `**From:** ${item.emailFrom || "unknown"}`,
          `**Subject:** ${item.emailSubject || "N/A"}`,
          ``,
          `---`,
          ``,
          item.content,
          ``,
          `---`,
          ``,
          `After handling, update the inbox item:`,
          `curl -s -X PATCH "\${OPCIFY_API_URL}/workspaces/\${OPCIFY_WORKSPACE_ID}/inbox/${id}" -H "Content-Type: application/json" \${OPCIFY_API_KEY:+-H "Authorization: Bearer \${OPCIFY_API_KEY}"} -d '{"status":"processed","actionTaken":"delegated"}'`,
        ].join("\n");

        try {
          await chatService.send(item.workspaceId!, slug, {
            sessionKey: "email",
            message,
          });
        } catch (err) {
          log.error(`Failed to delegate email to agent: ${(err as Error).message}`);
          return reply.status(502).send({ error: "Failed to send message to agent" });
        }

        await prisma.inboxItem.update({
          where: { id },
          data: {
            status: "processed",
            actionTaken: "delegated",
            actionAgentId: agentId,
            linkedClientId: body.clientId || item.linkedClientId,
          },
        });

        log.info("Inbox item delegated to agent via chat", {
          inboxId: id,
          agentSlug: slug,
        });
        return { ok: true };
      }

      return reply.status(400).send({ error: `Unknown action: ${action}` });
    },
  );

  // Delete inbox item
  app.delete("/workspaces/:workspaceId/inbox/:id", { preHandler }, async (req, reply) => {
    const { workspaceId, id } = workspaceIdParams.parse(req.params);

    const result = await prisma.inboxItem.deleteMany({
      where: { id, workspaceId },
    });
    if (result.count === 0) {
      return reply.status(404).send({ error: "Inbox item not found" });
    }
    return reply.status(204).send();
  });

  // ─── Email compose: draft CRUD ────────────────────────────────────

  // Create a new draft
  app.post(
    "/workspaces/:workspaceId/inbox/drafts",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = draftCreateBody.parse(req.body);

      const draft = await prisma.inboxItem.create({
        data: {
          content: body.body || "",
          kind: "email",
          source: "compose",
          status: "draft",
          emailTo: joinAddresses(body.to),
          emailCc: joinAddresses(body.cc),
          emailBcc: joinAddresses(body.bcc),
          emailSubject: body.subject || null,
          emailDate: new Date(),
          emailIsRead: true,
          workspaceId,
        },
      });

      log.info("Email draft created", { id: draft.id });
      return reply.status(201).send(draft);
    },
  );

  // Patch a draft (autosave)
  app.patch(
    "/workspaces/:workspaceId/inbox/drafts/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      const body = draftUpdateBody.parse(req.body);

      const existing = await prisma.inboxItem.findFirst({
        where: { id, workspaceId },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Draft not found" });
      }
      if (existing.status !== "draft") {
        return reply.status(409).send({ error: "Cannot edit a non-draft inbox item" });
      }

      const data: Record<string, unknown> = {};
      if (body.to !== undefined) data.emailTo = joinAddresses(body.to);
      if (body.cc !== undefined) data.emailCc = joinAddresses(body.cc);
      if (body.bcc !== undefined) data.emailBcc = joinAddresses(body.bcc);
      if (body.subject !== undefined) data.emailSubject = body.subject || null;
      if (body.body !== undefined) data.content = body.body;
      if (body.attachments !== undefined) {
        data.attachmentsJson = JSON.stringify(body.attachments);
      }

      const updated = await prisma.inboxItem.update({ where: { id }, data });
      return updated;
    },
  );

  // Upload an attachment to a draft
  app.post(
    "/workspaces/:workspaceId/inbox/drafts/:id/attachments",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);
      const body = draftAttachmentBody.parse(req.body);

      const draft = await prisma.inboxItem.findFirst({
        where: { id, workspaceId },
      });
      if (!draft) {
        return reply.status(404).send({ error: "Draft not found" });
      }
      if (draft.status !== "draft") {
        return reply
          .status(409)
          .send({ error: "Cannot attach files to a non-draft item" });
      }

      let meta: EmailAttachmentMeta;
      try {
        meta = await saveDraftAttachment(workspaceId, id, {
          fileName: body.fileName,
          mediaType: body.mediaType,
          data: body.data,
        });
      } catch (err) {
        log.error(`Failed to save draft attachment: ${(err as Error).message}`);
        return reply.status(500).send({ error: "Failed to save attachment" });
      }

      const existingMeta = parseAttachmentsJson(draft.attachmentsJson);
      const next = [...existingMeta, meta];
      await prisma.inboxItem.update({
        where: { id },
        data: { attachmentsJson: JSON.stringify(next) },
      });

      return reply.status(201).send(meta);
    },
  );

  // Discard a draft
  app.delete(
    "/workspaces/:workspaceId/inbox/drafts/:id",
    { preHandler },
    async (req, reply) => {
      const { workspaceId, id } = workspaceIdParams.parse(req.params);

      const draft = await prisma.inboxItem.findFirst({
        where: { id, workspaceId },
      });
      if (!draft) {
        return reply.status(404).send({ error: "Draft not found" });
      }
      if (draft.status !== "draft") {
        return reply.status(409).send({ error: "Cannot discard a non-draft item" });
      }

      await prisma.inboxItem.delete({ where: { id } });
      await removeDraftAttachments(workspaceId, id).catch(() => {
        /* best effort */
      });
      return reply.status(204).send();
    },
  );

  // Bulk-delete empty draft rows for a workspace. The frontend calls this
  // once when the inbox page mounts so legacy "Unknown / No subject" rows
  // (drafts the user opened and abandoned before we added the auto-discard
  // path) get cleaned up automatically. Idempotent — safe to call repeatedly.
  app.post(
    "/workspaces/:workspaceId/inbox/cleanup-empty-drafts",
    { preHandler },
    async (req) => {
      const { workspaceId } = workspaceParams.parse(req.params);

      // Pull all candidates and apply the same emptiness check the GET filter
      // uses, so the two definitions stay in sync.
      const candidates = await prisma.inboxItem.findMany({
        where: { workspaceId, status: "draft" },
      });

      const emptyIds: string[] = [];
      for (const item of candidates) {
        if (isEmptyEmailRow(item)) emptyIds.push(item.id);
      }

      if (emptyIds.length === 0) {
        return { deleted: 0 };
      }

      await prisma.inboxItem.deleteMany({
        where: { id: { in: emptyIds } },
      });
      // Best-effort cleanup of any on-disk attachment dirs (there shouldn't be
      // any for empty drafts, but it's cheap and idempotent).
      for (const id of emptyIds) {
        await removeDraftAttachments(workspaceId, id).catch(() => {
          /* best effort */
        });
      }

      log.info("Cleaned up empty draft rows", {
        workspaceId,
        deleted: emptyIds.length,
      });
      return { deleted: emptyIds.length };
    },
  );

  // Send a draft (or one-shot send) via the personal assistant agent.
  app.post(
    "/workspaces/:workspaceId/inbox/compose",
    { preHandler },
    async (req, reply) => {
      const { workspaceId } = workspaceParams.parse(req.params);
      const body = composeBody.parse(req.body);

      const agent = await prisma.agent.findFirst({
        where: { id: body.agentId, workspaceId },
      });
      if (!agent) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      let attachments: EmailAttachmentMeta[] = [];
      let draft: Awaited<ReturnType<typeof prisma.inboxItem.findUnique>> = null;

      if (body.draftId) {
        draft = await prisma.inboxItem.findFirst({
          where: { id: body.draftId, workspaceId },
        });
        if (!draft) {
          return reply.status(404).send({ error: "Draft not found" });
        }
        if (draft.status !== "draft") {
          return reply.status(409).send({ error: "Referenced item is not a draft" });
        }
        attachments = parseAttachmentsJson(draft.attachmentsJson);
      }

      const { chatService } = await import("../chat/service.js");
      const { agentSlug } = await import("../agents/workspace-sync.js");
      const slug = agentSlug(agent.name);

      const toLine = body.to.join(", ");
      const ccLine = joinAddresses(body.cc);
      const bccLine = joinAddresses(body.bcc);

      const messageLines = [
        `[INBOX-ACTION] Compose new email`,
        ``,
        `The user composed a new email from the Inbox page. Please send it now using himalaya.`,
        ``,
        `**To:** ${toLine}`,
        ccLine ? `**Cc:** ${ccLine}` : "",
        bccLine ? `**Bcc:** ${bccLine}` : "",
        `**Subject:** ${body.subject}`,
        ``,
        `---`,
        ``,
        body.body,
        ``,
        `---`,
        ``,
      ];

      if (attachments.length) {
        messageLines.push(`**Attachments:** (pass each path to himalaya with -a)`);
        for (const att of attachments) {
          messageLines.push(`- ${att.path} (${att.fileName}, ${att.mediaType})`);
        }
        messageLines.push(``);
      }

      try {
        await chatService.send(workspaceId, slug, {
          sessionKey: "email",
          message: messageLines.filter(Boolean).join("\n"),
        });
      } catch (err) {
        log.error(`Failed to send compose to agent: ${(err as Error).message}`);
        return reply.status(502).send({ error: "Failed to send message to agent" });
      }

      // Look up the connected Gmail account so the sent message has a proper
      // sender address (otherwise the inbox UI shows "Unknown" for our own row).
      let fromAddress: string | null = null;
      try {
        const status = await getGmailStatus(workspaceId);
        if (status.connected && status.email) {
          fromAddress = status.email;
        }
      } catch {
        // Best effort — fall back to null sender if Gmail metadata is unreadable.
      }

      // Persist the sent mail as an InboxItem so it shows up in the inbox view.
      const sent = await prisma.inboxItem.create({
        data: {
          content: body.body,
          kind: "email",
          source: "email",
          status: "processed",
          actionTaken: "replied",
          actionAgentId: body.agentId,
          emailFrom: fromAddress,
          emailTo: toLine,
          emailCc: ccLine,
          emailBcc: bccLine,
          emailSubject: body.subject,
          emailDate: new Date(),
          emailIsRead: true,
          attachmentsJson: attachments.length ? JSON.stringify(attachments) : null,
          workspaceId: workspaceId,
        },
      });

      if (draft) {
        await prisma.inboxItem.delete({ where: { id: draft.id } }).catch(() => {
          /* draft already gone */
        });
      }

      log.info("Email composed and dispatched to agent", {
        sentId: sent.id,
        draftId: body.draftId || null,
        agentSlug: slug,
      });

      return { ok: true, inboxItemId: sent.id };
    },
  );
}
