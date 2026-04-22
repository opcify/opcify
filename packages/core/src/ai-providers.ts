import type { AIProviderDef } from "./types";

/**
 * Built-in AI provider definitions with their available models.
 * These are the pre-configured providers shown in the AI setup UI.
 */
export const BUILT_IN_PROVIDERS: AIProviderDef[] = [
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { value: "gpt-5.4", label: "GPT-5.4", desc: "1M context, Best intelligence at scale for agentic, coding, and professional workflows" },
      { value: "gpt-5.4-pro", label: "GPT-5.4 Pro", desc: "Enhanced GPT-5.4 for complex reasoning and professional workflows" },
      { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", desc: "React Thinking model for coding and problem solving" },
      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", desc: "OpenAI's strongest mini model yet for coding, computer use, and subagents" },
      { value: "gpt-5.4-nano", label: "GPT-5.4 Nano", desc: "OpenAI's cheapest GPT-5.4-class model for simple high-volume tasks" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      { value: "claude-opus-4-6", label: "Claude Opus 4.6", desc: "1M context,The most intelligent model for building agents and coding" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", desc: "1M context,The best combination of speed and intelligence" },
      { value: "claude-haiku-4-5", label: "Claude Haiku 4.5", desc: "The fastest model with near-frontier intelligence" },
    ],
  },
  {
    id: "google",
    label: "Google",
    models: [
      { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", desc: "Best for complex tasks" },
      { value: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", desc: "Fast and efficient" },
      { value: "gemini-3-flash-preview", label: "Gemini 3.1 Flash", desc: "Budget-friendly" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    models: [
      { value: "deepseek-reasoner", label: "DeepSeek-V3.2", desc: "Reasoning model" },
    ],
  },
  {
    id: "minimax",
    label: "MiniMax",
    models: [
      { value: "minimax-m2.7", label: "MiniMax-M2.7", desc: "General purpose model" },
      { value: "minimax-m2.7-highspeed", label: "MiniMax-M2.7-highspeed", desc: "Optimized for speed" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    models: [
      { value: "openrouter/auto", label: "Auto (best available)", desc: "OpenRouter picks the best model" },
      { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", desc: "Via OpenRouter" },
      { value: "openai/gpt-4o-mini", label: "OpenAI: GPT-4o-mini", desc: "Via OpenRouter" },
      { value: "google/gemini-3-flash-preview", label: "Google: Gemini 3 Flash Preview", desc: "Via OpenRouter" },
      { value: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", desc: "Via OpenRouter" }, 
      { value: "minimax/minimax-m2.7", label: "MiniMax M2.7", desc: "Via OpenRouter" }, 
      { value: "qwen/qwen3.6-plus", label: "Qwen3.6 Plus", desc: "Via OpenRouter" }, 
      { value: "moonshotai/kimi-k2.5", label: "MoonshotAI: Kimi K2.5", desc: "Via OpenRouter" }, 
      { value: "z-ai/glm-5.1", label: "Z.ai: GLM 5.1", desc: "Via OpenRouter" }, 
      { value: "xiaomi/mimo-v2-pro", label: "Xiaomi: MiMo-V2-Pro", desc: "Via OpenRouter" }, 
      { value: "x-ai/grok-4.1-fast", label: "xAI: Grok 4.1 Fast", desc: "Via OpenRouter" },
    ],
  },
];

/**
 * Find a built-in provider by ID.
 */
export function getBuiltInProvider(id: string): AIProviderDef | undefined {
  return BUILT_IN_PROVIDERS.find((p) => p.id === id);
}

/**
 * Find which provider a model belongs to.
 */
export function getProviderForModel(modelValue: string): AIProviderDef | undefined {
  return BUILT_IN_PROVIDERS.find((p) => p.models.some((m) => m.value === modelValue));
}

/**
 * Get a human-readable label for a model value.
 */
export function getModelLabel(modelValue: string): string {
  for (const p of BUILT_IN_PROVIDERS) {
    const m = p.models.find((m) => m.value === modelValue);
    if (m) return m.label;
  }
  return modelValue;
}
