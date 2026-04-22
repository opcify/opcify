"use client";

import { Suspense } from "react";
import { useParams, usePathname } from "next/navigation";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { Gem, Menu } from "lucide-react";
import { UserProfileDropdown } from "@/components/user-profile-dropdown";

function SidebarFallback() {
  return (
    <aside className="fixed left-0 top-0 z-50 hidden h-screen w-52 flex-col border-r border-border-muted bg-surface-raised md:flex" />
  );
}

function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const isFullWidth = pathname.includes("/notes") || pathname.includes("/archives") || pathname.includes("/inbox");
  return (
    <main className={`min-h-screen transition-all duration-200 ${collapsed ? "md:ml-14" : "md:ml-52"}`}>
      <div className={isFullWidth ? "" : "mx-auto max-w-6xl px-4 py-4 md:px-8 md:py-4"}>{children}</div>
    </main>
  );
}

function MobileHeader() {
  const { toggle } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border-muted bg-surface px-4 md:hidden">
      <button
        onClick={toggle}
        className="rounded-md p-1.5 text-tertiary hover:bg-surface-overlay hover:text-secondary"
      >
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex flex-1 items-center gap-1.5">
        <Gem className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-bold tracking-tight text-primary">Opcify</span>
      </div>
      <UserProfileDropdown compact />
    </header>
  );
}

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  return (
    <WorkspaceProvider workspaceId={workspaceId} workspaceSlug="">
      <SidebarProvider>
        <Suspense fallback={<SidebarFallback />}>
          <WorkspaceSidebar />
        </Suspense>
        <MobileHeader />
        <MainContent>{children}</MainContent>
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
