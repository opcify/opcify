"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { AgentTemplateDetail } from "@opcify/core";
import { ModelSelector } from "@/components/agents/model-selector";
import { ConfigFilesEditor, type ConfigFiles } from "@/components/agents/config-files-editor";

interface UseTemplateModalProps {
  template: AgentTemplateDetail;
  workspaceId: string;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    description: string;
    model: string;
    skillIds: string[];
    responsibilitiesSummary: string;
    soul: string;
    agentConfig: string;
    identity: string;
    tools: string;
    user: string;
    heartbeat: string;
    bootstrap: string;
  }) => void;
  submitting: boolean;
  error?: string | null;
}

export function UseTemplateModal({
  template,
  workspaceId,
  onClose,
  onSubmit,
  submitting,
  error,
}: UseTemplateModalProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 fields
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [model, setModel] = useState(template.defaultModel);
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(
    new Set(template.suggestedSkills.map((s) => s.id)),
  );
  const [responsibilities, setResponsibilities] = useState(
    template.responsibilitiesSummary,
  );

  // Step 2 fields
  const [files, setFiles] = useState<ConfigFiles>({
    soul: template.defaultSoul ?? "",
    agentConfig: template.defaultAgentConfig ?? "",
    identity: template.defaultIdentity ?? "",
    tools: template.defaultTools ?? "",
    user: template.defaultUser ?? "",
    bootstrap: template.defaultBootstrap ?? "",
    heartbeat: template.defaultHeartbeat ?? "",
  });

  function toggleSkill(id: string) {
    setSelectedSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleFileChange(key: keyof ConfigFiles, value: string) {
    setFiles((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit() {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      model,
      skillIds: Array.from(selectedSkillIds),
      responsibilitiesSummary: responsibilities.trim(),
      soul: files.soul.trim(),
      agentConfig: files.agentConfig.trim(),
      identity: files.identity.trim(),
      tools: files.tools.trim(),
      user: files.user.trim(),
      heartbeat: files.heartbeat.trim(),
      bootstrap: files.bootstrap.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative max-h-[90vh] w-full overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl transition-all ${
          step === 2 ? "max-w-5xl" : "max-w-2xl"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              Create Agent from Template
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {step === 1
                ? <>Step 1 of 2 — Customize <span className="text-zinc-300">{template.name}</span></>
                : "Step 2 of 2 — Configuration files"}
            </p>
          </div>
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
                Agent Name
              </label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
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

            {/* Skills */}
            {template.suggestedSkills.length > 0 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                  Skills
                </label>
                <div className="flex flex-wrap gap-2">
                  {template.suggestedSkills.map((s) => {
                    const selected = selectedSkillIds.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSkill(s.id)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          selected
                            ? "border-emerald-800 bg-emerald-950/30 text-emerald-400"
                            : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
                        }`}
                      >
                        {selected ? (
                          <>
                            <Check className="inline h-3 w-3 mr-0.5 align-middle" />{" "}
                          </>
                        ) : null}
                        {s.name}
                      </button>
                    );
                  })}
                </div>
                {template.suggestedSkillKeys.length >
                  template.suggestedSkills.length && (
                  <p className="mt-1.5 text-[11px] text-zinc-600">
                    {template.suggestedSkillKeys.length -
                      template.suggestedSkills.length}{" "}
                    suggested skill
                    {template.suggestedSkillKeys.length -
                      template.suggestedSkills.length !==
                    1
                      ? "s"
                      : ""}{" "}
                    not yet in catalog
                  </p>
                )}
              </div>
            )}

            {/* Responsibilities */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-zinc-400">
                Responsibilities
              </label>
              <textarea
                value={responsibilities}
                onChange={(e) => setResponsibilities(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-700"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!name.trim()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
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
                onClick={handleSubmit}
                disabled={!name.trim() || submitting}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Creating\u2026" : "Create Agent"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
