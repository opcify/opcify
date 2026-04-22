"use client";

import { useState } from "react";
import { WsLink as Link } from "@/lib/workspace-link";
import { useWorkspaceRouter } from "@/lib/workspace-router";
import { useWorkspace } from "@/lib/workspace-context";
import { api } from "@/lib/api";
import { ModelSelector } from "@/components/agents/model-selector";
import { ConfigFilesEditor, type ConfigFiles } from "@/components/agents/config-files-editor";

export default function CreateAgentPage() {
  const router = useWorkspaceRouter();
  const { workspaceId } = useWorkspace();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("gpt-5.4");

  // Step 2 fields
  const [files, setFiles] = useState<ConfigFiles>({
    soul: "",
    agentConfig: "",
    identity: "",
    tools: "",
    user: "",
    bootstrap: "",
    heartbeat: "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canProceed = name.trim() && role.trim();

  function handleFileChange(key: keyof ConfigFiles, value: string) {
    setFiles((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate() {
    if (!canProceed) return;
    setSaving(true);
    setError(null);

    try {
      const agent = await api.agents.create(workspaceId, {
        name: name.trim(),
        role: role.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(model !== "gpt-5.4" && { model }),
        ...(files.soul.trim() && { soul: files.soul.trim() }),
        ...(files.agentConfig.trim() && { agentConfig: files.agentConfig.trim() }),
        ...(files.identity.trim() && { identity: files.identity.trim() }),
      });
      router.push(`/agents/${agent.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`mx-auto ${step === 2 ? "max-w-5xl" : "max-w-2xl"}`}>
      <Link
        href="/agents"
        className="text-sm text-zinc-500 hover:text-zinc-300"
      >
        &larr; Back to Agents
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Create Agent</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {step === 1
              ? "Step 1 of 2 — Agent basics"
              : "Step 2 of 2 — Configuration files"}
          </p>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${step === 1 ? "bg-emerald-500" : "bg-zinc-600"}`} />
          <div className={`h-2 w-2 rounded-full ${step === 2 ? "bg-emerald-500" : "bg-zinc-600"}`} />
        </div>
      </div>

      {/* Step 1 — Basics */}
      {step === 1 && (
        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Agent Name <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research Assistant"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Role <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. decomposition, research, writer"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional short description of what this agent does..."
              className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Model
            </label>
            <ModelSelector
              workspaceId={workspaceId}
              model={model}
              onModelChange={setModel}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Link
              href="/agents"
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!canProceed}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>

          <p className="text-center text-sm text-zinc-500">
            Prefer a template?{" "}
            <Link href="/agents-hub" className="text-emerald-500 hover:text-emerald-400">
              Browse Agent Hub
            </Link>
          </p>
        </div>
      )}

      {/* Step 2 — Configuration files */}
      {step === 2 && (
        <div className="mt-5 space-y-4">
          <ConfigFilesEditor
            values={files}
            onChange={handleFileChange}
          />

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Creating\u2026" : "Create Agent"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
