"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { api } from "@/lib/api";

interface BlockingQuestionPanelProps {
  workspaceId: string;
  taskId: string;
  question: string;
  onResolved: (summary: string) => void;
}

export function BlockingQuestionPanel({
  workspaceId,
  taskId,
  question,
  onResolved,
}: BlockingQuestionPanelProps) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"continue" | "append" | "cancel" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: "continue" | "append" | "cancel") {
    if (busy) return;
    if (action === "append" && !message.trim()) {
      setErr("Type a response first, or use Continue to resume without input.");
      return;
    }
    setBusy(action);
    setErr(null);
    try {
      await api.kanban.resumeTask(
        workspaceId,
        taskId,
        action,
        action === "append" ? message.trim() : undefined,
      );
      setMessage("");
      const summary =
        action === "append"
          ? "Response sent — task resuming"
          : action === "continue"
            ? "Task resuming"
            : "Task cancelled";
      onResolved(summary);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to resume task");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
        <HelpCircle className="h-3 w-3" />
        Agent is waiting for your input
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-100">{question}</p>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-zinc-500">
          Your response
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="Add guidance or answer the question, then Send. Or use Continue to resume without new input."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-700 disabled:opacity-50"
          disabled={!!busy}
          maxLength={4000}
        />
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => act("append")}
          disabled={!!busy}
          className="rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {busy === "append" ? "Sending…" : "Send response"}
        </button>
        <button
          onClick={() => act("continue")}
          disabled={!!busy}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          {busy === "continue" ? "Resuming…" : "Continue without input"}
        </button>
        <button
          onClick={() => act("cancel")}
          disabled={!!busy}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel task"}
        </button>
      </div>
    </div>
  );
}
