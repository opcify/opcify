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

## Property Portal API Token Environment Variables

These can be set via the openclaw config to enable portal integrations:

- `REA_API_KEY` — REA Group API (realestate.com.au)
- `DOMAIN_API_KEY` — Domain API (domain.com.au)

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
