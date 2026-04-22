import { describe, expect, it } from "vitest";
import { buildCustomProvidersSection } from "../WorkspaceConfig.js";
import type { AIProviderConfig } from "@opcify/core";

describe("buildCustomProvidersSection", () => {
  it("returns undefined when no providers are given", () => {
    expect(buildCustomProvidersSection(undefined)).toBeUndefined();
  });

  it("returns undefined when no provider has a baseUrl", () => {
    const providers: AIProviderConfig[] = [
      { id: "openai", apiKey: "sk-o" },
      {
        id: "google",
        apiKey: "sk-g",
        models: [{ value: "gemma-4-31B-it", label: "Gemma" }],
      },
    ];
    // Built-in providers (no baseUrl) are NOT emitted — OpenClaw already
    // knows their endpoints from the bundled catalog.
    expect(buildCustomProvidersSection(providers)).toBeUndefined();
  });

  it("emits a models.providers entry for a custom OpenAI-compatible endpoint", () => {
    const providers: AIProviderConfig[] = [
      {
        id: "custom-m8x7",
        label: "Nvidia",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "sk-nvidia",
        models: [{ value: "minimaxai/minimax-m2.7", label: "MiniMax M2.7" }],
      },
    ];
    const section = buildCustomProvidersSection(providers);
    expect(section).toEqual({
      mode: "merge",
      providers: {
        "custom-m8x7": {
          baseUrl: "https://integrate.api.nvidia.com/v1",
          api: "openai-completions",
          apiKey: "sk-nvidia",
          models: [
            { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7" },
          ],
        },
      },
    });
  });

  it("skips custom providers that have no models declared", () => {
    const providers: AIProviderConfig[] = [
      {
        id: "custom-empty",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-e",
        models: [],
      },
    ];
    // An empty model list would be useless for OpenClaw — drop the entry.
    expect(buildCustomProvidersSection(providers)).toBeUndefined();
  });

  it("omits apiKey when the user didn't enter one", () => {
    const providers: AIProviderConfig[] = [
      {
        id: "custom-local",
        baseUrl: "http://localhost:8080/v1",
        apiKey: "",
        models: [{ value: "local-llm", label: "Local" }],
      },
    ];
    const section = buildCustomProvidersSection(providers);
    const entry = section?.providers["custom-local"] as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry.baseUrl).toBe("http://localhost:8080/v1");
    expect(entry.apiKey).toBeUndefined();
  });

  it("emits multiple custom providers side by side", () => {
    const providers: AIProviderConfig[] = [
      {
        id: "custom-a",
        baseUrl: "https://a.example.com/v1",
        apiKey: "sk-a",
        models: [{ value: "model-a", label: "A" }],
      },
      {
        id: "openai",
        apiKey: "sk-o",
      },
      {
        id: "custom-b",
        baseUrl: "https://b.example.com/v1",
        apiKey: "sk-b",
        models: [{ value: "model-b", label: "B" }],
      },
    ];
    const section = buildCustomProvidersSection(providers);
    expect(Object.keys(section?.providers ?? {})).toEqual([
      "custom-a",
      "custom-b",
    ]);
  });

  it("falls back to model.value as the name when label is missing", () => {
    const providers: AIProviderConfig[] = [
      {
        id: "custom-x",
        baseUrl: "https://x.example.com/v1",
        apiKey: "sk-x",
        models: [{ value: "raw-id", label: "" }],
      },
    ];
    const section = buildCustomProvidersSection(providers);
    const entry = section?.providers["custom-x"] as { models: Array<{ id: string; name: string }> };
    expect(entry.models[0]).toEqual({ id: "raw-id", name: "raw-id" });
  });
});
