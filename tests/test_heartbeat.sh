#!/usr/bin/env bash
# test_heartbeat.sh — Heartbeat Fallback Test
# Tests that the heartbeat mechanism can discover and pick up queued tasks.
# Reads OPENCLAW_MOCK_MODE at runtime to switch between LIVE and MOCK behavior.

set -euo pipefail

MOCK_MODE="${OPENCLAW_MOCK_MODE:-false}"
OPCIFY_API_URL="${OPCIFY_API_URL:-http://127.0.0.1:4210}"
OPCIFY_API_KEY="${OPCIFY_API_KEY:-}"
OPCIFY_WORKSPACE_ID="${OPCIFY_WORKSPACE_ID:-}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-${OPENCLAW_GATEWAY_TOKEN:-}}"
HEARTBEAT_MD="${HEARTBEAT_MD:-${HOME}/.openclaw/workspace/HEARTBEAT.md}"
TEST_PASSED=true
TASK_ID=""

prefix() {
  if [ "$MOCK_MODE" = "true" ]; then echo "[MOCK]"; else echo "[LIVE]"; fi
}

log() { echo "$(prefix) $*"; }
pass() { echo "  ✅ $*"; }
fail() { echo "  ❌ $*"; TEST_PASSED=false; }

cleanup() {
  if [ -n "$TASK_ID" ] && [ "$MOCK_MODE" != "true" ]; then
    log "Cleanup: marking test task as failed"
    curl -s -X PATCH "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
      -H "Content-Type: application/json" \
      ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
      -d '{"status": "failed"}' >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "═══════════════════════════════════════════"
echo " Heartbeat Fallback Test"
echo " Mode: $(if [ "$MOCK_MODE" = "true" ]; then echo "MOCK"; else echo "LIVE"; fi)"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: Verify HEARTBEAT.md contains Opcify polling ────────
log "Step 1: Checking HEARTBEAT.md configuration..."

if [ -f "$HEARTBEAT_MD" ]; then
  HAS_OPCIFY=$(grep -c "status=queued\|Opcify" "$HEARTBEAT_MD" 2>/dev/null || echo "0")
  if [ "$HAS_OPCIFY" -gt 0 ]; then
    pass "HEARTBEAT.md contains Opcify polling instruction"
  else
    fail "HEARTBEAT.md exists but does not mention Opcify or status=queued"
  fi
else
  fail "HEARTBEAT.md not found at ${HEARTBEAT_MD}"
fi

echo ""

# ── Step 2: Insert a pending test task ──────────────────────────
log "Step 2: Creating a queued test task..."

if [ "$MOCK_MODE" = "true" ]; then
  TASK_ID="mock-heartbeat-$(date +%s)"
  log "Simulated task created: ${TASK_ID} (status: queued)"
  pass "Test task created (simulated)"
else
  AGENT_ID=$(curl -s "${OPCIFY_API_URL}/agents" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    | python3 -c "import sys,json; agents=json.load(sys.stdin); print(agents[0]['id'] if agents else '')" 2>/dev/null || echo "")

  if [ -z "$AGENT_ID" ]; then
    fail "No agents found in Opcify"
    echo ""
    echo "───────────────────────────────────────────"
    echo "Result: FAIL"
    exit 1
  fi

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks" \
    -H "Content-Type: application/json" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    -d "{\"title\":\"[TEST] Heartbeat Pickup Test\",\"description\":\"This task should be discovered by heartbeat polling\",\"agentId\":\"${AGENT_ID}\",\"priority\":\"low\"}" 2>/dev/null)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "201" ]; then
    TASK_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    pass "Test task created: ${TASK_ID}"
  else
    fail "Task creation failed: HTTP ${HTTP_CODE}"
  fi
fi

echo ""

# ── Step 3: Trigger heartbeat ───────────────────────────────────
log "Step 3: Triggering heartbeat..."

HEARTBEAT_PROMPT="Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK."

if [ "$MOCK_MODE" = "true" ]; then
  log "Would execute: openclaw agent --agent main --message \"<heartbeat prompt>\" --json"
  log "Simulated heartbeat: agent reads HEARTBEAT.md, polls ${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks?status=queued"
  log "Simulated: agent finds task ${TASK_ID}, sets status to running"
  pass "Heartbeat triggered and task pickup simulated"
else
  AGENT_ARGS=(agent --agent main --message "$HEARTBEAT_PROMPT" --json --timeout 60)
  if [ -n "$GATEWAY_TOKEN" ]; then
    AGENT_ARGS+=(--token "$GATEWAY_TOKEN")
  fi

  log "Running: openclaw agent --agent main --message <heartbeat> --json"
  RESPONSE=$(openclaw "${AGENT_ARGS[@]}" 2>/dev/null) || {
    fail "Heartbeat agent command failed"
    RESPONSE=""
  }

  if [ -n "$RESPONSE" ]; then
    STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
    if [ "$STATUS" = "ok" ]; then
      pass "Heartbeat agent returned status: ok"
    else
      fail "Heartbeat agent returned status: ${STATUS}"
    fi
  fi
fi

echo ""

# ── Step 4: Poll for task pickup ────────────────────────────────
log "Step 4: Polling for task pickup..."

if [ "$MOCK_MODE" = "true" ]; then
  log "Simulated poll: task ${TASK_ID} status → running (after 3s)"
  pass "Task picked up by heartbeat (simulated)"
else
  if [ -z "$TASK_ID" ]; then
    fail "No task ID — skipping poll"
  else
    POLL_INTERVAL=5
    POLL_MAX=60
    POLL_ELAPSED=0
    PICKED_UP=false

    while [ "$POLL_ELAPSED" -lt "$POLL_MAX" ]; do
      CURRENT_STATUS=$(curl -s "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}" \
        ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")

      if [ "$CURRENT_STATUS" != "queued" ]; then
        PICKED_UP=true
        break
      fi

      sleep "$POLL_INTERVAL"
      POLL_ELAPSED=$((POLL_ELAPSED + POLL_INTERVAL))
      log "  Polling... ${POLL_ELAPSED}s elapsed (status: ${CURRENT_STATUS})"
    done

    if [ "$PICKED_UP" = true ]; then
      pass "Task picked up — status changed to '${CURRENT_STATUS}' after ${POLL_ELAPSED}s"
    else
      fail "Task still 'queued' after ${POLL_MAX}s — heartbeat did not pick it up"
    fi
  fi
fi

echo ""

# ── Cleanup ─────────────────────────────────────────────────────
log "Step 5: Cleanup..."

if [ "$MOCK_MODE" != "true" ] && [ -n "$TASK_ID" ]; then
  curl -s -X PATCH "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
    -H "Content-Type: application/json" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    -d '{"status": "failed"}' >/dev/null 2>&1
  TASK_ID=""
  pass "Cleanup done"
else
  pass "Cleanup done (simulated)"
fi

echo ""

# ── Result ──────────────────────────────────────────────────────
echo "───────────────────────────────────────────"
if [ "$TEST_PASSED" = true ]; then
  echo "Result: PASS"
  exit 0
else
  echo "Result: FAIL"
  exit 1
fi
