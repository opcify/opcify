import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ChatStreamEvent, ChatMessage, ChatSendInput, ChatHistoryResponse, ChatSessionInfo } from "@opcify/core";
import { GatewayWsClient } from "./gateway-client.js";
import { workspaceService } from "../../workspace/WorkspaceService.js";
import { loadWorkspaceFromDisk, readOpenClawConfig, writeOpenClawConfig, getDataDir } from "../../workspace/WorkspaceConfig.js";
import { createLogger } from "../../logger.js";

const log = createLogger("chat-service");

/**
 * Manages a pool of WebSocket gateway clients (one per workspace) and relays
 * chat streaming events to SSE listeners.
 */
class ChatService {
  /** workspaceId → GatewayWsClient */
  private clients = new Map<string, GatewayWsClient>();

  /** workspaceId → in-flight connection promise (prevents duplicate clients) */
  private connecting = new Map<string, Promise<GatewayWsClient>>();

  /** "${workspaceId}:${agentSlug}:${sessionKey}" → SSE listeners */
  private listeners = new Map<string, Set<(event: ChatStreamEvent) => void>>();

  // ── SSE listener management ────────────────────────────────────

  subscribe(
    workspaceId: string,
    agentSlug: string,
    sessionKey: string,
    listener: (event: ChatStreamEvent) => void,
  ): void {
    const key = `${workspaceId}:${agentSlug}:${sessionKey}`;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    log.info("Chat listener subscribed", { key, count: set.size });
  }

  unsubscribe(
    workspaceId: string,
    agentSlug: string,
    sessionKey: string,
    listener: (event: ChatStreamEvent) => void,
  ): void {
    const key = `${workspaceId}:${agentSlug}:${sessionKey}`;
    const set = this.listeners.get(key);
    if (set) {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
      log.info("Chat listener unsubscribed", { key, count: set?.size ?? 0 });
    }
  }

  private emit(
    workspaceId: string,
    agentSlug: string,
    sessionKey: string,
    event: ChatStreamEvent,
  ): void {
    const key = `${workspaceId}:${agentSlug}:${sessionKey}`;
    const set = this.listeners.get(key);
    if (!set || set.size === 0) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        log.error("Chat listener error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ── Gateway client pool ────────────────────────────────────────

  async getClient(workspaceId: string): Promise<GatewayWsClient> {
    const existing = this.clients.get(workspaceId);
    if (existing?.connected) return existing;

    // If another call is already connecting, wait for the same promise
    const inProgress = this.connecting.get(workspaceId);
    if (inProgress) return inProgress;

    const promise = this.connectClient(workspaceId);
    this.connecting.set(workspaceId, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(workspaceId);
    }
  }

  private async connectClient(workspaceId: string): Promise<GatewayWsClient> {
    // Resolve workspace gateway URL and token
    let ws = workspaceService.getWorkspace(workspaceId);
    if (!ws) {
      log.info("Workspace not in memory — ensuring containers", { workspaceId });
      try {
        await workspaceService.ensureContainers(workspaceId);
        ws = workspaceService.getWorkspace(workspaceId);
      } catch (err) {
        log.warn("Could not ensure workspace containers", {
          workspaceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    let gatewayUrl: string;
    let token: string;

    if (ws) {
      gatewayUrl = ws.gatewayUrl;
      token = ws.token;
    } else {
      // Fallback: resolve via the active runtime (knows both Docker host-port
      // and K8s Service DNS), then pull the token from disk meta. In K8s mode
      // there's no gatewayPort on meta, so the disk path alone isn't enough.
      const meta = await loadWorkspaceFromDisk(workspaceId);
      if (!meta?.token) {
        throw new Error(
          `Workspace gateway is not available for "${workspaceId}". Ensure the workspace is running.`,
        );
      }
      const { getRuntime } = await import("../../runtime/workspace-runtime.js");
      const runtimeUrl = await getRuntime().getGatewayUrl(workspaceId);
      if (runtimeUrl) {
        gatewayUrl = runtimeUrl;
      } else if (meta.gatewayPort) {
        gatewayUrl = `http://localhost:${meta.gatewayPort}`;
      } else {
        throw new Error(
          `Workspace gateway is not available for "${workspaceId}". Ensure the workspace is running.`,
        );
      }
      token = meta.token;
    }

    // Ensure gateway config allows insecure auth for localhost connections
    // (needed so our server-side client can retain operator scopes without device identity)
    await this.ensureInsecureAuthEnabled(workspaceId);

    // Clean up old client if any
    const old = this.clients.get(workspaceId);
    old?.disconnect();

    const client = new GatewayWsClient(gatewayUrl, token);

    // Wire up event relay: gateway events → SSE listeners.
    //
    // The gateway emits TWO parallel event streams per turn:
    //   - "chat"  — assistant text deltas + a final message containing only
    //               the text block (no tool_use / tool_result).
    //   - "agent" — run lifecycle + a timeline of "item" frames covering
    //               tool-call start / update / end and command stdout.
    //
    // The old code only subscribed to "chat", so tool-use and tool-result
    // blocks never reached the UI in realtime — they only appeared after a
    // page reload re-fetched history. Subscribing to "agent" lets us
    // materialize synthetic chat:final events carrying tool_use / tool_result
    // blocks so the existing frontend append-on-final path renders them live.
    client.onEvent((event, payload) => {
      if (event === "chat") {
        this.handleChatEvent(workspaceId, payload);
        return;
      }
      if (event === "agent") {
        this.handleAgentEvent(workspaceId, payload);
        return;
      }
      this.handleGenericMessageEvent(workspaceId, event, payload);
    });

    await client.connect();
    this.clients.set(workspaceId, client);
    return client;
  }

  private async ensureInsecureAuthEnabled(workspaceId: string): Promise<void> {
    try {
      const config = await readOpenClawConfig(workspaceId);
      const gw = (config.gateway ?? {}) as Record<string, unknown>;
      const cui = (gw.controlUi ?? {}) as Record<string, unknown>;
      if (cui.allowInsecureAuth === true) return;

      cui.allowInsecureAuth = true;
      gw.controlUi = cui;
      config.gateway = gw;
      await writeOpenClawConfig(workspaceId, config);
      log.info("Enabled allowInsecureAuth for chat", { workspaceId });
    } catch (err) {
      log.warn("Could not patch gateway config", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleChatEvent(workspaceId: string, payload: unknown): void {
    const event = chatEventToSse(payload);
    if (!event) return;
    const p = payload as Record<string, unknown>;
    const rawSessionKey = (p.sessionKey as string) || "main";
    const { agentSlug: slug } = resolveGatewaySessionParts(rawSessionKey);
    if (!slug) return;
    const state = p.state;
    if (event.type === "chat:final" && state && state !== "final") {
      log.info("Emitting chat message from unrecognized state", {
        workspaceId,
        state,
        sessionKey: event.sessionKey,
      });
    }
    this.emit(workspaceId, slug, event.sessionKey, event);
  }

  /**
   * Translate a gateway "agent" event into chat:final events carrying
   * tool_use / tool_result blocks. Handles both the tool-call lifecycle
   * (`stream: "item"`) and the command stdout stream (`stream: "command_output"`).
   * See `agentEventToSse` for the full mapping and dedupe strategy.
   */
  private handleAgentEvent(workspaceId: string, payload: unknown): void {
    const p = payload as Record<string, unknown>;
    const rawSessionKey =
      (typeof p.sessionKey === "string" ? p.sessionKey : undefined) || "main";
    const { agentSlug: slug } = resolveGatewaySessionParts(rawSessionKey);
    if (!slug) return;
    const events = agentEventToSse(payload);
    for (const event of events) {
      this.emit(workspaceId, slug, event.sessionKey, event);
    }
  }

  /**
   * Fallback dispatcher for gateway events whose top-level name isn't "chat"
   * or "agent". Some OpenClaw builds push tool-result messages under event
   * names like "toolResult" or "message". We accept any event whose payload
   * normalizes into a chat message and forward it as a chat:final SSE event
   * so the UI renders it without waiting for a history reload. Events that
   * don't carry a message (task progress, auth challenges, etc.) are ignored.
   */
  private handleGenericMessageEvent(
    workspaceId: string,
    event: string,
    payload: unknown,
  ): void {
    const sse = genericMessageEventToSse(payload);
    if (!sse) return;
    const p = payload as Record<string, unknown>;
    const rawSessionKey = (p.sessionKey as string) || "main";
    const { agentSlug: slug } = resolveGatewaySessionParts(rawSessionKey);
    if (!slug) return;

    log.info("Relaying non-chat gateway event as chat:final", {
      workspaceId,
      event,
      sessionKey: sse.sessionKey,
    });

    this.emit(workspaceId, slug, sse.sessionKey, sse);
  }

  // ── Chat operations ────────────────────────────────────────────

  async send(
    workspaceId: string,
    agentSlug: string,
    input: ChatSendInput,
  ): Promise<{ sessionKey: string }> {
    const client = await this.getClient(workspaceId);
    const gatewayKey = toGatewaySessionKey(agentSlug, input.sessionKey);

    // Save attached files to workspace data dir so the agent can read them.
    // Files are saved to disk and referenced by path in the message text.
    // The agent can view them via its `read` tool.
    let message = input.message;
    if (input.attachments?.length) {
      const uploadDir = join(getDataDir(workspaceId), "data", "chat-uploads");
      await mkdir(uploadDir, { recursive: true });
      const refs: string[] = [];
      for (const att of input.attachments) {
        const ext = att.fileName?.split(".").pop() || att.mediaType.split("/")[1] || "bin";
        const baseName = att.fileName
          ? `${randomUUID().slice(0, 8)}-${att.fileName}`
          : `${randomUUID().slice(0, 8)}.${ext}`;
        const hostPath = join(uploadDir, baseName);
        const containerPath = `/home/node/.openclaw/data/chat-uploads/${baseName}`;
        await writeFile(hostPath, Buffer.from(att.data, "base64"));
        const label = att.type === "image" ? "Attached image" : "Attached file";
        refs.push(`[${label}: ${containerPath}]`);
      }
      if (refs.length > 0) {
        message = message ? `${message}\n\n${refs.join("\n")}` : refs.join("\n");
      }
    }

    await client.request("chat.send", {
      sessionKey: gatewayKey,
      message,
      deliver: false,
      idempotencyKey: randomUUID(),
    });

    // Return the public session key (without gateway prefix) for the frontend.
    // Default sessions round-trip as the agent slug for backward compatibility.
    return { sessionKey: input.sessionKey || agentSlug };
  }

  async history(
    workspaceId: string,
    agentSlug: string,
    sessionKey?: string,
  ): Promise<ChatHistoryResponse> {
    const client = await this.getClient(workspaceId);
    const gatewayKey = toGatewaySessionKey(agentSlug, sessionKey);

    const res = await client.request<{
      messages?: unknown[];
      thinkingLevel?: string;
    }>("chat.history", {
      sessionKey: gatewayKey,
      limit: 200,
    });

    const messages = Array.isArray(res?.messages)
      ? res.messages
          .map(normalizeChatMessage)
          .filter((m): m is ChatMessage => m !== null)
      : [];

    return { messages, sessionKey: sessionKey || agentSlug };
  }

  async abort(
    workspaceId: string,
    agentSlug: string,
    sessionKey?: string,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.request("chat.abort", {
      sessionKey: toGatewaySessionKey(agentSlug, sessionKey),
    });
  }

  async reset(
    workspaceId: string,
    agentSlug: string,
    sessionKey?: string,
  ): Promise<void> {
    const client = await this.getClient(workspaceId);
    await client.request("sessions.reset", {
      key: toGatewaySessionKey(agentSlug, sessionKey),
    });
  }

  async listSessions(
    workspaceId: string,
    agentSlug: string,
  ): Promise<{ sessions: ChatSessionInfo[] }> {
    const client = await this.getClient(workspaceId);
    const result = await client.request<{
      sessions?: RawGatewaySession[];
    }>("sessions.list", {});
    return { sessions: normalizeGatewaySessions(result?.sessions ?? [], agentSlug) };
  }
}

// ── Helpers ───────────────────────────────────────────────────────

export interface RawGatewaySession {
  key?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/**
 * Filter the gateway's session list down to entries belonging to a specific
 * agent and translate their keys into the public (frontend-facing) form.
 *
 * Gateway keys look like "agent:{slug}:{scope}". We only keep entries matching
 * the requested slug, strip the prefix, and normalize the default scope to
 * the literal "main". "main" is always surfaced first, and is injected as an
 * empty entry if the gateway hasn't materialized it yet — so the frontend's
 * session switcher can always offer a way back to the default conversation.
 */
export function normalizeGatewaySessions(
  rawSessions: RawGatewaySession[],
  agentSlug: string,
): ChatSessionInfo[] {
  const prefix = `agent:${agentSlug}:`;
  const sessions: ChatSessionInfo[] = [];
  let hasMain = false;

  for (const s of rawSessions) {
    if (!s.key || !s.key.startsWith(prefix)) continue;
    const scope = s.key.slice(prefix.length);
    const sessionKey = !scope || scope === "main" ? "main" : scope;
    if (sessionKey === "main") hasMain = true;
    sessions.push({
      sessionKey,
      totalTokens: s.totalTokens ?? 0,
      inputTokens: s.inputTokens ?? 0,
      outputTokens: s.outputTokens ?? 0,
    });
  }

  if (!hasMain) {
    sessions.unshift({
      sessionKey: "main",
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  } else {
    sessions.sort((a, b) => {
      if (a.sessionKey === "main") return -1;
      if (b.sessionKey === "main") return 1;
      return 0;
    });
  }

  return sessions;
}

/**
 * Build the gateway session key in the format the gateway expects.
 * Gateway uses "agent:{agentSlug}:{scope}" to route to the correct agent
 * AND scope its conversation history. Different scopes give the same agent
 * independent context windows — used by the email composer to keep its
 * chat isolated from the agent's main conversation.
 *
 * Public sessionKey conventions:
 *  - undefined or "main" → default conversation (scope = "main")
 *  - any other token (e.g. "compose_abc123") → its own scoped conversation
 *
 * Public sessionKey MUST NOT contain a colon — the gateway uses ":" as a
 * separator inside the prefix and would mis-parse a colon-bearing scope.
 */
export function toGatewaySessionKey(
  agentSlug: string,
  sessionKey?: string,
): string {
  const scope =
    !sessionKey || sessionKey === "main" || sessionKey === agentSlug
      ? "main"
      : sessionKey;
  return `agent:${agentSlug}:${scope}`;
}

/**
 * Resolve the public session key from the gateway's prefixed format.
 * Gateway events use "agent:{agentSlug}:{scope}". The default scope "main"
 * maps back to the literal "main" so it matches what the chat page subscribes
 * to on the SSE channel. Custom scopes round-trip as themselves so that scoped
 * sessions (like email compose) reach their dedicated SSE subscribers.
 */
export function resolveSessionKey(raw: string): string {
  if (raw.startsWith("agent:")) {
    const parts = raw.split(":");
    if (parts.length >= 3) {
      const scope = parts.slice(2).join(":");
      return scope || "main";
    }
    if (parts.length === 2) {
      return "main";
    }
  }
  return raw;
}

/**
 * Like `resolveSessionKey` but also extracts the agent slug from the gateway's
 * prefixed session key format ("agent:{agentSlug}:{scope}"). Returns both the
 * agent slug and the public session key so callers can route events to the
 * correct per-agent listener bucket.
 */
export function resolveGatewaySessionParts(raw: string): {
  agentSlug: string | null;
  sessionKey: string;
} {
  if (raw.startsWith("agent:")) {
    const parts = raw.split(":");
    if (parts.length >= 3) {
      return {
        agentSlug: parts[1],
        sessionKey: parts.slice(2).join(":") || "main",
      };
    }
    if (parts.length === 2) {
      return { agentSlug: parts[1], sessionKey: "main" };
    }
  }
  return { agentSlug: null, sessionKey: raw };
}

/**
 * Pure translator: takes a raw gateway "chat" event payload and returns the
 * SSE event we should forward to subscribers. Exported so unit tests can
 * exercise the broadened state-handling logic without constructing a live
 * ChatService + GatewayWsClient.
 *
 * Recognized states:
 *   - "delta"    → chat:delta (streaming text/thinking)
 *   - "aborted"  → chat:aborted
 *   - "error"    → chat:error
 *   - "final"    → chat:final (normal complete message)
 *   - any other (including missing) → chat:final if a message can be extracted
 *
 * The unknown-state branch exists because newer OpenClaw builds sometimes emit
 * tool results with a state value we don't recognize yet. Returning null
 * silently was the prior behavior and caused tool results to vanish from the
 * realtime stream.
 */
export function chatEventToSse(payload: unknown): ChatStreamEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const rawSessionKey = (p.sessionKey as string) || "main";
  const sessionKey = resolveSessionKey(rawSessionKey);
  const state = typeof p.state === "string" ? p.state : undefined;

  if (state === "delta") {
    const delta = extractDelta(p);
    if (!delta) return null;
    return {
      type: "chat:delta",
      text: delta.text,
      blockType: delta.blockType,
      sessionKey,
    };
  }

  if (state === "aborted") {
    return { type: "chat:aborted", sessionKey };
  }

  if (state === "error") {
    return {
      type: "chat:error",
      error: (p.errorMessage as string) || "Unknown error",
      sessionKey,
    };
  }

  const message =
    normalizeChatMessage(p.message) ?? normalizeChatMessage(payload);
  if (message) {
    return { type: "chat:final", message, sessionKey };
  }
  return null;
}

/**
 * Pure translator for gateway "agent" events. OpenClaw pushes a rich timeline
 * of `stream: "item"` frames for every tool call (kind: "tool" / "command",
 * phase: "start" / "update" / "end") plus a parallel assistant text stream.
 * The UI only needs tool_use and tool_result blocks, so we collapse the
 * lifecycle into two synthetic chat:final events per tool call:
 *
 *   - On `item` `kind: "tool"` `phase: "start"` → emit assistant + tool_use
 *     (captures the call as soon as the agent issues it — user sees it before
 *     the command actually runs, matching the OpenClaw dashboard's ordering).
 *   - On `item` `kind: "command"` `phase: "end"` → emit user + tool_result
 *     with the command's `summary` as the result body. For `exec`, this is the
 *     full stdout. For tools without a command wrapper, we fall back to the
 *     tool's own `phase: "end"` event if it carries a `summary` / `output` /
 *     `content` field.
 *
 * Irrelevant frames (lifecycle, update progressText, command_output deltas)
 * are dropped — they're redundant with the start/end pair.
 *
 * Returns [] for non-agent or unrecognized payloads so the caller can just
 * iterate without null-checking each result.
 */
export function agentEventToSse(
  payload: unknown,
): Array<Extract<ChatStreamEvent, { type: "chat:final" }>> {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const stream = typeof p.stream === "string" ? p.stream : undefined;
  if (stream !== "item") return [];

  const data = p.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return [];

  const phase = typeof data.phase === "string" ? data.phase : undefined;
  const kind = typeof data.kind === "string" ? data.kind : undefined;
  const name = typeof data.name === "string" ? data.name : "tool";
  const rawSessionKey =
    (typeof p.sessionKey === "string" ? p.sessionKey : undefined) || "main";
  const sessionKey = resolveSessionKey(rawSessionKey);
  const ts = typeof p.ts === "number" ? p.ts : Date.now();

  // Tool call started — emit an assistant turn with a tool_use block so the
  // UI shows the call immediately (dashboard-equivalent timing).
  if (phase === "start" && kind === "tool") {
    const input =
      typeof data.meta === "string"
        ? data.meta
        : typeof data.input === "string"
          ? data.input
          : data.input != null
            ? JSON.stringify(data.input)
            : "";
    return [
      {
        type: "chat:final",
        sessionKey,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name, input }],
          timestamp: ts,
        },
      },
    ];
  }

  // Tool or command ended — emit a user turn with the tool_result block if
  // the frame carries output. For `exec` the meaningful summary lives on the
  // sibling `kind: "command"` item; tools without a command wrapper may put
  // it directly on the `kind: "tool"` item instead. Try both shapes.
  if (phase === "end" && (kind === "command" || kind === "tool")) {
    const summary =
      typeof data.summary === "string"
        ? data.summary
        : typeof data.output === "string"
          ? data.output
          : typeof data.content === "string"
            ? data.content
            : null;
    if (summary === null) return [];
    return [
      {
        type: "chat:final",
        sessionKey,
        message: {
          role: "user",
          content: [{ type: "tool_result", name, content: summary }],
          timestamp: ts,
        },
      },
    ];
  }

  return [];
}

/**
 * Pure translator for gateway events whose top-level name isn't "chat".
 * Mirrors `chatEventToSse` but only emits chat:final — non-chat events don't
 * carry delta/abort/error state. Returns null when the payload doesn't look
 * like a chat message (task progress, auth challenges, etc.).
 */
export function genericMessageEventToSse(
  payload: unknown,
): Extract<ChatStreamEvent, { type: "chat:final" }> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const message =
    normalizeChatMessage(p.message) ?? normalizeChatMessage(payload);
  if (!message) return null;

  const rawSessionKey = (p.sessionKey as string) || "main";
  const sessionKey = resolveSessionKey(rawSessionKey);

  return { type: "chat:final", message, sessionKey };
}

function extractDelta(payload: Record<string, unknown>): { text: string; blockType: "text" | "thinking" } | null {
  // Check message.content blocks first — they carry type information
  const msg = payload.message as Record<string, unknown> | undefined;
  if (msg && Array.isArray(msg.content)) {
    for (const b of msg.content) {
      if (!b || typeof b !== "object") continue;
      const block = b as Record<string, unknown>;
      if (block.type === "thinking" && typeof block.text === "string") {
        return { text: block.text, blockType: "thinking" };
      }
      if (block.type === "text" && typeof block.text === "string") {
        return { text: block.text, blockType: "text" };
      }
    }
  }

  // Fallback: direct text fields (assume regular text)
  if (typeof payload.text === "string") return { text: payload.text, blockType: "text" };
  if (msg && typeof msg.text === "string") return { text: msg.text, blockType: "text" };
  return null;
}

/**
 * Stringify the value passed as a tool result or tool input. OpenClaw's
 * gateway wraps tool-result bodies in an array of content blocks
 * (`[{type:"text", text: "..."}]`) and uses raw strings or nested JSON for
 * toolCall arguments. This helper normalizes either shape into a single
 * string suitable for the UI's tool_result/tool_use blocks.
 */
function stringifyToolPayload(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((c) => {
        if (c && typeof c === "object") {
          const entry = c as Record<string, unknown>;
          if (entry.type === "text" && typeof entry.text === "string") {
            return entry.text;
          }
        }
        return JSON.stringify(c);
      })
      .join("\n");
  }
  return JSON.stringify(value ?? "");
}

export function normalizeChatMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const rawRole = typeof entry.role === "string" ? entry.role : null;
  if (!rawRole) return null;
  const roleKey = rawRole.toLowerCase();

  // OpenClaw emits tool results as their own top-level messages with
  // `role: "toolResult"`, `toolCallId`, `toolName`, and a content array.
  // Surface these to the UI as user-turn messages with a single tool_result
  // block (matching Anthropic's convention where tool results live inside the
  // user turn). Without this branch they'd be silently filtered out.
  if (roleKey === "toolresult") {
    const toolName =
      typeof entry.toolName === "string"
        ? entry.toolName
        : typeof entry.name === "string"
          ? entry.name
          : "tool";
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          name: toolName,
          content: stringifyToolPayload(entry.content),
        },
      ],
      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
    };
  }

  if (roleKey !== "user" && roleKey !== "assistant") return null;

  // Normalize content to ChatContentBlock[]
  let content: ChatMessage["content"];
  if (typeof entry.content === "string") {
    content = [{ type: "text", text: entry.content }];
  } else if (Array.isArray(entry.content)) {
    content = entry.content
      .map((block: unknown) => {
        if (!block || typeof block !== "object") return null;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          return { type: "text" as const, text: b.text };
        }
        // Thinking blocks use `thinking` (OpenClaw/Anthropic extended thinking)
        // or `text` (legacy). Accept either.
        if (b.type === "thinking") {
          const text =
            typeof b.thinking === "string"
              ? b.thinking
              : typeof b.text === "string"
                ? b.text
                : null;
          if (text !== null) return { type: "thinking" as const, text };
          return null;
        }
        // Anthropic-style tool_use blocks (snake_case).
        if (b.type === "tool_use") {
          const name = typeof b.name === "string" ? b.name : "tool";
          return {
            type: "tool_use" as const,
            name,
            input: stringifyToolPayload(b.input),
          };
        }
        // OpenClaw-style toolCall blocks (camelCase) inside an assistant turn.
        if (b.type === "toolCall") {
          const name = typeof b.name === "string" ? b.name : "tool";
          return {
            type: "tool_use" as const,
            name,
            input: stringifyToolPayload(b.arguments ?? b.input),
          };
        }
        if (b.type === "tool_result") {
          const name =
            typeof b.name === "string"
              ? b.name
              : typeof b.tool_use_id === "string"
                ? b.tool_use_id
                : "tool";
          return {
            type: "tool_result" as const,
            name,
            content: stringifyToolPayload(b.content),
          };
        }
        // Nested toolResult block (defensive — top-level toolResult messages
        // are handled earlier, but the gateway occasionally inlines them).
        if (b.type === "toolResult") {
          const name =
            typeof b.toolName === "string"
              ? b.toolName
              : typeof b.name === "string"
                ? b.name
                : "tool";
          return {
            type: "tool_result" as const,
            name,
            content: stringifyToolPayload(b.content),
          };
        }
        // Image block
        if (b.type === "image" && typeof b.data === "string") {
          return {
            type: "image" as const,
            mediaType: (typeof b.mediaType === "string" ? b.mediaType : "image/png"),
            data: b.data,
          };
        }
        // Fallback: treat unknown blocks as text if they have a text field.
        if (typeof b.text === "string") {
          return { type: "text" as const, text: b.text };
        }
        return null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  } else if (typeof entry.text === "string") {
    // Some messages have `text` field directly
    content = [{ type: "text", text: entry.text }];
  } else {
    content = [];
  }

  // Handle OpenAI-style tool_calls field (separate from content)
  if (Array.isArray(entry.tool_calls)) {
    for (const tc of entry.tool_calls) {
      if (!tc || typeof tc !== "object") continue;
      const call = tc as Record<string, unknown>;
      const fn = call.function as Record<string, unknown> | undefined;
      if (fn && typeof fn.name === "string") {
        content.push({
          type: "tool_use" as const,
          name: fn.name,
          input: stringifyToolPayload(fn.arguments),
        });
      } else if (typeof call.name === "string") {
        content.push({
          type: "tool_use" as const,
          name: call.name,
          input: stringifyToolPayload(call.input),
        });
      }
    }
  }

  // Skip messages with no displayable content
  if (content.length === 0) return null;

  return {
    role: roleKey as "user" | "assistant",
    content,
    timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
  };
}

export const chatService = new ChatService();
