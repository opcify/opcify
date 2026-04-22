"use client";

import { useState, useRef, useEffect } from "react";

interface TaskActionsMenuProps {
  taskId: string;
  taskStatus?: string;
  onViewDetails: () => void;
  onMarkDone: () => void;
  onMarkFailed: () => void;
  onStop?: () => void;
}

export function TaskActionsMenu({
  taskStatus,
  onViewDetails,
  onMarkDone,
  onMarkFailed,
  onStop,
}: TaskActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0"
        >
          <circle cx="8" cy="3" r="1.25" fill="currentColor" />
          <circle cx="8" cy="8" r="1.25" fill="currentColor" />
          <circle cx="8" cy="13" r="1.25" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            View Details
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkDone();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-400 transition-colors hover:bg-zinc-800"
          >
            Mark Done
          </button>
          {onStop && (taskStatus === "running" || taskStatus === "queued") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStop();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-orange-400 transition-colors hover:bg-zinc-800"
            >
              Stop
            </button>
          )}
          <div className="my-1 border-t border-zinc-800" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkFailed();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-zinc-800"
          >
            Mark Failed
          </button>
        </div>
      )}
    </div>
  );
}
