"use client";

import { useState } from "react";
import { getProviderForModel, getModelLabel } from "@opcify/core";
import { api } from "@/lib/api";
import { Settings2 } from "lucide-react";
import { ModelSelector } from "./model-selector";

interface AgentModelSettingsProps {
  agentId: string;
  currentModel: string;
  workspaceId: string;
  onSaved: () => void;
}

export function AgentModelSettings({
  agentId,
  currentModel,
  workspaceId,
  onSaved,
}: AgentModelSettingsProps) {
  const [editing, setEditing] = useState(false);

  // Collapsed view — show current model + configure button
  if (!editing) {
    const provider = getProviderForModel(currentModel);
    return (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-200">
            {getModelLabel(currentModel)}
          </p>
          {provider && (
            <p className="mt-0.5 text-xs text-zinc-500">{provider.label}</p>
          )}
          {!provider && (
            <p className="mt-0.5 text-xs text-zinc-500">Custom model</p>
          )}
        </div>
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Configure
        </button>
      </div>
    );
  }

  // Expanded view — full model selector
  return (
    <AgentModelEditor
      agentId={agentId}
      currentModel={currentModel}
      workspaceId={workspaceId}
      onSaved={() => {
        setEditing(false);
        onSaved();
      }}
      onCancel={() => setEditing(false)}
    />
  );
}

// --- Full model editor (shown when user clicks "Configure") ---

function AgentModelEditor({
  agentId,
  currentModel,
  workspaceId,
  onSaved,
  onCancel,
}: AgentModelSettingsProps & { onCancel: () => void }) {
  const [model, setModel] = useState(currentModel);
  const [saving, setSaving] = useState(false);

  const isDirty = model !== currentModel;

  async function handleSave() {
    setSaving(true);
    try {
      await api.agents.update(workspaceId, agentId, { model });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <ModelSelector
        workspaceId={workspaceId}
        model={model}
        onModelChange={setModel}
      />

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Saving\u2026" : "Save Model"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
