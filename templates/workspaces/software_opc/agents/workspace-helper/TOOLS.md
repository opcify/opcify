# TOOLS.md

## Opcify Skill — Agent Management

### List agents
```
GET /agents?workspaceId=<id>
```

### Get agent details
```
GET /agents/:id
```

### Update agent
```
PATCH /agents/:id
Body: { name, role, description, model, soul, agentConfig, identity, user, tools, heartbeat, bootstrap }
```

### Create agent
```
POST /agents?workspaceId=<id>
```

## Opcify Skill — Skill Management

### List skills
```
GET /skills?workspaceId=<id>
```

### Install skill
```
POST /skills/install
Body: { workspaceId, slug }
```

## Opcify Skill — OpenClaw Config

### Get config
```
GET /openclaw-config?workspaceId=<id>
```

### Update config
```
PATCH /openclaw-config?workspaceId=<id>
Body: { ...partial config to merge }
```

## Integration API Token Environment Variables

- `GITHUB_TOKEN` — GitHub API (repo access, PRs)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — AWS
- `VERCEL_TOKEN` — Vercel deployment
- `FLY_API_TOKEN` — Fly.io deployment
- `SENTRY_DSN` — Sentry error tracking
- `SLACK_WEBHOOK_URL` — Slack notifications

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
