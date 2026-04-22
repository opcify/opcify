import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { createLogger } from "../../logger.js";

const log = createLogger("public-quotes");

const tokenParams = z.object({ shareToken: z.string().min(8) });
const declineBody = z.object({ reason: z.string().max(500).optional() });

type QuoteMetadata = {
  status: "draft" | "sent" | "viewed" | "accepted" | "declined" | "converted" | "expired";
  lineItems?: Array<{ description: string; qty: number; unitPrice: number }>;
  shareToken?: string;
  validUntil?: string;
  terms?: string;
  acceptedAt?: string;
  declinedAt?: string;
  declineReason?: string;
  convertedInvoiceId?: string;
  quoteNumber?: string;
};

type QuoteRow = Awaited<ReturnType<typeof findQuoteByToken>>;

async function findQuoteByToken(shareToken: string) {
  // SQLite has no JSON operators; scan quote rows and parse metadata in JS.
  const rows = await prisma.ledgerEntry.findMany({
    where: { type: "quote" },
    include: { client: true, workspace: { select: { name: true } } },
  });
  for (const row of rows) {
    if (!row.metadata) continue;
    try {
      const meta = JSON.parse(row.metadata) as QuoteMetadata;
      if (meta.shareToken === shareToken) return { row, meta };
    } catch {
      continue;
    }
  }
  return null;
}

function isExpired(meta: QuoteMetadata): boolean {
  if (meta.status === "expired") return true;
  if (!meta.validUntil) return false;
  return new Date(meta.validUntil).getTime() < Date.now();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderQuotePage(row: NonNullable<QuoteRow>["row"], meta: QuoteMetadata): string {
  const clientName = row.client?.name ?? "Client";
  const workspaceName = row.workspace?.name ?? "";
  const quoteNumber = meta.quoteNumber ?? row.id.slice(0, 8).toUpperCase();
  const items = meta.lineItems ?? [];
  const currency = row.currency || "USD";
  const total = row.amount;
  const validUntil = meta.validUntil
    ? new Date(meta.validUntil).toLocaleDateString()
    : "";
  const terminal = ["accepted", "declined", "converted", "expired"].includes(meta.status);

  const banner = (() => {
    if (meta.status === "accepted")
      return `<div class="banner ok">Accepted on ${meta.acceptedAt ? new Date(meta.acceptedAt).toLocaleString() : ""}</div>`;
    if (meta.status === "declined")
      return `<div class="banner no">Declined${meta.declineReason ? ` — ${escapeHtml(meta.declineReason)}` : ""}</div>`;
    if (meta.status === "converted")
      return `<div class="banner ok">Converted to invoice</div>`;
    if (isExpired(meta)) return `<div class="banner no">Expired</div>`;
    return "";
  })();

  const actions =
    terminal || isExpired(meta)
      ? ""
      : `<div class="actions">
        <button id="accept" class="btn ok">Accept quote</button>
        <button id="decline" class="btn no">Decline</button>
      </div>
      <script>
        const base = window.location.pathname;
        async function post(suffix, body) {
          const res = await fetch(base + suffix, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
          });
          if (res.ok) window.location.reload();
          else alert("Sorry — could not record your response. Please contact the sender.");
        }
        document.getElementById("accept").addEventListener("click", () => post("/accept", {}));
        document.getElementById("decline").addEventListener("click", () => {
          const reason = prompt("Optional: reason for declining?") || undefined;
          post("/decline", reason ? { reason } : {});
        });
      </script>`;

  const itemRows = items
    .map(
      (i) => `
        <tr>
          <td>${escapeHtml(i.description)}</td>
          <td class="num">${i.qty}</td>
          <td class="num">${currency} ${i.unitPrice.toFixed(2)}</td>
          <td class="num">${currency} ${(i.qty * i.unitPrice).toFixed(2)}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Quote ${escapeHtml(quoteNumber)} — ${escapeHtml(workspaceName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; background: #f7f7f5; margin: 0; padding: 32px 16px; }
    .card { max-width: 720px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: -0.01em; }
    .muted { color: #6b7280; font-size: 14px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .client { margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #eceae6; font-size: 14px; }
    th { font-weight: 600; color: #374151; background: #fafafa; }
    td.num, th.num { text-align: right; }
    .total { font-size: 20px; font-weight: 600; text-align: right; margin-top: 8px; }
    .terms { white-space: pre-wrap; background: #fafafa; padding: 12px 16px; border-radius: 8px; font-size: 14px; color: #374151; margin: 16px 0 24px; }
    .actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }
    .btn { border: 0; padding: 12px 20px; border-radius: 8px; font-size: 15px; font-weight: 500; cursor: pointer; }
    .btn.ok { background: #16a34a; color: white; }
    .btn.no { background: white; color: #991b1b; border: 1px solid #e5e7eb; }
    .banner { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; font-weight: 500; }
    .banner.ok { background: #dcfce7; color: #166534; }
    .banner.no { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="card">
    ${banner}
    <div class="head">
      <div>
        <h1>${escapeHtml(workspaceName) || "Quote"}</h1>
        <div class="muted">Quote #${escapeHtml(quoteNumber)}</div>
      </div>
      ${validUntil ? `<div class="muted">Valid until ${escapeHtml(validUntil)}</div>` : ""}
    </div>
    <div class="client">
      <div class="muted">Prepared for</div>
      <div style="font-weight: 600; font-size: 16px;">${escapeHtml(clientName)}</div>
    </div>
    <div>${escapeHtml(row.description)}</div>
    <table>
      <thead>
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="total">Total: ${currency} ${total.toFixed(2)}</div>
    ${meta.terms ? `<div class="terms">${escapeHtml(meta.terms)}</div>` : ""}
    ${actions}
  </div>
</body>
</html>`;
}

async function notifyInbox(
  workspaceId: string,
  content: string,
  urgency: "medium" | "high",
  clientId: string | null,
) {
  try {
    await prisma.inboxItem.create({
      data: {
        workspaceId,
        content,
        kind: "follow_up",
        source: "client",
        aiSummary: content,
        aiUrgency: urgency,
        linkedClientId: clientId ?? null,
      },
    });
  } catch (err) {
    log.error("Failed to create inbox notification", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function publicQuoteRoutes(app: FastifyInstance) {
  app.get("/public/quotes/:shareToken", async (req, reply) => {
    const { shareToken } = tokenParams.parse(req.params);
    const found = await findQuoteByToken(shareToken);
    if (!found)
      return reply.status(404).type("text/html").send("<h1>Quote not found</h1>");

    const { row, meta } = found;

    if (meta.status === "sent" && !isExpired(meta)) {
      const nextMeta = { ...meta, status: "viewed" as const };
      await prisma.ledgerEntry.update({
        where: { id: row.id },
        data: { metadata: JSON.stringify(nextMeta) },
      });
    }

    return reply.type("text/html").send(renderQuotePage(row, meta));
  });

  app.post("/public/quotes/:shareToken/accept", async (req, reply) => {
    const { shareToken } = tokenParams.parse(req.params);
    const found = await findQuoteByToken(shareToken);
    if (!found) return reply.status(404).send({ error: "Quote not found" });

    const { row, meta } = found;

    if (meta.status === "accepted") return { status: "accepted", alreadyAccepted: true };

    if (["declined", "converted", "expired"].includes(meta.status) || isExpired(meta)) {
      return reply.status(409).send({ error: `Quote is ${meta.status}` });
    }

    const nextMeta: QuoteMetadata = {
      ...meta,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    };
    await prisma.ledgerEntry.update({
      where: { id: row.id },
      data: { metadata: JSON.stringify(nextMeta) },
    });

    await notifyInbox(
      row.workspaceId,
      `${row.client?.name ?? "Client"} accepted quote #${meta.quoteNumber ?? row.id.slice(0, 8).toUpperCase()} (${row.currency} ${row.amount.toFixed(2)}). Convert to invoice when ready.`,
      "high",
      row.clientId,
    );

    return { status: "accepted" };
  });

  app.post("/public/quotes/:shareToken/decline", async (req, reply) => {
    const { shareToken } = tokenParams.parse(req.params);
    const { reason } = declineBody.parse(req.body ?? {});
    const found = await findQuoteByToken(shareToken);
    if (!found) return reply.status(404).send({ error: "Quote not found" });

    const { row, meta } = found;

    if (meta.status === "declined") return { status: "declined", alreadyDeclined: true };

    if (["accepted", "converted", "expired"].includes(meta.status) || isExpired(meta)) {
      return reply.status(409).send({ error: `Quote is ${meta.status}` });
    }

    const nextMeta: QuoteMetadata = {
      ...meta,
      status: "declined",
      declinedAt: new Date().toISOString(),
      declineReason: reason,
    };
    await prisma.ledgerEntry.update({
      where: { id: row.id },
      data: { metadata: JSON.stringify(nextMeta) },
    });

    await notifyInbox(
      row.workspaceId,
      `${row.client?.name ?? "Client"} declined quote #${meta.quoteNumber ?? row.id.slice(0, 8).toUpperCase()}${reason ? ` — "${reason}"` : ""}.`,
      "medium",
      row.clientId,
    );

    return { status: "declined" };
  });
}
