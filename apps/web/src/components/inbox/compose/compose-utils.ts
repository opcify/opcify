import type { EmailPatch, ChatMessage } from "@opcify/core";

/** Marker fences used to keep the LLM-facing wrapper out of the visible chat. */
export const COMPOSE_CONTEXT_TAG = "[COMPOSE-CONTEXT]";
export const USER_TAG = "[USER]";

/**
 * Extract the first ```email-patch JSON block from an assistant text reply.
 * Returns null if no block is present or the JSON is unparseable / malformed.
 */
export function extractEmailPatch(text: string): EmailPatch | null {
  const match = text.match(/```email-patch\s*([\s\S]*?)```/);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const patch: EmailPatch = {};

  const stringArray = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === "string");
    return out;
  };

  const to = stringArray(obj.to);
  const cc = stringArray(obj.cc);
  const bcc = stringArray(obj.bcc);
  if (to !== undefined) patch.to = to;
  if (cc !== undefined) patch.cc = cc;
  if (bcc !== undefined) patch.bcc = bcc;
  if (typeof obj.subject === "string") patch.subject = obj.subject;
  if (typeof obj.body === "string") patch.body = obj.body;
  if (typeof obj.send === "boolean") patch.send = obj.send;

  // Treat patches with no recognised keys as null.
  if (Object.keys(patch).length === 0) return null;
  return patch;
}

/** Remove the email-patch fence from a text block so the user only sees prose. */
export function stripEmailPatchBlocks(text: string): string {
  return text.replace(/```email-patch\s*[\s\S]*?```/g, "").trim();
}

/**
 * Strip the [COMPOSE-CONTEXT] wrapper that augments user messages so the visible
 * chat history shows only what the user actually typed.
 */
export function stripComposeContext(text: string): string {
  const idx = text.indexOf(USER_TAG);
  if (idx === -1) return text;
  return text.slice(idx + USER_TAG.length).trim();
}

/** Build the wrapper text injected into every user message. */
export function buildAugmentedMessage(
  userMessage: string,
  draftJson: string,
): string {
  return [
    COMPOSE_CONTEXT_TAG,
    `Current draft (JSON): ${draftJson}`,
    "Protocol: To modify the draft, include exactly one fenced code block ```email-patch with a JSON object containing any of: to (string[]), cc (string[]), bcc (string[]), subject (string), body (string markdown), send (boolean). Plain text outside the block is shown to the user as your reply. To send the email immediately, set \"send\": true.",
    "",
    USER_TAG,
    userMessage,
  ].join("\n");
}

/**
 * Map raw chat messages so any [COMPOSE-CONTEXT] wrapper or ```email-patch fence
 * is hidden from the rendered conversation. Empty content blocks are dropped so
 * a pure-patch assistant reply collapses cleanly.
 */
export function sanitizeMessagesForDisplay(
  messages: ChatMessage[],
): ChatMessage[] {
  return messages.map((msg) => {
    const content = msg.content
      .map((block) => {
        if (block.type !== "text") return block;
        let text = block.text;
        if (msg.role === "user") {
          text = stripComposeContext(text);
        } else {
          text = stripEmailPatchBlocks(text);
        }
        return { ...block, text };
      })
      .filter((block) => {
        if (block.type !== "text") return true;
        return block.text.trim().length > 0;
      });
    return { ...msg, content };
  });
}
