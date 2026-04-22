"use client";

import { useState, useRef } from "react";
import {
  Star,
  Diamond,
  Zap,
  Eye,
  AlertTriangle,
  ArrowRight,
  Navigation,
} from "lucide-react";

const SECTIONS = [
  { id: "focus", label: "Focus", Icon: Star, color: "text-amber-400" },
  { id: "plan", label: "Plan", Icon: Diamond, color: "text-blue-400" },
  { id: "in-progress", label: "In Progress", Icon: Zap, color: "text-emerald-400" },
  { id: "review", label: "Review", Icon: Eye, color: "text-amber-400" },
  { id: "failed", label: "Failed", Icon: AlertTriangle, color: "text-red-400" },
  { id: "next-actions", label: "Next", Icon: ArrowRight, color: "text-zinc-400" },
];

export function KanbanSectionNav() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 300);
  };

  const scrollTo = (id: string) => {
    const el = document.getElementById(`kanban-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setOpen(false);
    }
  };

  return (
    <div className="fixed opacity-90 bottom-6 right-6 z-30 flex flex-col items-end gap-2 pointer-events-none md:right-8">
      {/* Section menu */}
      <div
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className={`flex flex-col gap-1 rounded-2xl border border-zinc-700/30 bg-zinc-900/60 p-1.5 shadow-2xl backdrop-blur-xl transition-all duration-200 origin-bottom ${
          open
            ? "scale-100 opacity-100 pointer-events-auto"
            : "scale-95 opacity-0 pointer-events-none"
        }`}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            className="flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-xs font-medium text-zinc-300/90 transition-colors hover:bg-white/10 hover:text-white"
          >
            <s.Icon className={`h-3.5 w-3.5 ${s.color}`} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Trigger button — hover area restricted to this element */}
      <button
        onMouseEnter={() => { cancelClose(); setOpen(true); }}
        onMouseLeave={scheduleClose}
        className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700/20 bg-zinc-900/35 text-zinc-600 shadow-lg backdrop-blur-xl transition-all duration-200 hover:bg-zinc-800/50 hover:text-zinc-400"
      >
        <Navigation className="h-4 w-4" />
      </button>
    </div>
  );
}
