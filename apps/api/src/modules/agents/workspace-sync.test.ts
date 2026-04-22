import { describe, expect, it } from "vitest";
import { openclawModelId } from "./workspace-sync.js";
import type { AIProviderConfig } from "@opcify/core";

describe("openclawModelId", () => {
  describe("with workspace providers (source of truth)", () => {
    it("resolves a custom Google model to google/<model>, not openai/<model>", () => {
      const providers: AIProviderConfig[] = [
        {
          id: "google",
          apiKey: "sk-google",
          models: [{ value: "gemma-4-31B-it", label: "gemma-4-31B-it" }],
        },
      ];
      expect(openclawModelId("gemma-4-31B-it", providers)).toBe(
        "google/gemma-4-31B-it",
      );
    });

    it("resolves a custom OpenAI model to openai/<model>", () => {
      const providers: AIProviderConfig[] = [
        {
          id: "openai",
          apiKey: "sk-openai",
          models: [{ value: "gpt-4o-2024-11-20", label: "gpt-4o-2024-11-20" }],
        },
      ];
      expect(openclawModelId("gpt-4o-2024-11-20", providers)).toBe(
        "openai/gpt-4o-2024-11-20",
      );
    });

    it("resolves an Anthropic custom model to anthropic/<model>", () => {
      const providers: AIProviderConfig[] = [
        {
          id: "anthropic",
          apiKey: "sk-ant",
          models: [{ value: "my-tuned-model", label: "Tuned" }],
        },
      ];
      expect(openclawModelId("my-tuned-model", providers)).toBe(
        "anthropic/my-tuned-model",
      );
    });

    it("resolves an OpenRouter model by prefixing openrouter/<namespaced>", () => {
      const providers: AIProviderConfig[] = [
        {
          id: "openrouter",
          apiKey: "sk-or",
          models: [
            { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
          ],
        },
      ];
      expect(openclawModelId("anthropic/claude-sonnet-4", providers)).toBe(
        "openrouter/anthropic/claude-sonnet-4",
      );
    });

    it("prefers workspace providers over the built-in lookup", () => {
      // User added a custom "claude-opus-4-6" entry under deepseek — that
      // user choice must win over the BUILT_IN_PROVIDERS mapping.
      const providers: AIProviderConfig[] = [
        {
          id: "deepseek",
          apiKey: "sk-ds",
          models: [{ value: "claude-opus-4-6", label: "Re-routed" }],
        },
      ];
      expect(openclawModelId("claude-opus-4-6", providers)).toBe(
        "deepseek/claude-opus-4-6",
      );
    });

    it("falls through to BUILT_IN_PROVIDERS when the model isn't in settings", () => {
      const providers: AIProviderConfig[] = [
        { id: "google", apiKey: "sk-g", models: [] },
      ];
      expect(openclawModelId("claude-opus-4-6", providers)).toBe(
        "anthropic/claude-opus-4-6",
      );
    });

    it("resolves a fully custom provider (with baseUrl) by its generated id", () => {
      // Custom OpenAI-compatible endpoint added via the wizard — OpenClaw
      // expects the agent model to be `<provider-id>/<model-id>`, which
      // pairs with the models.providers.<id>.models[] registered in
      // openclaw.json via buildCustomProvidersSection.
      const providers: AIProviderConfig[] = [
        {
          id: "custom-m8x7",
          label: "Nvidia",
          baseUrl: "https://integrate.api.nvidia.com/v1",
          apiKey: "sk-nvidia",
          models: [
            { value: "minimaxai/minimax-m2.7", label: "MiniMax M2.7" },
          ],
        },
      ];
      expect(openclawModelId("minimaxai/minimax-m2.7", providers)).toBe(
        "custom-m8x7/minimaxai/minimax-m2.7",
      );
    });
  });

  describe("built-in provider lookup (no workspace providers)", () => {
    it("resolves a built-in Anthropic model via BUILT_IN_PROVIDERS", () => {
      expect(openclawModelId("claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    });

    it("resolves a built-in Google model via BUILT_IN_PROVIDERS", () => {
      expect(openclawModelId("gemini-3.1-pro-preview")).toBe(
        "google/gemini-3.1-pro-preview",
      );
    });

    it("resolves a built-in DeepSeek model via BUILT_IN_PROVIDERS", () => {
      expect(openclawModelId("deepseek-reasoner")).toBe("deepseek/deepseek-reasoner");
    });

    it("resolves a built-in OpenAI model via BUILT_IN_PROVIDERS", () => {
      expect(openclawModelId("gpt-5.4")).toBe("openai/gpt-5.4");
    });

    it("resolves a built-in OpenRouter namespaced model", () => {
      expect(openclawModelId("openai/gpt-4o-mini")).toBe(
        "openrouter/openai/gpt-4o-mini",
      );
    });

    it("returns an unknown model unchanged (no guessing)", () => {
      expect(openclawModelId("totally-unknown-model")).toBe(
        "totally-unknown-model",
      );
    });
  });
});
