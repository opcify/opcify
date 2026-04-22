# Testing the Orchestrated Workflow with Real OpenClaw

This guide covers how to set up and test the full Opcify-to-OpenClaw task dispatch pipeline using the `orchestrated_ops` workspace template.

## Prerequisites

- Opcify API running (`pnpm dev:api` on port 4210)
- Redis running (`docker compose up -d redis` or local Redis on 6379)
- OpenClaw gateway container running per workspace
- Database seeded with skills (`pnpm db:seed`)

## 1. Create the Workspace

Create a workspace from the `orchestrated_ops` template via the Opcify UI or API:

```bash
curl -s -X POST http://localhost:4210/workspaces \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Orchestrated Test",
    "templateId": "orchestrated_ops"
  }'
```

This creates:
- **4 agents**: Orchestrator, Researcher, Executor, Reviewer
- **Each agent** gets all 7 bootstrap files (SOUL.md, AGENTS.md, IDENTITY.md, USER.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md)
- **Skills installed**: opcify, web-search, summarize, file-ops, code-exec
- **3 demo tasks** and **3 inbox items**

## 2. Install the Opcify Skill on OpenClaw

The `opcify` skill teaches OpenClaw agents how to report task status back to Opcify. It must be installed on the OpenClaw runtime.

### Method A: Via OpenClaw CLI (inside container)

```bash
# Get your workspace ID
WS_ID="your-workspace-id"

# Install the opcify skill via the OpenClaw CLI
docker exec openclaw-gateway-${WS_ID} openclaw skills install opcify
```

If the skill is not yet published to ClawHub, use local installation:

### Method B: Local file copy

```bash
WS_ID="your-workspace-id"
CONTAINER="openclaw-gateway-${WS_ID}"

# Create the skill directory inside the container
docker exec ${CONTAINER} mkdir -p /home/node/.openclaw/skills/opcify

# Copy the SKILL.md into the container
docker cp workspace/skills/opcify/SKILL.md \
  ${CONTAINER}:/home/node/.openclaw/skills/opcify/SKILL.md
```

### Method C: Via Opcify API

```bash
# Install skill on the workspace's OpenClaw container
curl -s -X POST "http://localhost:4210/workspaces/${WS_ID}/openclaw/skills/install" \
  -H "Content-Type: application/json" \
  -d '{"slug": "opcify"}'
```

### Configure Skill Environment Variables

The opcify skill needs to know where the Opcify API is:

```bash
# Via Opcify API
curl -s -X PATCH "http://localhost:4210/workspaces/${WS_ID}/openclaw/skills/opcify/config" \
  -H "Content-Type: application/json" \
  -d '{
    "env": {
      "OPCIFY_API_URL": "http://host.docker.internal:4210"
    }
  }'
```

Or edit `openclaw.json` directly:

```json
{
  "skills": {
    "entries": {
      "opcify": {
        "enabled": true,
        "env": {
          "OPCIFY_API_URL": "http://host.docker.internal:4210"
        }
      }
    }
  }
}
```

> **Note:** Use `host.docker.internal:4210` on Mac/Windows. On Linux, use the Docker bridge IP (typically `172.17.0.1:4210`).

## 3. Configure Environment Variables

### Opcify API (.env)

```env
REDIS_URL=redis://localhost:6379
OPENCLAW_BASE_URL=http://localhost:19010     # Port allocated to your workspace gateway
OPENCLAW_AUTH_TOKEN=your-gateway-token       # From openclaw.json gateway.auth.token
OPCIFY_CALLBACK_URL=http://127.0.0.1:4210   # Must be reachable FROM the OpenClaw container
OPCIFY_CALLBACK_TOKEN=dev-secret-token       # Optional auth for callbacks
```

To find your workspace gateway port and token:

```bash
# Check the workspace metadata
cat ~/.opcify/workspaces/${WS_ID}/opcify-meta.json | jq '.port'

# Check the gateway auth token
cat ~/.opcify/workspaces/${WS_ID}/openclaw.json | jq '.gateway.auth.token'
```

## 4. Verify Agent Setup

```bash
# List agents in the workspace (workspace-scoped routes require an auth bearer)
curl -s -H "Authorization: Bearer ${JWT}" \
  "http://localhost:4210/workspaces/${WS_ID}/agents" | jq '.[].name'
# Expected: "Orchestrator", "Researcher", "Executor", "Reviewer"

# Check skills installed on the Orchestrator
ORCH_ID=$(curl -s -H "Authorization: Bearer ${JWT}" \
  "http://localhost:4210/workspaces/${WS_ID}/agents" | jq -r '.[0].id')
curl -s -H "Authorization: Bearer ${JWT}" \
  "http://localhost:4210/agents/${ORCH_ID}/skills" | jq '.[].skill.key'
# Expected: "opcify", "summarize"

# Verify agent files on disk
ls ~/.opcify/workspaces/${WS_ID}/agents/${ORCH_ID}/agent/
# Expected: SOUL.md AGENTS.md IDENTITY.md USER.md TOOLS.md HEARTBEAT.md BOOTSTRAP.md
```

## 5. Test the Workflow

### Create a task

```bash
curl -s -X POST "http://localhost:4210/workspaces/${WS_ID}/tasks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT}" \
  -d "{
    \"title\": \"Research and summarize AI agent frameworks\",
    \"description\": \"Find the top 5 AI agent frameworks, compare their features, and produce a summary table.\",
    \"agentId\": \"${ORCH_ID}\",
    \"priority\": \"high\"
  }" | jq '{id, status, workspaceId}'
```

### Monitor SSE events (in a separate terminal)

```bash
curl -s -N "http://localhost:4210/events/tasks?workspaceId=${WS_ID}"
```

### Expected flow

1. **Task created** (status: `queued`) -> SSE: `task:created`
2. **BullMQ dispatches** -> Opcify POSTs to OpenClaw `/execute` with callbackUrl
3. **Orchestrator receives** -> acknowledges (`running`) -> decomposes into steps
4. **Step 1: Research** -> SSE: `step:updated {agentName: "Researcher", status: "running"}`
5. **Step 2: Execute** -> SSE: `step:updated {agentName: "Executor", status: "running"}`
6. **Step 3: Review** -> SSE: `step:updated {agentName: "Reviewer", status: "running"}`
7. **All done** -> SSE: `task:updated {status: "done", currentAgentName: null}`

### Verify final state

```bash
TASK_ID="your-task-id"
curl -s "http://localhost:4210/workspaces/${WS_ID}/tasks/${TASK_ID}" \
  -H "Authorization: Bearer ${JWT}" | jq '{
  status, progress, reviewStatus,
  executionSteps: [.executionSteps[] | {stepOrder, agentName, status, outputSummary}]
}'
```

## 6. Troubleshooting

### Task stuck in `queued`
- Check Redis is running: `redis-cli ping`
- Check BullMQ logs in API output
- Verify `OPENCLAW_BASE_URL` is correct and gateway is healthy

### Callback not received
- Check `OPCIFY_CALLBACK_URL` is reachable from inside the container
- Test connectivity: `docker exec openclaw-gateway-${WS_ID} curl -s http://host.docker.internal:4210/health`
- Check `OPCIFY_CALLBACK_TOKEN` matches if set

### Agent doesn't have opcify skill
- Verify skill is in the database: `curl -s http://localhost:4210/skills | jq '.[] | select(.key=="opcify")'`
- Re-run seed if missing: `pnpm db:seed`
- Check skill installation on OpenClaw: `docker exec openclaw-gateway-${WS_ID} openclaw skills list --json`
