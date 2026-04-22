# TOOLS.md

## Opcify Skill — Agent Management

### List agents
```
GET /agents?workspaceId=<id>
Returns: [ { id, name, role, model, status, ... }, ... ]
```

### Get agent details
```
GET /agents/:id
Returns: { id, name, role, description, model, soul, agentConfig, identity, ... }
```

### Update agent
```
PATCH /agents/:id
Body: { name, role, description, model, soul, agentConfig, identity, user, tools, heartbeat, bootstrap }
```

### Create agent
```
POST /agents?workspaceId=<id>
Body: { name, role, description, model, ... }
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

These can be set via the openclaw config to enable tool integrations:

- `GOOGLE_BUSINESS_API_KEY` — Google Business Profile API
- `XERO_API_KEY` — Xero accounting API
- `MYOB_API_KEY` — MYOB accounting API
- `SERVICEM8_API_KEY` — ServiceM8 job management
- `HIPAGES_API_KEY` — Hipages lead management

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
