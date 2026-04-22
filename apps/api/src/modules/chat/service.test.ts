import { describe, it, expect } from "vitest";
import {
  toGatewaySessionKey,
  resolveSessionKey,
  resolveGatewaySessionParts,
  normalizeGatewaySessions,
  normalizeChatMessage,
  chatEventToSse,
  genericMessageEventToSse,
  agentEventToSse,
} from "./service.js";

describe("toGatewaySessionKey", () => {
  it("uses scope=main when no sessionKey is provided", () => {
    expect(toGatewaySessionKey("personal-assistant")).toBe(
      "agent:personal-assistant:main",
    );
  });

  it("uses scope=main when sessionKey is the literal 'main'", () => {
    expect(toGatewaySessionKey("personal-assistant", "main")).toBe(
      "agent:personal-assistant:main",
    );
  });

  it("uses scope=main when sessionKey echoes the agent slug (legacy round-trip)", () => {
    // The frontend useChat hook stores the slug as resolvedSessionKey after the
    // first history fetch on the default flow. Subsequent sends echo the slug
    // back as the sessionKey — that should still resolve to the default scope.
    expect(
      toGatewaySessionKey("personal-assistant", "personal-assistant"),
    ).toBe("agent:personal-assistant:main");
  });

  it("encodes a custom sessionKey as a distinct gateway scope", () => {
    expect(
      toGatewaySessionKey("personal-assistant", "compose_abc123"),
    ).toBe("agent:personal-assistant:compose_abc123");
  });

  it("does not collapse two different scopes onto the same gateway key", () => {
    const a = toGatewaySessionKey("personal-assistant", "compose_aaa");
    const b = toGatewaySessionKey("personal-assistant", "compose_bbb");
    expect(a).not.toBe(b);
  });
});

describe("resolveSessionKey", () => {
  it("returns 'main' for the default scope so it matches the SSE subscribe key", () => {
    expect(resolveSessionKey("agent:personal-assistant:main")).toBe("main");
  });

  it("returns the custom scope verbatim for non-main scopes", () => {
    expect(
      resolveSessionKey("agent:personal-assistant:compose_abc123"),
    ).toBe("compose_abc123");
  });

  it("round-trips a custom sessionKey through to/from", () => {
    const original = "compose_xyz999";
    const encoded = toGatewaySessionKey("creative-director", original);
    expect(resolveSessionKey(encoded)).toBe(original);
  });

  it("round-trips the default sessionKey back to 'main'", () => {
    const encoded = toGatewaySessionKey("operations-director");
    expect(resolveSessionKey(encoded)).toBe("main");
  });

  it("returns raw input when there is no agent: prefix", () => {
    expect(resolveSessionKey("plain-key")).toBe("plain-key");
  });

  it("falls back to 'main' when the prefix has no scope", () => {
    expect(resolveSessionKey("agent:personal-assistant")).toBe("main");
  });
});

describe("resolveGatewaySessionParts", () => {
  it("extracts agentSlug and sessionKey from default scope", () => {
    expect(resolveGatewaySessionParts("agent:personal-assistant:main")).toEqual({
      agentSlug: "personal-assistant",
      sessionKey: "main",
    });
  });

  it("extracts agentSlug and custom sessionKey", () => {
    expect(
      resolveGatewaySessionParts("agent:creative-director:compose_abc123"),
    ).toEqual({
      agentSlug: "creative-director",
      sessionKey: "compose_abc123",
    });
  });

  it("returns agentSlug with 'main' when prefix has no scope", () => {
    expect(resolveGatewaySessionParts("agent:personal-assistant")).toEqual({
      agentSlug: "personal-assistant",
      sessionKey: "main",
    });
  });

  it("returns null agentSlug for non-prefixed keys", () => {
    expect(resolveGatewaySessionParts("plain-key")).toEqual({
      agentSlug: null,
      sessionKey: "plain-key",
    });
  });

  it("round-trips with toGatewaySessionKey", () => {
    const encoded = toGatewaySessionKey("operations-director", "compose_xyz");
    const { agentSlug, sessionKey } = resolveGatewaySessionParts(encoded);
    expect(agentSlug).toBe("operations-director");
    expect(sessionKey).toBe("compose_xyz");
  });
});

describe("normalizeGatewaySessions", () => {
  it("returns only sessions belonging to the requested agent", () => {
    const result = normalizeGatewaySessions(
      [
        { key: "agent:coo:main", totalTokens: 100, inputTokens: 60, outputTokens: 40 },
        { key: "agent:coo:compose_abc", totalTokens: 10, inputTokens: 4, outputTokens: 6 },
        { key: "agent:coo:task-123", totalTokens: 20, inputTokens: 8, outputTokens: 12 },
        { key: "agent:other:main", totalTokens: 999 },
      ],
      "coo",
    );
    expect(result.map((s) => s.sessionKey)).toEqual([
      "main",
      "compose_abc",
      "task-123",
    ]);
    expect(result[0].totalTokens).toBe(100);
  });

  it("normalizes empty or 'main' scopes to the public 'main' key", () => {
    const result = normalizeGatewaySessions(
      [{ key: "agent:coo:main" }],
      "coo",
    );
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toBe("main");
  });

  it("injects a zero-token 'main' entry when the gateway hasn't materialized one", () => {
    const result = normalizeGatewaySessions(
      [{ key: "agent:coo:compose_abc", totalTokens: 10 }],
      "coo",
    );
    expect(result.map((s) => s.sessionKey)).toEqual(["main", "compose_abc"]);
    expect(result[0]).toEqual({
      sessionKey: "main",
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("always places 'main' first even when the gateway returns it last", () => {
    const result = normalizeGatewaySessions(
      [
        { key: "agent:coo:compose_abc" },
        { key: "agent:coo:task-123" },
        { key: "agent:coo:main" },
      ],
      "coo",
    );
    expect(result[0].sessionKey).toBe("main");
  });

  it("defaults missing token counters to 0", () => {
    const result = normalizeGatewaySessions(
      [{ key: "agent:coo:main" }],
      "coo",
    );
    expect(result[0]).toEqual({
      sessionKey: "main",
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("returns only 'main' when the gateway returns no sessions", () => {
    const result = normalizeGatewaySessions([], "coo");
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toBe("main");
  });

  it("ignores entries with no key or mismatched prefix", () => {
    const result = normalizeGatewaySessions(
      [
        { totalTokens: 1 },
        { key: "not-an-agent-key" },
        { key: "agent:other:main" },
        { key: "agent:coo:compose_abc" },
      ],
      "coo",
    );
    expect(result.map((s) => s.sessionKey)).toEqual(["main", "compose_abc"]);
  });
});

describe("normalizeChatMessage (OpenClaw gateway format)", () => {
  it("converts an assistant turn with a camelCase toolCall block into a tool_use block", () => {
    const result = normalizeChatMessage({
      role: "assistant",
      content: [
        { type: "text", text: "I'll check the status." },
        {
          type: "toolCall",
          id: "toolu_01abc",
          name: "exec",
          arguments: { command: "curl -s http://api/ping" },
        },
      ],
      timestamp: 1234567,
    });
    expect(result?.role).toBe("assistant");
    expect(result?.content).toHaveLength(2);
    expect(result?.content[0]).toEqual({
      type: "text",
      text: "I'll check the status.",
    });
    expect(result?.content[1]).toEqual({
      type: "tool_use",
      name: "exec",
      input: '{"command":"curl -s http://api/ping"}',
    });
  });

  it("accepts extended-thinking blocks whose payload is under the `thinking` field", () => {
    const result = normalizeChatMessage({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me plan the steps..." },
        { type: "text", text: "Here's my plan." },
      ],
    });
    expect(result?.content[0]).toEqual({
      type: "thinking",
      text: "Let me plan the steps...",
    });
  });

  it("converts a top-level toolResult message into a user turn with a tool_result block", () => {
    const result = normalizeChatMessage({
      role: "toolResult",
      toolCallId: "toolu_01abc",
      toolName: "exec",
      content: [{ type: "text", text: "Command not found" }],
      isError: false,
      timestamp: 9999,
    });
    expect(result?.role).toBe("user");
    expect(result?.content).toHaveLength(1);
    expect(result?.content[0]).toEqual({
      type: "tool_result",
      name: "exec",
      content: "Command not found",
    });
    expect(result?.timestamp).toBe(9999);
  });

  it("joins multi-block toolResult content into a single string preserving each text chunk", () => {
    const result = normalizeChatMessage({
      role: "toolResult",
      toolName: "shell",
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
    });
    expect(result?.content[0]).toMatchObject({
      type: "tool_result",
      name: "shell",
      content: "line one\nline two",
    });
  });

  it("falls back to 'tool' as the tool name when neither toolName nor name is provided", () => {
    const result = normalizeChatMessage({
      role: "toolResult",
      content: "raw output",
    });
    expect(result?.content[0]).toMatchObject({
      type: "tool_result",
      name: "tool",
      content: "raw output",
    });
  });

  it("still drops messages with unrecognized roles like system or function", () => {
    expect(normalizeChatMessage({ role: "system", content: "sysprompt" })).toBeNull();
    expect(normalizeChatMessage({ role: "function", content: "fn" })).toBeNull();
  });

  it("keeps Anthropic-style tool_use blocks working alongside the new toolCall path", () => {
    const result = normalizeChatMessage({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          name: "calculator",
          input: '{"a":1,"b":2}',
        },
      ],
    });
    expect(result?.content[0]).toEqual({
      type: "tool_use",
      name: "calculator",
      input: '{"a":1,"b":2}',
    });
  });
});

describe("chatEventToSse (gateway chat-event translation)", () => {
  it("translates state=final + assistant message into chat:final", () => {
    const result = chatEventToSse({
      state: "final",
      sessionKey: "agent:coo:main",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(result).toEqual({
      type: "chat:final",
      sessionKey: "main",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        timestamp: undefined,
      },
    });
  });

  it("translates state=delta text into chat:delta", () => {
    const result = chatEventToSse({
      state: "delta",
      sessionKey: "agent:coo:main",
      message: {
        content: [{ type: "text", text: "streaming..." }],
      },
    });
    expect(result).toEqual({
      type: "chat:delta",
      sessionKey: "main",
      text: "streaming...",
      blockType: "text",
    });
  });

  it("translates state=error into chat:error with the errorMessage", () => {
    const result = chatEventToSse({
      state: "error",
      sessionKey: "agent:coo:main",
      errorMessage: "rate limited",
    });
    expect(result).toEqual({
      type: "chat:error",
      sessionKey: "main",
      error: "rate limited",
    });
  });

  it("translates state=aborted into chat:aborted", () => {
    const result = chatEventToSse({
      state: "aborted",
      sessionKey: "agent:coo:main",
    });
    expect(result).toEqual({ type: "chat:aborted", sessionKey: "main" });
  });

  it("surfaces a tool result arriving with an unknown state so the UI updates in realtime", () => {
    // The bug: older handlers only processed state in {delta,final,aborted,error}
    // and silently dropped tool-result events pushed with a state like "tool"
    // or "toolResult". The broadened translator must emit chat:final instead.
    const result = chatEventToSse({
      state: "toolResult",
      sessionKey: "agent:coo:main",
      message: {
        role: "toolResult",
        toolName: "exec",
        content: [{ type: "text", text: "command output" }],
      },
    });
    expect(result?.type).toBe("chat:final");
    if (result?.type !== "chat:final") throw new Error("wrong type");
    expect(result.sessionKey).toBe("main");
    expect(result.message.role).toBe("user");
    expect(result.message.content[0]).toMatchObject({
      type: "tool_result",
      name: "exec",
      content: "command output",
    });
  });

  it("surfaces a tool result inlined at the payload root (no message wrapper)", () => {
    // Some gateway builds push the tool-result fields directly onto the event
    // payload instead of nesting them under `message`. The translator must
    // still catch this shape.
    const result = chatEventToSse({
      sessionKey: "agent:coo:main",
      role: "toolResult",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
    });
    expect(result?.type).toBe("chat:final");
    if (result?.type !== "chat:final") throw new Error("wrong type");
    expect(result.message.content[0]).toMatchObject({
      type: "tool_result",
      name: "read",
      content: "file contents",
    });
  });

  it("returns null when the payload carries no message and no state", () => {
    expect(chatEventToSse({ sessionKey: "agent:coo:main" })).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    expect(chatEventToSse(null)).toBeNull();
    expect(chatEventToSse("chat")).toBeNull();
    expect(chatEventToSse(undefined)).toBeNull();
  });
});

describe("agentEventToSse (gateway agent-event timeline → chat:final)", () => {
  // These payloads are abridged copies of frames captured from a real
  // exec tool call against the workspace gateway. The shapes matter more
  // than the actual text — the translator picks specific fields out of each.

  it("emits an assistant tool_use chat:final when a tool call starts", () => {
    const result = agentEventToSse({
      runId: "run-123",
      stream: "item",
      data: {
        itemId: "tool:toolu_01",
        phase: "start",
        kind: "tool",
        status: "running",
        name: "exec",
        meta: "list files in /tmp, `ls -la /tmp`",
        toolCallId: "toolu_01",
        startedAt: 1000,
      },
      sessionKey: "agent:coo:main",
      seq: 3,
      ts: 1000,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "chat:final",
      sessionKey: "main",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "exec",
            input: "list files in /tmp, `ls -la /tmp`",
          },
        ],
        timestamp: 1000,
      },
    });
  });

  it("emits a user tool_result chat:final when a command phase ends with a summary", () => {
    const result = agentEventToSse({
      runId: "run-123",
      stream: "item",
      data: {
        itemId: "command:toolu_01",
        phase: "end",
        kind: "command",
        status: "completed",
        name: "exec",
        toolCallId: "toolu_01",
        startedAt: 1000,
        endedAt: 1016,
        summary: "total 4\n-rw-r--r-- 1 node node 12 Apr 16 02:02 foo.txt",
      },
      sessionKey: "agent:coo:main",
      seq: 12,
      ts: 1016,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "chat:final",
      sessionKey: "main",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            name: "exec",
            content: "total 4\n-rw-r--r-- 1 node node 12 Apr 16 02:02 foo.txt",
          },
        ],
        timestamp: 1016,
      },
    });
  });

  it("falls back to `output` when `summary` is absent", () => {
    const result = agentEventToSse({
      stream: "item",
      data: {
        phase: "end",
        kind: "command",
        name: "shell",
        output: "hi\n",
      },
      sessionKey: "agent:coo:main",
    });
    expect(result[0]?.message.content[0]).toMatchObject({
      type: "tool_result",
      name: "shell",
      content: "hi\n",
    });
  });

  it("handles tool-kind end frames that carry their own content (non-command tools)", () => {
    // Some tools (like `read`) don't wrap in a `command` item and report their
    // result directly on the tool's own end frame.
    const result = agentEventToSse({
      stream: "item",
      data: {
        phase: "end",
        kind: "tool",
        name: "read",
        content: "file contents here",
      },
      sessionKey: "agent:coo:main",
    });
    expect(result[0]?.message.role).toBe("user");
    expect(result[0]?.message.content[0]).toMatchObject({
      type: "tool_result",
      name: "read",
      content: "file contents here",
    });
  });

  it("ignores lifecycle and update frames (only start+end carry the signal)", () => {
    const lifecycle = agentEventToSse({
      stream: "lifecycle",
      data: { phase: "start", startedAt: 1 },
      sessionKey: "agent:coo:main",
    });
    expect(lifecycle).toEqual([]);

    const update = agentEventToSse({
      stream: "item",
      data: {
        phase: "update",
        kind: "command",
        name: "exec",
        progressText: "(partial)",
      },
      sessionKey: "agent:coo:main",
    });
    expect(update).toEqual([]);
  });

  it("ignores command_output stream frames (redundant with command item.end)", () => {
    const result = agentEventToSse({
      stream: "command_output",
      data: {
        phase: "delta",
        output: "(streaming)",
      },
      sessionKey: "agent:coo:main",
    });
    expect(result).toEqual([]);
  });

  it("ignores a tool.end with no output field so we don't emit empty tool_result blocks", () => {
    // In the captured trace, the kind:"tool" end frame has no summary/output —
    // that lives on the sibling kind:"command" end. Emitting anything here
    // would double-post the tool_result.
    const result = agentEventToSse({
      stream: "item",
      data: {
        phase: "end",
        kind: "tool",
        name: "exec",
        meta: "list files",
        startedAt: 1,
        endedAt: 2,
      },
      sessionKey: "agent:coo:main",
    });
    expect(result).toEqual([]);
  });

  it("defaults ts to Date.now() when the event has no ts", () => {
    const before = Date.now();
    const result = agentEventToSse({
      stream: "item",
      data: {
        phase: "start",
        kind: "tool",
        name: "exec",
        meta: "ls",
      },
      sessionKey: "agent:coo:main",
    });
    const after = Date.now();
    expect(result[0]?.message.timestamp).toBeGreaterThanOrEqual(before);
    expect(result[0]?.message.timestamp).toBeLessThanOrEqual(after);
  });

  it("returns [] for non-object or malformed payloads", () => {
    expect(agentEventToSse(null)).toEqual([]);
    expect(agentEventToSse("not an object")).toEqual([]);
    expect(agentEventToSse({})).toEqual([]);
    expect(agentEventToSse({ stream: "item" })).toEqual([]);
    expect(agentEventToSse({ stream: "item", data: "not an object" })).toEqual([]);
  });
});

describe("genericMessageEventToSse (non-chat gateway events)", () => {
  it("emits a chat:final for a tool result pushed under a non-chat event name", () => {
    const result = genericMessageEventToSse({
      sessionKey: "agent:coo:main",
      message: {
        role: "toolResult",
        toolName: "write",
        content: [{ type: "text", text: "wrote 12 bytes" }],
      },
    });
    expect(result?.type).toBe("chat:final");
    expect(result?.sessionKey).toBe("main");
    expect(result?.message.content[0]).toMatchObject({
      type: "tool_result",
      name: "write",
      content: "wrote 12 bytes",
    });
  });

  it("ignores payloads that don't look like a chat message", () => {
    expect(
      genericMessageEventToSse({
        sessionKey: "agent:coo:main",
        taskId: "task-123",
        progress: 0.5,
      }),
    ).toBeNull();
  });
});
