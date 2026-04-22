"use client";

import { useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { FileText } from "lucide-react";

const FILE_META: { key: string; title: string; desc: string }[] = [
  { key: "soul", title: "SOUL.md", desc: "Personality & principles" },
  { key: "agentConfig", title: "AGENTS.md", desc: "Operational logic & rules" },
  { key: "identity", title: "IDENTITY.md", desc: "Display identity" },
  { key: "tools", title: "TOOLS.md", desc: "Tool configuration" },
  { key: "user", title: "USER.md", desc: "User context" },
  { key: "bootstrap", title: "BOOTSTRAP.md", desc: "Bootstrap instructions" },
  { key: "heartbeat", title: "HEARTBEAT.md", desc: "Periodic check-in" },
];

export interface ConfigFiles {
  soul: string;
  agentConfig: string;
  identity: string;
  tools: string;
  user: string;
  bootstrap: string;
  heartbeat: string;
}

interface ConfigFilesEditorProps {
  values: ConfigFiles;
  onChange: (key: keyof ConfigFiles, value: string) => void;
  placeholders?: Partial<Record<keyof ConfigFiles, string>>;
}

const DEFAULT_PLACEHOLDERS: Record<keyof ConfigFiles, string> = {
  soul: "Define the agent's personality and core principles\u2026",
  agentConfig: "Define operational logic, session startup, and rules\u2026",
  identity: "Name, role, tone\u2026",
  tools: "Tool guidance and configuration\u2026",
  user: "Information about the user this agent serves\u2026",
  bootstrap: "Bootstrap and initialization instructions\u2026",
  heartbeat: "Heartbeat and periodic check-in configuration\u2026",
};

/**
 * Two-column config file editor.
 * Left: file list sidebar. Right: markdown editor for the selected file.
 */
export function ConfigFilesEditor({
  values,
  onChange,
  placeholders,
}: ConfigFilesEditorProps) {
  const [selected, setSelected] = useState("soul");

  const meta = FILE_META.find((f) => f.key === selected)!;
  const ph = placeholders?.[selected as keyof ConfigFiles] ?? DEFAULT_PLACEHOLDERS[selected as keyof ConfigFiles];

  return (
    <div className="flex gap-0 rounded-lg border border-zinc-800 overflow-hidden" style={{ minHeight: 560 }}>
      {/* Left sidebar — file list */}
      <div className="w-44 shrink-0 border-r border-zinc-800 bg-zinc-900/70">
        {FILE_META.map((f) => {
          const isSelected = f.key === selected;
          const hasContent = !!values[f.key as keyof ConfigFiles];
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setSelected(f.key)}
              className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                isSelected
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300"
              }`}
            >
              <FileText className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isSelected ? "text-emerald-400" : hasContent ? "text-zinc-500" : "text-zinc-700"}`} />
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{f.title}</p>
                <p className="text-[10px] text-zinc-600 truncate">{f.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Right — editor */}
      <div className="flex-1 flex flex-col bg-zinc-950">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
          <span className="text-xs font-medium text-zinc-300">{meta.title}</span>
          <span className="text-[10px] text-zinc-600">{meta.desc}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <MarkdownEditor
            key={selected}
            value={values[selected as keyof ConfigFiles]}
            onChange={(v) => onChange(selected as keyof ConfigFiles, v)}
            placeholder={ph}
            fill
          />
        </div>
      </div>
    </div>
  );
}
