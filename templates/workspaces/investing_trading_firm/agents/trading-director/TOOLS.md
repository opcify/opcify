# TOOLS.md

Use the Opcify skill to report task progress.
Always use callbackUrl and callbackToken from the execute command.
Use summarize skill to condense outputs from other agents.

## Check Task Status Before Each Step

Before every `sessions_spawn()`, check if the trader has stopped the task:

```bash
TASK_STATUS=$(curl -s "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}" \
  ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} | grep -o '"status":"[^"]*"' | head -1)
```

If the status is `"stopped"`, do NOT spawn the next agent.

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
