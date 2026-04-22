import type { KanbanMode } from "@opcify/core";
import { KanbanDateControl } from "./kanban-date-control";
import { KanbanModeBadge } from "./kanban-mode-badge";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

interface KanbanHeaderProps {
  mode: KanbanMode;
  selectedDate: string;
  onDateChange: (date: string) => void;
}

const subtitles: Record<KanbanMode, string> = {
  today: "Plan, run, review, and continue today\u2019s work.",
  past: "Review what happened on this day.",
  future: "Plan work ahead and prepare upcoming tasks.",
};

export function KanbanHeader({ mode, selectedDate, onDateChange }: KanbanHeaderProps) {
  return (
    <>
      {/* Sticky compact title bar */}
      <div className="sticky top-14 md:top-0 z-20 -mx-4 -mt-4 border-b border-border-muted bg-surface/95 px-4 pb-2.5 pt-2.5 backdrop-blur-sm md:-mx-8 md:px-8">
        <div className="flex items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="font-bold tracking-tight text-zinc-100 text-xl md:text-2xl shrink-0">
              Kanban
            </h1>
            <KanbanModeBadge mode={mode} />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <KanbanDateControl selectedDate={selectedDate} onDateChange={onDateChange} />
            <div className="hidden md:block">
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </div>
      {/* Subtitle scrolls away naturally with page content */}
      <p className="mt-2 mb-2 text-sm text-zinc-500 hidden sm:block">
        {subtitles[mode]}
      </p>
    </>
  );
}
