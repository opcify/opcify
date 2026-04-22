"use client";

import { useState, useRef } from "react";
import type { AIProviderConfig, WorkspaceAISettings } from "@opcify/core";
import { BUILT_IN_PROVIDERS, getProviderForModel } from "@opcify/core";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Plus, X, Server, ChevronDown, ChevronRight, Eye, EyeOff, Check } from "lucide-react";

interface ModelSelectorProps {
  workspaceId: string;
  model: string;
  onModelChange: (model: string) => void;
}

/**
 * Provider-accordion model selector. Shows built-in and custom providers,
 * API key management, and custom model/provider forms.
 * Standalone — does not save to an agent; the parent controls persistence.
 */
export function ModelSelector({
  workspaceId,
  model,
  onModelChange,
}: ModelSelectorProps) {
  const { data: workspace, refetch: refetchWorkspace } = useApi(
    () => api.workspaces.get(workspaceId),
    [workspaceId],
  );

  let aiSettings: WorkspaceAISettings | null = null;
  if (workspace?.settingsJson) {
    try {
      aiSettings = JSON.parse(workspace.settingsJson) as WorkspaceAISettings;
    } catch {
      // ignore
    }
  }

  const customProviders = (aiSettings?.providers ?? []).filter((p) => p.baseUrl);

  const extraModelsMap = new Map<string, { value: string; label: string; desc?: string }[]>();
  for (const p of aiSettings?.providers ?? []) {
    if (!p.baseUrl && p.models?.length) {
      extraModelsMap.set(p.id, p.models);
    }
  }

  let initialProvider = "openai";
  const bp = getProviderForModel(model);
  if (bp) {
    initialProvider = bp.id;
  } else {
    for (const [pid, models] of extraModelsMap) {
      if (models.some((m) => m.value === model)) { initialProvider = pid; break; }
    }
    if (initialProvider === "openai" && !bp) {
      const cp = customProviders.find((p) =>
        p.models?.some((m) => m.value === model),
      );
      if (cp) initialProvider = cp.id;
    }
  }

  const idCounter = useRef(0);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  const [expandedProvider, setExpandedProvider] = useState<string | null>(initialProvider);
  const [customModelInputFor, setCustomModelInputFor] = useState<string | null>(null);
  const [customModelValue, setCustomModelValue] = useState("");

  async function saveCustomModelToProvider(providerId: string, modelValue: string) {
    const currentProviders = aiSettings?.providers ?? [];
    const existingConf = currentProviders.find((p) => p.id === providerId && !p.baseUrl);
    const otherConfs = currentProviders.filter((p) => !(p.id === providerId && !p.baseUrl));
    const existingModels = existingConf?.models ?? [];

    if (existingModels.some((m) => m.value === modelValue)) {
      onModelChange(modelValue);
      return;
    }

    const updatedSettings: WorkspaceAISettings = {
      providers: [
        ...otherConfs,
        {
          ...existingConf,
          id: providerId,
          apiKey: existingConf?.apiKey ?? "",
          models: [...existingModels, { value: modelValue, label: modelValue }],
        },
      ],
      defaultModel: aiSettings?.defaultModel ?? "gpt-5.4",
    };

    try {
      await api.workspaces.update(workspaceId, {
        settingsJson: JSON.stringify(updatedSettings),
      });
      onModelChange(modelValue);
      refetchWorkspace();
    } catch {
      // Silently fail
    }
  }

  async function addCustomProvider() {
    if (!customLabel.trim() || !customBaseUrl.trim() || !customModelName.trim()) return;

    idCounter.current += 1;
    const customId = `custom-${idCounter.current}`;
    const newProvider: AIProviderConfig = {
      id: customId,
      label: customLabel.trim(),
      baseUrl: customBaseUrl.trim(),
      apiKey: customApiKey.trim(),
      models: [{ value: customModelName.trim(), label: customModelName.trim() }],
    };

    const currentProviders = aiSettings?.providers ?? [];
    const updatedSettings: WorkspaceAISettings = {
      providers: [...currentProviders, newProvider],
      defaultModel: aiSettings?.defaultModel ?? "gpt-5.4",
    };

    try {
      await api.workspaces.update(workspaceId, {
        settingsJson: JSON.stringify(updatedSettings),
      });
      setExpandedProvider(customId);
      onModelChange(customModelName.trim());
      setShowCustomForm(false);
      setCustomLabel("");
      setCustomBaseUrl("");
      setCustomApiKey("");
      setCustomModelName("");
      refetchWorkspace();
    } catch {
      // Silently fail
    }
  }

  const allProviders = [
    ...BUILT_IN_PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      models: [...p.models, ...(extraModelsMap.get(p.id) ?? [])],
      isCustom: false,
    })),
    ...customProviders.map((p) => ({
      id: p.id,
      label: p.label ?? p.id,
      models: p.models ?? [],
      isCustom: true,
    })),
  ];

  return (
    <div>
      <div className="space-y-1">
        {allProviders.map((provider) => {
          const isExpanded = expandedProvider === provider.id;
          const hasSelectedModel = provider.models.some((m) => m.value === model);

          return (
            <div key={provider.id} className="rounded-lg border border-zinc-800 bg-zinc-900">
              <button
                type="button"
                onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                {provider.isCustom ? (
                  <Server className="h-4 w-4 shrink-0 text-zinc-500" />
                ) : (
                  <div className="flex h-4 w-4 items-center justify-center">
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                    )}
                  </div>
                )}
                <span className="flex-1 text-sm font-medium text-zinc-200">
                  {provider.label}
                </span>
                {hasSelectedModel && (
                  <span className="text-xs text-emerald-400">
                    {provider.models.find((m) => m.value === model)?.label}
                  </span>
                )}
                <span className="text-xs text-zinc-600">
                  {provider.models.length} model{provider.models.length !== 1 ? "s" : ""}
                </span>
              </button>

              {isExpanded && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  <div className="grid grid-cols-2 gap-2">
                    {provider.models.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => {
                          onModelChange(m.value);
                          setCustomModelInputFor(null);
                        }}
                        className={`rounded-md border px-3 py-2 text-left text-sm transition-all ${
                          model === m.value
                            ? "border-emerald-600 bg-emerald-600/10 text-emerald-300"
                            : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                        }`}
                      >
                        <span className="font-medium">{m.label}</span>
                        {m.desc && (
                          <span className="mt-0.5 block text-xs text-zinc-500">{m.desc}</span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* API Key for this provider */}
                  <ProviderApiKeyInput
                    providerId={provider.id}
                    aiSettings={aiSettings}
                    workspaceId={workspaceId}
                    onSaved={refetchWorkspace}
                  />

                  {customModelInputFor !== provider.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomModelInputFor(provider.id);
                        setCustomModelValue("");
                      }}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                      <Plus className="h-3 w-3" />
                      Add custom model
                    </button>
                  ) : (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={customModelValue}
                        onChange={(e) => setCustomModelValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customModelValue.trim()) {
                            e.preventDefault();
                            saveCustomModelToProvider(provider.id, customModelValue.trim());
                            setCustomModelValue("");
                            setCustomModelInputFor(null);
                          }
                        }}
                        placeholder="e.g. gpt-4o-2024-11-20"
                        autoFocus
                        className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (customModelValue.trim()) {
                            saveCustomModelToProvider(provider.id, customModelValue.trim());
                            setCustomModelValue("");
                            setCustomModelInputFor(null);
                          }
                        }}
                        className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-600"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomModelInputFor(null);
                          setCustomModelValue("");
                        }}
                        className="rounded-md px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!showCustomForm ? (
        <button
          type="button"
          onClick={() => setShowCustomForm(true)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <Plus className="h-3 w-3" />
          Add custom provider
        </button>
      ) : (
        <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-300">Custom AI Provider</p>
            <button
              type="button"
              onClick={() => setShowCustomForm(false)}
              className="rounded p-1 text-zinc-600 transition-colors hover:text-zinc-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Connect your own model endpoint (OpenAI-compatible API).
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400">Provider Name</label>
              <input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. My Local LLM"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400">Base URL</label>
              <input
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="e.g. https://api.example.com/v1"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400">Model Name</label>
              <input
                type="text"
                value={customModelName}
                onChange={(e) => setCustomModelName(e.target.value)}
                placeholder="e.g. llama-3-70b, mixtral-8x7b"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400">API Key (optional)</label>
              <input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="sk-..."
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addCustomProvider}
                disabled={!customLabel.trim() || !customBaseUrl.trim() || !customModelName.trim()}
                className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-40"
              >
                Add Provider
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCustomForm(false);
                  setCustomLabel("");
                  setCustomBaseUrl("");
                  setCustomApiKey("");
                  setCustomModelName("");
                }}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Provider API Key input (shown inside expanded provider) ---

function ProviderApiKeyInput({
  providerId,
  aiSettings,
  workspaceId,
  onSaved,
}: {
  providerId: string;
  aiSettings: WorkspaceAISettings | null;
  workspaceId: string;
  onSaved: () => void;
}) {
  const existingConfig = (aiSettings?.providers ?? []).find((p) => p.id === providerId);
  const savedKey = existingConfig?.apiKey ?? "";

  const [editing, setEditing] = useState(false);
  const [keyValue, setKeyValue] = useState(savedKey);
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const currentProviders = aiSettings?.providers ?? [];
      const others = currentProviders.filter((p) => p.id !== providerId);
      const existing = currentProviders.find((p) => p.id === providerId);

      const updatedSettings: WorkspaceAISettings = {
        providers: [
          ...others,
          {
            ...existing,
            id: providerId,
            apiKey: keyValue.trim(),
            models: existing?.models ?? [],
          },
        ],
        defaultModel: aiSettings?.defaultModel ?? "gpt-5.4",
      };

      await api.workspaces.update(workspaceId, {
        settingsJson: JSON.stringify(updatedSettings),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="mt-3 flex items-center justify-between border-t border-zinc-800/50 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">API Key:</span>
          {savedKey ? (
            <span className="font-mono text-xs text-zinc-400">
              {savedKey.slice(0, 8)}{"•".repeat(8)}
            </span>
          ) : (
            <span className="text-xs text-zinc-600">Not set</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setKeyValue(savedKey); setEditing(true); setVisible(false); }}
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {savedKey ? "Change" : "Set API Key"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-zinc-800/50 pt-3">
      <label className="block text-xs font-medium text-zinc-400">API Key</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type={visible ? "text" : "password"}
          value={keyValue}
          onChange={(e) => setKeyValue(e.target.value)}
          placeholder="sk-..."
          autoFocus
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 font-mono text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="rounded-md border border-zinc-700 p-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          <Check className="h-3 w-3" />
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
