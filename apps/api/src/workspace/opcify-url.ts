import type { WorkspaceMeta } from "./WorkspaceConfig.js";

export function getOpcifyCallbackUrl(): string {
  const apiPort = process.env.API_PORT || "4210";
  return (
    process.env.OPCIFY_CALLBACK_URL ||
    `http://host.docker.internal:${apiPort}`
  );
}

export function getOpcifyCallbackToken(
  meta?: WorkspaceMeta | null,
): string | undefined {
  return meta?.opcifyApiKey || process.env.OPCIFY_CALLBACK_TOKEN;
}
