import { WsLink as Link } from "@/lib/workspace-link";
import type { Task } from "@opcify/core";
import { StatusBadge } from "./status-badge";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function TaskTable({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-500">No tasks</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-xs text-zinc-500">
            <th className="pb-2 pr-4 font-medium">Title</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 font-medium">Progress</th>
            <th className="pb-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr
              key={t.id}
              className="border-b border-zinc-800/50 last:border-0"
            >
              <td className="py-3 pr-4">
                <Link
                  href={`/tasks/${t.id}`}
                  className="text-zinc-200 hover:text-white"
                >
                  {t.title}
                </Link>
              </td>
              <td className="py-3 pr-4">
                <StatusBadge status={t.status} />
              </td>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${t.progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500">{t.progress}%</span>
                </div>
              </td>
              <td className="py-3 text-zinc-500">{timeAgo(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
