"use client";

import type { WaitingReason } from "@opcify/core";

const WAITING_LABELS: Record<WaitingReason, string> = {
  waiting_for_review: "Waiting for review",
  waiting_for_input: "Waiting for input",
  waiting_for_dependency: "Blocked",
  waiting_for_retry: "Waiting for retry",
  waiting_for_external: "Waiting (external)",
};

interface WaitingBadgeProps {
  waitingReason: WaitingReason;
}

export function WaitingBadge({ waitingReason }: WaitingBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-400">
      <span className="h-1 w-1 rounded-full bg-orange-400" />
      {WAITING_LABELS[waitingReason]}
    </span>
  );
}

interface BlockedByBadgeProps {
  blockerTitle: string;
  blockerId?: string;
}

export function BlockedByBadge({ blockerTitle }: BlockedByBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
      <span className="h-1 w-1 rounded-full bg-red-400" />
      Blocked by: {blockerTitle}
    </span>
  );
}

export function waitingReasonLabel(reason: WaitingReason): string {
  return WAITING_LABELS[reason];
}
