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

- `GOOGLE_BUSINESS_API_KEY` — Google Business Profile API
- `GOOGLE_CALENDAR_API_KEY` — Google Calendar API
- `ZOOM_API_KEY` — Zoom API (for online sessions)
- `STRIPE_API_KEY` — Stripe payment processing
- `SQUARE_API_KEY` — Square payment processing

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
