import { describe, it, expect } from "vitest";
import {
  buildAugmentedMessage,
  extractEmailPatch,
  sanitizeMessagesForDisplay,
  stripComposeContext,
  stripEmailPatchBlocks,
} from "./compose-utils";
import type { ChatMessage } from "@opcify/core";

describe("extractEmailPatch", () => {
  it("returns null when no fence is present", () => {
    expect(extractEmailPatch("Sure thing!")).toBeNull();
  });

  it("parses a valid patch", () => {
    const text = [
      "Drafted that email for you.",
      "```email-patch",
      `{"to":["alice@example.com"],"subject":"Hi","body":"Hello"}`,
      "```",
    ].join("\n");

    const patch = extractEmailPatch(text);
    expect(patch).toEqual({
      to: ["alice@example.com"],
      subject: "Hi",
      body: "Hello",
    });
  });

  it("returns null on malformed JSON", () => {
    const text = ["```email-patch", "{this is not json}", "```"].join("\n");
    expect(extractEmailPatch(text)).toBeNull();
  });

  it("returns null when the JSON has no recognised keys", () => {
    const text = ["```email-patch", `{"foo":"bar"}`, "```"].join("\n");
    expect(extractEmailPatch(text)).toBeNull();
  });

  it("only reads the first block when multiple are present", () => {
    const text = [
      "```email-patch",
      `{"subject":"First"}`,
      "```",
      "more text",
      "```email-patch",
      `{"subject":"Second"}`,
      "```",
    ].join("\n");

    expect(extractEmailPatch(text)).toEqual({ subject: "First" });
  });

  it("supports send: true", () => {
    const text = ["```email-patch", `{"send":true}`, "```"].join("\n");
    expect(extractEmailPatch(text)).toEqual({ send: true });
  });

  it("ignores non-string array elements", () => {
    const text = [
      "```email-patch",
      `{"to":["a@example.com",42,"b@example.com"]}`,
      "```",
    ].join("\n");
    expect(extractEmailPatch(text)).toEqual({
      to: ["a@example.com", "b@example.com"],
    });
  });
});

describe("stripEmailPatchBlocks", () => {
  it("removes the fence and trims surrounding whitespace", () => {
    const text =
      "Done.\n\n```email-patch\n{\"subject\":\"x\"}\n```\n\nLet me know!";
    expect(stripEmailPatchBlocks(text)).toBe("Done.\n\n\n\nLet me know!");
  });
});

describe("stripComposeContext", () => {
  it("returns the user message after the [USER] marker", () => {
    const wrapped = buildAugmentedMessage("send it now", "{}");
    expect(stripComposeContext(wrapped)).toBe("send it now");
  });

  it("leaves messages without the marker untouched", () => {
    expect(stripComposeContext("hello")).toBe("hello");
  });
});

describe("sanitizeMessagesForDisplay", () => {
  it("strips compose context from user messages and patch fences from assistant messages", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildAugmentedMessage("send it", "{}"),
          },
        ],
        timestamp: 1,
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Sure!\n\n```email-patch\n{\"send\":true}\n```",
          },
        ],
        timestamp: 2,
      },
    ];

    const sanitized = sanitizeMessagesForDisplay(messages);
    expect(sanitized[0].content[0]).toMatchObject({
      type: "text",
      text: "send it",
    });
    expect(sanitized[1].content[0]).toMatchObject({
      type: "text",
      text: "Sure!",
    });
  });

  it("drops content blocks that become empty after sanitization", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "```email-patch\n{\"subject\":\"x\"}\n```",
          },
        ],
        timestamp: 1,
      },
    ];
    const sanitized = sanitizeMessagesForDisplay(messages);
    expect(sanitized[0].content).toHaveLength(0);
  });
});
