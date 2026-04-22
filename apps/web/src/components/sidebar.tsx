"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  ListTodo,
  Sparkles,
  Gem,
} from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Kanban", Icon: LayoutDashboard },
  { href: "/agents", label: "Agents", Icon: Bot },
  { href: "/tasks", label: "Tasks", Icon: ListTodo },
  { href: "/skills", label: "Skills", Icon: Sparkles },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromKanban = searchParams.get("from") === "kanban";

  function isActive(href: string) {
    // When viewing a task/edit or task group from Kanban, keep Kanban highlighted
    if (fromKanban && (pathname.startsWith("/tasks/") || pathname.startsWith("/task-groups/") || pathname.startsWith("/task-hub"))) {
      if (href === "/") return true;
      if (href === "/tasks") return false;
    }
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-52 flex-col border-r border-zinc-800 bg-zinc-900">
      <div className="px-5 py-5">
        <h1 className="text-lg font-bold tracking-tight flex items-center gap-1.5">
          <Gem className="h-5 w-5 text-emerald-400" /> Opcify
        </h1>
        <p className="mt-0.5 text-xs text-zinc-500">OpenClaw Dashboard</p>
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              isActive(item.href)
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
            }`}
          >
            <item.Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t border-zinc-800 px-5 py-4">
        <p className="text-xs text-zinc-600">v0.1.0</p>
      </div>
    </aside>
  );
}
