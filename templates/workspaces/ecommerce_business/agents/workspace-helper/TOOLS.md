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

## Marketplace API Token Environment Variables

These can be set via the openclaw config to enable marketplace integrations:

- `SHOPIFY_API_KEY` — Shopify Admin API
- `SHOPIFY_STOREFRONT_TOKEN` — Shopify Storefront API
- `AMAZON_SP_API_KEY` — Amazon Selling Partner API
- `EBAY_API_KEY` — eBay API
- `ETSY_API_KEY` — Etsy Open API
- `GOOGLE_MERCHANT_ID` — Google Merchant Center
- `TIKTOK_SHOP_API_KEY` — TikTok Shop API

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
