"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useOptionalWorkspace } from "./workspace-context";

/**
 * A workspace-aware Link component. If inside a workspace context,
 * automatically prefixes href with /workspaces/:workspaceId.
 * Only prefixes paths that start with / and don't already start with /workspaces.
 */
export function WsLink({
  href,
  ...props
}: ComponentProps<typeof Link>) {
  const ws = useOptionalWorkspace();
  let resolvedHref = href;

  if (
    ws &&
    typeof href === "string" &&
    href.startsWith("/") &&
    !href.startsWith("/workspaces")
  ) {
    resolvedHref = `/workspaces/${ws.workspaceId}${href}`;
  }

  return <Link href={resolvedHref} {...props} />;
}
