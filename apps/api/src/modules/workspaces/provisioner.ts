import { prisma } from "../../db.js";
import type { WorkspaceTemplateConfig, WorkspaceTemplateAgent, WorkspaceAISettings } from "@opcify/core";
import { createLogger } from "../../logger.js";
import { workspaceService } from "../../workspace/WorkspaceService.js";
import type {
  WorkspaceUserConfig,
  WorkspaceMemoryConfig,
} from "../../workspace/types.js";
import { isManagedSkill } from "../../workspace/WorkspaceConfig.js";
import { syncAgentToWorkspace, syncAuthProfilesToWorkspace } from "../agents/workspace-sync.js";
import { installSkillBySlug, invalidateCapabilitiesCache } from "../openclaw-capabilities/service.js";

const log = createLogger("workspace_provisioner");

interface ProvisionOptions {
  workspaceId: string;
  templateKey?: string;
  agents?: WorkspaceTemplateAgent[];
  skillKeys?: string[];
  /** Opcify managed skills selected by the user. "opcify" is always included. */
  managedSkillKeys?: string[];
  enableDemoData?: boolean;
  dockerConfig?: WorkspaceUserConfig;
  defaultModel?: string;
}

export async function provisionWorkspace(opts: ProvisionOptions): Promise<void> {
  const { workspaceId, templateKey, agents: customAgents, skillKeys: customSkillKeys } = opts;

  // Guard: prevent provisioning an already-ready workspace. Pull the owner's
  // timezone in the same query so we can seed `userConfig.timezone` below —
  // without this the gateway falls back to UTC even when the user profile
  // has a real IANA zone like "Australia/Sydney".
  const current = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { owner: { select: { timezone: true } } },
  });
  if (!current) throw new Error("Workspace not found");
  if (current.status === "ready") {
    log.warn("Workspace already provisioned, skipping", { workspaceId });
    return;
  }

  log.info("Starting workspace provisioning", { workspaceId, templateKey });

  // Clean up any existing agents/skills/tasks/inbox from a previous
  // provisioning attempt or a re-used workspace ID. This prevents
  // duplicate agents when re-provisioning.
  const existingAgents = await prisma.agent.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  if (existingAgents.length > 0) {
    const agentIds = existingAgents.map((a) => a.id);
    await prisma.agentSkill.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.agent.deleteMany({ where: { workspaceId } });
    log.info("Cleaned up existing agents before re-provisioning", { workspaceId, count: agentIds.length });
  }
  await prisma.task.deleteMany({ where: { workspaceId } });

  // Set status to provisioning
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { status: "provisioning" },
  });

  try {
    // Resolve template config
    let config: WorkspaceTemplateConfig | null = null;

    if (templateKey) {
      const dbTemplate = await prisma.workspaceTemplate.findFirst({
        where: { key: templateKey },
      });
      if (dbTemplate) {
        config = JSON.parse(dbTemplate.configJson) as WorkspaceTemplateConfig;
      }
    }

    // When a template is resolved, prefer its agents (which include soul/agentConfig/identity).
    // Custom agents from the frontend Zod schema are stripped of these fields, so only use
    // them when no template is available.
    const agentsToCreate = config?.agents ?? customAgents ?? [];
    const skillKeysToUse = config?.skills ?? customSkillKeys ?? [];
    // Ensure the opcify skill exists in the DB (gateway-level, shared by all agents)
    await prisma.skill.upsert({
      where: { key: "opcify" },
      update: {},
      create: {
        key: "opcify",
        name: "Opcify Integration",
        description: "Report task status and results back to Opcify via API callbacks.",
        category: "integration",
      },
    });

    // Resolve skill records from keys
    const skills = skillKeysToUse.length > 0
      ? await prisma.skill.findMany({ where: { key: { in: skillKeysToUse } } })
      : [];
    const skillMap = new Map(skills.map((s) => [s.key, s]));

    // Create agents with skill assignments
    for (const agentDef of agentsToCreate) {
      const agent = await prisma.agent.create({
        data: {
          name: agentDef.name,
          role: agentDef.role,
          description: agentDef.description,
          model: opts.defaultModel || agentDef.model || "gpt-5.4",
          soul: agentDef.soul ?? null,
          agentConfig: agentDef.agentConfig ?? null,
          identity: agentDef.identity ?? null,
          user: agentDef.user ?? null,
          tools: agentDef.tools ?? null,
          heartbeat: agentDef.heartbeat ?? null,
          bootstrap: agentDef.bootstrap ?? null,
          workspaceId,
        },
      });

      // Sync agent directory to OpenClaw workspace on disk
      await syncAgentToWorkspace(workspaceId, {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        model: agent.model,
        soul: agent.soul,
        agentConfig: agent.agentConfig,
        identity: agent.identity,
        user: agentDef.user ?? null,
        tools: agentDef.tools ?? null,
        heartbeat: agentDef.heartbeat ?? null,
        bootstrap: agentDef.bootstrap ?? null,
        isSystem: agent.isSystem,
        status: agent.status,
      });

      // Install skills from template definition
      const agentSkillKeys = agentDef.skillKeys || [];
      for (const sk of agentSkillKeys) {
        const skill = skillMap.get(sk);
        if (skill) {
          await prisma.agentSkill.create({
            data: { agentId: agent.id, skillId: skill.id },
          });
        }
      }
    }

    // Mark as ready FIRST — Docker provisioning runs in background
    // so it can't block or hang the API response.
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: "ready",
        lastProvisionedAt: new Date(),
      },
    });
    log.info("Workspace provisioned successfully", { workspaceId, templateKey, agentCount: agentsToCreate.length });

    // Provision Docker containers in the background — this can take 90s+
    // (image pull, health check, browser-use install) and must not block
    // the API response or leave the workspace stuck in "provisioning".
    // Extract LLM provider API keys from workspace settings and inject
    // as container environment variables (OpenClaw plugins read these).
    const providerEnv: Record<string, string> = {};
    // Hoisted out of the try block so it can feed into dockerCfg below.
    // Stays undefined when the wizard skipped the memory step — in that
    // case buildOpenclawJson falls back to the text-biased local defaults.
    let memoryCfg: WorkspaceMemoryConfig | undefined;
    if (current.settingsJson) {
      try {
        const ai = JSON.parse(current.settingsJson) as WorkspaceAISettings;
        const rawMemory = (ai as Record<string, unknown>).memory;
        if (rawMemory && typeof rawMemory === "object") {
          // Trust the wizard shape here — the zod schema on /provision has
          // already validated the same object on its own path, and the
          // create/settings path can't hurt anything beyond a misconfigured
          // openclaw.json (which buildOpenclawJson tolerates).
          memoryCfg = rawMemory as WorkspaceMemoryConfig;
        }
        const envKeyMap: Record<string, string> = {
          openrouter: "OPENROUTER_API_KEY",
          openai: "OPENAI_API_KEY",
          anthropic: "ANTHROPIC_API_KEY",
          google: "GOOGLE_API_KEY",
          deepseek: "DEEPSEEK_API_KEY",
        };
        for (const p of ai.providers ?? []) {
          const envKey = envKeyMap[p.id];
          if (envKey && p.apiKey) providerEnv[envKey] = p.apiKey;
        }
        // Extract cloud storage env vars from settingsJson.cloudStorage
        // (configured in the wizard's Cloud Storage Setup step).
        const cs = (ai as Record<string, unknown>).cloudStorage as Record<string, string> | undefined;
        if (cs?.provider && cs.provider !== "none") {
          if (cs.provider === "gcs") {
            if (cs.gcsBucketName) providerEnv.GCS_BUCKET_NAME = cs.gcsBucketName;
            if (cs.gcsCredentialsJson) providerEnv.GCS_CREDENTIALS_JSON = cs.gcsCredentialsJson;
            if (cs.gcsPrefix) providerEnv.GCS_PREFIX = cs.gcsPrefix;
          } else if (cs.provider === "s3") {
            if (cs.s3BucketName) providerEnv.S3_BUCKET_NAME = cs.s3BucketName;
            if (cs.awsAccessKeyId) providerEnv.AWS_ACCESS_KEY_ID = cs.awsAccessKeyId;
            if (cs.awsSecretAccessKey) providerEnv.AWS_SECRET_ACCESS_KEY = cs.awsSecretAccessKey;
            if (cs.awsRegion) providerEnv.AWS_REGION = cs.awsRegion;
            if (cs.s3Prefix) providerEnv.S3_PREFIX = cs.s3Prefix;
          } else if (cs.provider === "r2") {
            if (cs.r2BucketName) providerEnv.R2_BUCKET_NAME = cs.r2BucketName;
            if (cs.r2AccountId) providerEnv.R2_ACCOUNT_ID = cs.r2AccountId;
            if (cs.r2AccessKeyId) providerEnv.R2_ACCESS_KEY_ID = cs.r2AccessKeyId;
            if (cs.r2SecretAccessKey) providerEnv.R2_SECRET_ACCESS_KEY = cs.r2SecretAccessKey;
            if (cs.r2Prefix) providerEnv.R2_PREFIX = cs.r2Prefix;
            if (cs.r2PublicDomain) providerEnv.R2_PUBLIC_DOMAIN = cs.r2PublicDomain;
          }
          log.info("Injecting cloud storage env vars", { workspaceId, provider: cs.provider });
        }
      } catch {
        log.warn("Could not parse settingsJson for provider env", { workspaceId });
      }
    }
    // Bridge the template's `skills` array into managedSkillKeys for any skill
    // that ships with Opcify (templates/skills/<slug>/_meta.json with a
    // `managed` block). These skills are copied onto the workspace volume by
    // writeWorkspaceToDisk and discovered by OpenClaw via the extraDirs config
    // — they do NOT need a ClawHub install.
    const templateManagedSkills = skillKeysToUse.filter((sk) => isManagedSkill(sk));
    const mergedManagedSkillKeys = Array.from(
      new Set([...(opts.managedSkillKeys ?? []), ...templateManagedSkills]),
    );
    // Bridge the template's remaining (non-managed) `skills` into clawHubSkillKeys
    // so buildOpenclawJson can pre-register them in skills.entries on the first
    // openclaw.json write. Without this, web-search and friends don't land in
    // agents.defaults.skills until installSkillBySlug runs much later — and that
    // late write is reverted by the gateway's anomaly detector.
    const templateClawHubSkills = skillKeysToUse.filter((sk) => !isManagedSkill(sk));
    const dockerCfg: WorkspaceUserConfig = {
      ...opts.dockerConfig,
      model: opts.defaultModel,
      timezone: current.owner?.timezone ?? opts.dockerConfig?.timezone,
      managedSkillKeys: mergedManagedSkillKeys,
      clawHubSkillKeys: templateClawHubSkills,
      env: { ...opts.dockerConfig?.env, ...providerEnv },
      // Memory config: prefer the value from /provision's dockerConfig
      // (already validated by zod on that path), fall back to what we
      // parsed out of settingsJson above. This lets both the settings-based
      // flow (wizard POST /workspaces with settingsJson) and the explicit
      // dockerConfig path feed the same buildOpenclawJson knob.
      memory: opts.dockerConfig?.memory ?? memoryCfg,
    };
    workspaceService.create(workspaceId, dockerCfg).then(
      async () => {
        log.info("Docker containers provisioned", { workspaceId });
        // Sync AI provider API keys AFTER Docker provisioning (which calls
        // writeWorkspaceToDisk and creates the agent directories on disk).
        const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
        if (ws?.settingsJson) {
          try {
            const aiSettings = JSON.parse(ws.settingsJson) as WorkspaceAISettings;
            const providers = (aiSettings.providers ?? [])
              .filter((p) => p.apiKey)
              .map((p) => ({ id: p.id, apiKey: p.apiKey }));
            await syncAuthProfilesToWorkspace(workspaceId, providers);
          } catch {
            log.warn("Could not sync AI provider keys to agents", { workspaceId });
          }
        }
        // Install OpenClaw skills from the template config (requires running gateway).
        // Skip Opcify-managed skills — those are local skills already copied to
        // disk by writeWorkspaceToDisk and auto-discovered via openclaw.json extraDirs;
        // they would 404 against ClawHub if we tried to install them here.
        const clawHubSkills = skillKeysToUse.filter((sk) => !isManagedSkill(sk));
        if (clawHubSkills.length > 0) {
          for (const sk of clawHubSkills) {
            try {
              await installSkillBySlug(workspaceId, sk);
            } catch {
              log.warn(`Could not install skill "${sk}" via OpenClaw`, { workspaceId });
            }
          }
          invalidateCapabilitiesCache(workspaceId);
          log.info("Installed template skills via OpenClaw", { workspaceId, count: clawHubSkills.length });
        }
      },
      (dockerErr: unknown) => {
        const msg = dockerErr instanceof Error ? dockerErr.message : String(dockerErr);
        log.error(`Docker provisioning failed: ${msg}`, { workspaceId });
        // Containers can be created later via POST /docker-workspaces/:id/ensure
      },
    );
  } catch (error) {
    // Mark as failed
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: "failed" },
    });
    log.error("Workspace provisioning failed", { workspaceId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

