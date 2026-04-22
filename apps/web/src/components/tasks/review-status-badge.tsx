"use client";

import type { ReviewStatus } from "@opcify/core";

const STYLES: Record<ReviewStatus, { label: string; dot: string; text: string; bg: string }> = {
  pending: {
    label: "Pending Review",
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  accepted: {
    label: "Accepted",
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  rejected: {
    label: "Rejected",
    dot: "bg-red-400",
    text: "text-red-400",
    bg: "bg-red-500/10",
  },
  followed_up: {
    label: "Followed Up",
    dot: "bg-blue-400",
    text: "text-blue-400",
    bg: "bg-blue-500/10",
  },
};

interface ReviewStatusBadgeProps {
  status: ReviewStatus;
}

export function ReviewStatusBadge({ status }: ReviewStatusBadgeProps) {
  const style = STYLES[status];
  if (!style) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.text} ${style.bg}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
