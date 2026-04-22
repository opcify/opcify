# TOOLS.md

## Opcify Skill

### Task Management
- `PATCH /workspaces/${OPCIFY_WORKSPACE_ID}/tasks/:id/status` — Update task status
- `POST /workspaces/${OPCIFY_WORKSPACE_ID}/tasks` — Create new tasks (sessions, follow-ups, payments)
- `GET /workspaces/${OPCIFY_WORKSPACE_ID}/tasks?status=queued` — Check pending tasks

### Client Management (Students & Parents)
- `GET /workspaces/<id>/clients` — List clients
- `POST /workspaces/<id>/clients` — Create client
- `PATCH /workspaces/${OPCIFY_WORKSPACE_ID}/clients/:id` — Update client
- `GET /workspaces/${OPCIFY_WORKSPACE_ID}/clients/:id` — Get client details with recent tasks

### Inbox
- `GET /workspaces/<id>/inbox` — List inbox items
- `PATCH /workspaces/${OPCIFY_WORKSPACE_ID}/inbox/:id` — Update inbox item status

### Recurring Tasks (Session Schedules)
- `POST /workspaces/${OPCIFY_WORKSPACE_ID}/recurring` — Create recurring rule
- `GET /workspaces/${OPCIFY_WORKSPACE_ID}/recurring` — List recurring rules

### Dashboard
- `GET /dashboard/summary?workspaceId=<id>` — Workspace overview

## Summarize Skill

Use summarize to condense information before responding to the tutor.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
