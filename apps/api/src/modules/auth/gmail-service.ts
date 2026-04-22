import { join } from "node:path";
import { mkdir, writeFile, readFile, rm, chmod, copyFile } from "node:fs/promises";
import { createLogger } from "../../logger.js";
import {
  getDataDir,
  getSkillsSourceDir,
} from "../../workspace/WorkspaceConfig.js";
import { getExecutor } from "../../runtime/executor.js";

const log = createLogger("gmail");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

// ─── Token exchange ─────────────────────────────────────────────────

interface GmailTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

// Dedicated Gmail OAuth client — SEPARATE from the login client so that the
// mail scope is not listed on the /login or /signup consent screen. Register a
// second OAuth 2.0 Client in Google Cloud Console with only
// https://mail.google.com/ as its scope.
function getGmailOAuthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_GMAIL_CLIENT_ID or GOOGLE_GMAIL_CLIENT_SECRET not set in server environment",
    );
  }
  return { clientId, clientSecret };
}

export async function exchangeGmailCode(
  code: string,
): Promise<GmailTokenResponse> {
  const { clientId, clientSecret } = getGmailOAuthClient();

  log.info("Exchanging Gmail auth code", {
    clientId: clientId.slice(0, 10) + "...",
    codeLength: code.length,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    log.error(`Gmail token exchange failed (${res.status}): ${text}`);
    // Surface the actual Google error for debugging
    let detail = "Failed to exchange Gmail authorization code";
    try {
      const parsed = JSON.parse(text);
      if (parsed.error_description) detail = parsed.error_description;
      else if (parsed.error) detail = `Google: ${parsed.error}`;
    } catch {
      // not JSON
    }
    throw new Error(detail);
  }

  const data = (await res.json()) as GmailTokenResponse;

  if (!data.refresh_token) {
    throw new Error(
      "No refresh token received. Re-authorize with consent prompt.",
    );
  }

  return data;
}

// ─── Gmail profile ──────────────────────────────────────────────────

export async function getGmailAddress(
  accessToken: string,
): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error("Failed to fetch Google user info");
  }

  const data = (await res.json()) as { email: string };
  return data.email;
}

// ─── Meta read/write helpers ────────────────────────────────────────

interface WorkspaceMetaWithGmail {
  gmail?: {
    email: string;
    refreshToken: string;
    connectedAt: string;
  };
  [key: string]: unknown;
}

async function readMeta(
  workspaceId: string,
): Promise<WorkspaceMetaWithGmail> {
  try {
    const metaPath = join(getDataDir(workspaceId), "opcify-meta.json");
    const raw = await readFile(metaPath, "utf-8");
    return JSON.parse(raw) as WorkspaceMetaWithGmail;
  } catch {
    return {};
  }
}

async function writeMeta(
  workspaceId: string,
  meta: WorkspaceMetaWithGmail,
): Promise<void> {
  const metaPath = join(getDataDir(workspaceId), "opcify-meta.json");
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

// ─── Store / remove / status ────────────────────────────────────────

export async function storeGmailTokens(
  workspaceId: string,
  data: { email: string; refreshToken: string },
): Promise<void> {
  const meta = await readMeta(workspaceId);
  meta.gmail = {
    email: data.email,
    refreshToken: data.refreshToken,
    connectedAt: new Date().toISOString(),
  };
  await writeMeta(workspaceId, meta);
  await writeGmailConfigToDisk(
    workspaceId,
    data.email,
    data.refreshToken,
  );

  // Clear any expired-token flag from previous session
  const flagPath = join(
    getDataDir(workspaceId),
    "data",
    ".gmail",
    "token-expired",
  );
  await rm(flagPath, { force: true });

  log.info("Gmail tokens stored", { workspaceId, email: data.email });
}

export async function removeGmailTokens(
  workspaceId: string,
): Promise<void> {
  const meta = await readMeta(workspaceId);
  delete meta.gmail;
  await writeMeta(workspaceId, meta);

  const gmailDir = join(getDataDir(workspaceId), "data", ".gmail");
  await rm(gmailDir, { recursive: true, force: true });
  log.info("Gmail tokens removed", { workspaceId });
}

export async function getGmailStatus(
  workspaceId: string,
): Promise<{ connected: boolean; email?: string; expired?: boolean }> {
  const meta = await readMeta(workspaceId);
  if (meta.gmail?.refreshToken) {
    // Check if the watcher flagged the refresh token as expired
    let expired = false;
    try {
      const flagPath = join(
        getDataDir(workspaceId),
        "data",
        ".gmail",
        "token-expired",
      );
      await readFile(flagPath, "utf-8");
      expired = true;
    } catch {
      // No flag file — token is fine
    }
    return { connected: true, email: meta.gmail.email, expired };
  }
  return { connected: false };
}

// ─── Write himalaya config + helper script to disk ──────────────────

export async function writeGmailConfigToDisk(
  workspaceId: string,
  email: string,
  refreshToken: string,
): Promise<void> {
  const gmailDir = join(getDataDir(workspaceId), "data", ".gmail");
  await mkdir(gmailDir, { recursive: true });

  // Find the assistant agent slug for direct gateway communication
  let assistantSlug = "personal-assistant"; // fallback
  try {
    const { prisma } = await import("../../db.js");
    const { agentSlug } = await import("../agents/workspace-sync.js");
    // Find the agent with role "assistant" — each workspace has exactly one
    const agent = await prisma.agent.findFirst({
      where: { workspaceId, role: "assistant", deletedAt: null },
    });
    if (agent) {
      assistantSlug = agentSlug(agent.name);
    }
  } catch {
    // Use fallback slug
  }

  const { clientId: gmailClientId, clientSecret: gmailClientSecret } =
    getGmailOAuthClient();

  // 1. credentials.json
  const credentials = {
    refresh_token: refreshToken,
    client_id: gmailClientId,
    client_secret: gmailClientSecret,
    email,
    assistant_agent_slug: assistantSlug,
  };
  await writeFile(
    join(gmailDir, "credentials.json"),
    JSON.stringify(credentials, null, 2),
    "utf-8",
  );

  // 2. Helper scripts for himalaya secret retrieval (no keyring in Docker)
  const gmailDirContainer = "/home/node/.openclaw/data/.gmail";
  const credFileContainer = `${gmailDirContainer}/credentials.json`;

  // get-secret.sh — reads a field from credentials.json by key name
  const getSecretScript = `#!/bin/bash
set -euo pipefail
KEY="$1"
sed -n "s/.*\\"$KEY\\": *\\"\\([^\\"]*\\)\\".*/\\1/p" "${credFileContainer}"
`;
  const getSecretPath = join(gmailDir, "get-secret.sh");
  await writeFile(getSecretPath, getSecretScript, "utf-8");
  await chmod(getSecretPath, 0o755);

  // get-access-token.sh — uses refresh_token to get a fresh access_token
  // Outputs access_token to stdout. On failure, outputs full Google error to stderr.
  const accessTokenScript = `#!/bin/bash
set -euo pipefail
CRED="${credFileContainer}"
RT=$(sed -n 's/.*"refresh_token": *"\\([^"]*\\)".*/\\1/p' "$CRED")
CID=$(sed -n 's/.*"client_id": *"\\([^"]*\\)".*/\\1/p' "$CRED")
CS=$(sed -n 's/.*"client_secret": *"\\([^"]*\\)".*/\\1/p' "$CRED")
RESPONSE=$(curl -s -X POST https://oauth2.googleapis.com/token \\
  -d "refresh_token=$RT" \\
  -d "client_id=$CID" \\
  -d "client_secret=$CS" \\
  -d "grant_type=refresh_token")
TOKEN=$(echo "$RESPONSE" | sed -n 's/.*"access_token": *"\\([^"]*\\)".*/\\1/p')
if [ -n "$TOKEN" ]; then
  echo "$TOKEN"
else
  echo "$RESPONSE" >&2
  exit 1
fi
`;
  const accessTokenPath = join(gmailDir, "get-access-token.sh");
  await writeFile(accessTokenPath, accessTokenScript, "utf-8");
  await chmod(accessTokenPath, 0o755);

  // 3. config.toml — himalaya configuration (correct oauth2 format)
  const clientId = gmailClientId;
  const configToml = `[accounts.gmail]
default = true
email = "${email}"

folder.aliases.inbox = "INBOX"
folder.aliases.sent = "[Gmail]/Sent Mail"
folder.aliases.drafts = "[Gmail]/Drafts"
folder.aliases.trash = "[Gmail]/Trash"

backend.type = "imap"
backend.host = "imap.gmail.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "${email}"
backend.auth.type = "oauth2"
backend.auth.method = "xoauth2"
backend.auth.client-id = "${clientId}"
backend.auth.client-secret.cmd = "${gmailDirContainer}/get-secret.sh client_secret"
backend.auth.access-token.cmd = "${gmailDirContainer}/get-access-token.sh"
backend.auth.refresh-token.cmd = "${gmailDirContainer}/get-secret.sh refresh_token"
backend.auth.auth-url = "https://accounts.google.com/o/oauth2/v2/auth"
backend.auth.token-url = "https://www.googleapis.com/oauth2/v3/token"
backend.auth.pkce = true
backend.auth.scope = "https://mail.google.com/"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.gmail.com"
message.send.backend.port = 465
message.send.backend.encryption.type = "tls"
message.send.backend.login = "${email}"
message.send.backend.auth.type = "oauth2"
message.send.backend.auth.method = "xoauth2"
message.send.backend.auth.client-id = "${clientId}"
message.send.backend.auth.client-secret.cmd = "${gmailDirContainer}/get-secret.sh client_secret"
message.send.backend.auth.access-token.cmd = "${gmailDirContainer}/get-access-token.sh"
message.send.backend.auth.refresh-token.cmd = "${gmailDirContainer}/get-secret.sh refresh_token"
message.send.backend.auth.auth-url = "https://accounts.google.com/o/oauth2/v2/auth"
message.send.backend.auth.token-url = "https://www.googleapis.com/oauth2/v3/token"
message.send.backend.auth.pkce = true
message.send.backend.auth.scope = "https://mail.google.com/"
`;
  await writeFile(join(gmailDir, "config.toml"), configToml, "utf-8");

  // 4. email-watcher.py — copy from opcify skill scripts
  const watcherSrc = join(
    getSkillsSourceDir(),
    "opcify",
    "scripts",
    "email-watcher.py",
  );
  const watcherDst = join(gmailDir, "email-watcher.py");
  await copyFile(watcherSrc, watcherDst);
  await chmod(watcherDst, 0o755);

  log.info("Gmail himalaya config + email watcher written", {
    workspaceId,
    email,
  });
}

// ─── Container exec helper ──────────────────────────────────────────

async function execInContainer(
  workspaceId: string,
  cmd: string[],
): Promise<{ stdout: string; exitCode: number }> {
  const { stdout, stderr, exitCode } = await getExecutor().exec(workspaceId, cmd);
  // himalaya's interactive/verify messages arrive on stderr — merge on
  // failure so caller can surface them when the step fails.
  return { stdout: exitCode === 0 ? stdout : [stdout, stderr].filter(Boolean).join("\n"), exitCode };
}

// ─── Configure himalaya + verify connection ─────────────────────────

/**
 * Run `himalaya account configure gmail` inside the container to complete
 * the OAuth2 setup, then verify with `himalaya envelope list`.
 */
export async function configureAndVerifyGmail(
  workspaceId: string,
): Promise<{ success: boolean; output: string }> {
  try {
    // Step 1: Run himalaya account configure (non-interactive with .cmd secrets)
    log.info("Running himalaya account configure in container", {
      workspaceId,
    });
    const configure = await execInContainer(workspaceId, [
      "himalaya",
      "account",
      "configure",
      "gmail",
    ]);
    log.info("himalaya configure result", {
      exitCode: configure.exitCode,
      output: configure.stdout.slice(0, 500),
    });

    // Step 2: Verify by listing envelopes
    log.info("Verifying Gmail connection with himalaya envelope list", {
      workspaceId,
    });
    const verify = await execInContainer(workspaceId, [
      "himalaya",
      "envelope",
      "list",
      "--folder",
      "INBOX",
      "--page-size",
      "1",
    ]);
    log.info("himalaya verify result", {
      exitCode: verify.exitCode,
      output: verify.stdout.slice(0, 500),
    });

    if (verify.exitCode === 0) {
      // Step 3: Enable the himalaya skill for all agents
      try {
        const { toggleSkill } = await import(
          "../openclaw-capabilities/service.js"
        );
        await toggleSkill(workspaceId, "himalaya", true);
        log.info("Himalaya skill enabled for agents", { workspaceId });
      } catch (err) {
        log.warn(
          `Failed to enable himalaya skill: ${(err as Error).message}`,
        );
      }

      // Step 4: Send instruction to agent to start email watcher
      try {
        const { chatService } = await import("../chat/service.js");
        const { agentSlug } = await import(
          "../agents/workspace-sync.js"
        );
        const { prisma } = await import("../../db.js");

        const agent = await prisma.agent.findFirst({
          where: { workspaceId, role: "assistant", deletedAt: null },
        });

        if (agent) {
          const slug = agentSlug(agent.name);
          // Load the connected email from meta
          const meta = await readMeta(workspaceId);
          const connectedEmail = meta.gmail?.email || "your Gmail";

          await chatService.send(workspaceId, slug, {
            sessionKey: "email",
            message: `[SYSTEM] Gmail has been connected (${connectedEmail}). Please:

1. Start the email watcher by running:
   nohup /home/node/.openclaw-env/bin/python3 /home/node/.openclaw/data/.gmail/email-watcher.py > /home/node/.openclaw/data/.gmail/watcher.log 2>&1 &

2. Create a recurring task (every 30 minutes) to monitor the email watcher:
   - Check if the watcher process is running: ps aux | grep email-watcher
   - If not running, restart it with the command above
   - Clean up old log entries if watcher.log exceeds 1MB
   - Report status back

3. When the email watcher detects new email (inbox or sent), it will send you a chat message.
   When you receive it:

   **For INBOX emails:**
   - Run: himalaya envelope list --folder INBOX --page-size 20
   - Read each unread/new email: himalaya message read <id>
   - AI triage: Is this routine (ignore/archive) or needs boss attention?
   - For important emails, POST to \${OPCIFY_API_URL}/workspaces/\${OPCIFY_WORKSPACE_ID}/inbox
     with content, emailFrom, emailTo, emailSubject, emailDate, aiSummary, aiUrgency, aiSuggestedAction, aiDraftReply
   - Include header: Authorization: Bearer \${OPCIFY_API_KEY}
   - Let the user know what you found

   **For SENT emails (so they appear in thread view):**
   - Run: himalaya envelope list --folder "[Gmail]/Sent Mail" --page-size 10
   - Read recent sent emails: himalaya message read --folder "[Gmail]/Sent Mail" <id>
   - POST each sent email to \${OPCIFY_API_URL}/workspaces/\${OPCIFY_WORKSPACE_ID}/inbox
     with content, emailFrom (= ${connectedEmail}), emailTo, emailSubject, emailDate,
     source "email", kind "email". No AI triage needed for sent emails.
   - The API will automatically deduplicate by emailMessageId, so always include it.
   - This ensures the user's own replies appear in the Opcify Inbox thread view.`,
          });
          log.info("Sent email watcher instruction to agent", {
            workspaceId,
            agentId: agent.id,
          });
        }
      } catch (err) {
        log.warn(
          `Failed to send watcher instruction to agent: ${(err as Error).message}`,
        );
      }

      return {
        success: true,
        output: verify.stdout.trim(),
      };
    }

    return {
      success: false,
      output:
        configure.stdout.trim() + "\n---\n" + verify.stdout.trim(),
    };
  } catch (err) {
    log.error(
      `Gmail configure/verify failed: ${(err as Error).message}`,
    );
    return {
      success: false,
      output: (err as Error).message,
    };
  }
}
