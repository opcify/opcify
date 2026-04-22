"use client";

import { useEffect, useRef, useState } from "react";
import { Settings, Wrench } from "lucide-react";

interface ChatSettingsMenuProps {
  showToolCalls: boolean;
  onToggleToolCalls: (next: boolean) => void;
}

export function ChatSettingsMenu({
  showToolCalls,
  onToggleToolCalls,
}: ChatSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Chat settings"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-tertiary transition-colors hover:bg-surface-overlay hover:text-secondary"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-border-muted bg-surface-raised shadow-xl">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
            Chat settings
          </div>
          <button
            onClick={() => onToggleToolCalls(!showToolCalls)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-tertiary transition-colors hover:bg-surface-overlay/50 hover:text-secondary"
          >
            <span className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-amber-400" />
              <span>Show tool calls</span>
            </span>
            <span
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                showToolCalls ? "bg-emerald-500/70" : "bg-zinc-700"
              }`}
              aria-hidden="true"
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  showToolCalls ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>
          <div className="border-t border-border-muted px-3 py-2 text-[11px] text-muted">
            Tool call messages are collapsed by default. Click a tool call to see its details.
          </div>
        </div>
      )}
    </div>
  );
}
