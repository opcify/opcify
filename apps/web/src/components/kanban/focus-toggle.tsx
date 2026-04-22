"use client";

import { Star } from "lucide-react";

interface FocusToggleProps {
  isFocus: boolean;
  onToggle: () => void;
  size?: "sm" | "md";
}

export function FocusToggle({ isFocus, onToggle, size = "sm" }: FocusToggleProps) {
  const sizeClasses = size === "md" ? "h-7 w-7 text-sm" : "h-5 w-5 text-xs";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      title={isFocus ? "Remove from focus" : "Mark as focus"}
      className={`inline-flex items-center justify-center rounded-md transition-all ${sizeClasses} ${
        isFocus
          ? "text-amber-400 hover:text-amber-300"
          : "text-zinc-600 hover:text-amber-400/70"
      }`}
    >
      {isFocus ? <Star className="h-full w-full fill-current" /> : <Star className="h-full w-full" />}
    </button>
  );
}
