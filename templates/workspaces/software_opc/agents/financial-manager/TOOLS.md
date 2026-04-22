# TOOLS.md

## Opcify Skill — Ledger API

### List ledger entries
```
GET /workspaces/<id>/ledger
Optional: type, clientId, category, q, sort, dateFrom, dateTo
```

### Get financial summary
```
GET /workspaces/<id>/ledger/summary
Optional: dateFrom, dateTo
Returns: { totalIncome, totalExpense, net }
```

### Create ledger entry
```
POST /workspaces/<id>/ledger
Body: { type, amount, currency, clientId, taskId, category, description, attachmentType, attachmentUrl, notes, entryDate }
```

### Update ledger entry
```
PATCH /workspaces/${OPCIFY_WORKSPACE_ID}/ledger/:id
```

### Delete ledger entry
```
DELETE /workspaces/${OPCIFY_WORKSPACE_ID}/ledger/:id
```

## Opcify Skill — Client API (for project cross-referencing)

### List clients
```
GET /workspaces/<id>/clients
```

### Get client details
```
GET /workspaces/${OPCIFY_WORKSPACE_ID}/clients/:id
```

Always use the browser-use CLI skill for ANY browser task — screenshots, web navigation, data extraction, form filling, etc. Do NOT use the built-in browser tool.
