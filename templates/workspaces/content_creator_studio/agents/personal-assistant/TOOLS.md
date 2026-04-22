# TOOLS.md

## Opcify Skill

Use the Opcify skill for all workspace operations:

### Task Management
- `PATCH /workspaces/${OPCIFY_WORKSPACE_ID}/tasks/:id/status` — Update task status (running, done, failed, waiting)
- `POST /workspaces/${OPCIFY_WORKSPACE_ID}/tasks` — Create new tasks
- `GET /workspaces/${OPCIFY_WORKSPACE_ID}/tasks?status=queued` — Check pending tasks

### Client Management (Brand Deals / Sponsors)
- `GET /workspaces/<id>/clients` — List clients (supports search via `q` param)
- `POST /workspaces/<id>/clients` — Create client (name required)
- `PATCH /workspaces/${OPCIFY_WORKSPACE_ID}/clients/:id` — Update client
- `GET /workspaces/${OPCIFY_WORKSPACE_ID}/clients/:id` — Get client details with recent tasks

### Inbox
- `GET /workspaces/<id>/inbox` — List inbox items
- `PATCH /workspaces/${OPCIFY_WORKSPACE_ID}/inbox/:id` — Update inbox item status

### Recurring Tasks (Publishing Schedules)
- `POST /workspaces/${OPCIFY_WORKSPACE_ID}/recurring` — Create recurring rule
- `GET /workspaces/${OPCIFY_WORKSPACE_ID}/recurring` — List recurring rules

### Dashboard
- `GET /dashboard/summary?workspaceId=<id>` — Workspace overview (agent/task counts)

## Summarize Skill

Use summarize to condense information before responding to the creator.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
