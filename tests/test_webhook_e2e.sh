#!/usr/bin/env bash
# test_webhook_e2e.sh — Webhook End-to-End Test
# Tests the full flow: create task in Opcify → webhook to OpenClaw → status update.
# Reads OPENCLAW_MOCK_MODE at runtime to switch between LIVE and MOCK behavior.

set -euo pipefail

MOCK_MODE="${OPENCLAW_MOCK_MODE:-false}"
OPCIFY_API_URL="${OPCIFY_API_URL:-http://127.0.0.1:4210}"
OPCIFY_API_KEY="${OPCIFY_API_KEY:-}"
OPCIFY_WORKSPACE_ID="${OPCIFY_WORKSPACE_ID:-}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-${OPENCLAW_GATEWAY_TOKEN:-}}"
TEST_PASSED=true
TASK_ID=""

prefix() {
  if [ "$MOCK_MODE" = "true" ]; then echo "[MOCK]"; else echo "[LIVE]"; fi
}

log() { echo "$(prefix) $*"; }
pass() { echo "  ✅ $*"; }
fail() { echo "  ❌ $*"; TEST_PASSED=false; }
elapsed() { echo "  ⏱  ${1}ms"; }

auth_header() {
  if [ -n "$OPCIFY_API_KEY" ]; then
    echo "-H Authorization: Bearer ${OPCIFY_API_KEY}"
  fi
}

cleanup() {
  if [ -n "$TASK_ID" ] && [ "$MOCK_MODE" != "true" ]; then
    log "Cleanup: deleting test task ${TASK_ID}"
    curl -s -X PATCH "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
      -H "Content-Type: application/json" \
      ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
      -d '{"status": "failed"}' >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "═══════════════════════════════════════════"
echo " Webhook End-to-End Test"
echo " Mode: $(if [ "$MOCK_MODE" = "true" ]; then echo "MOCK"; else echo "LIVE"; fi)"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: Create a test task in Opcify ────────────────────────
log "Step 1: Creating test task in Opcify..."
START_MS=$(($(date +%s) * 1000 + $(date +%N 2>/dev/null | cut -c1-3 || echo 0)))

if [ "$MOCK_MODE" = "true" ]; then
  TASK_ID="mock-test-$(date +%s)"
  PAYLOAD='{"title":"[TEST] Webhook E2E Test","description":"Automated test task for webhook validation","agentId":"agent-1","priority":"low"}'
  log "Simulating POST ${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks"
  log "Payload: ${PAYLOAD}"
  log "Simulated response: { \"id\": \"${TASK_ID}\", \"status\": \"queued\" }"

  # Validate payload structure
  HAS_TITLE=$(echo "$PAYLOAD" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('title','').startswith('[TEST]') else 'no')" 2>/dev/null)
  HAS_AGENT=$(echo "$PAYLOAD" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('agentId') else 'no')" 2>/dev/null)

  if [ "$HAS_TITLE" = "yes" ] && [ "$HAS_AGENT" = "yes" ]; then
    pass "Task creation payload is correctly formed"
  else
    fail "Task creation payload missing required fields"
  fi
else
  # Find a valid agentId first
  AGENT_ID=$(curl -s "${OPCIFY_API_URL}/agents" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    | python3 -c "import sys,json; agents=json.load(sys.stdin); print(agents[0]['id'] if agents else '')" 2>/dev/null || echo "")

  if [ -z "$AGENT_ID" ]; then
    fail "No agents found in Opcify — cannot create task"
    echo ""
    echo "───────────────────────────────────────────"
    echo "Result: FAIL"
    exit 1
  fi

  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks" \
    -H "Content-Type: application/json" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    -d "{\"title\":\"[TEST] Webhook E2E Test\",\"description\":\"Automated test task for webhook validation\",\"agentId\":\"${AGENT_ID}\",\"priority\":\"low\"}" 2>/dev/null)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "201" ]; then
    TASK_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    pass "Task created: ${TASK_ID} (HTTP ${HTTP_CODE})"
  else
    fail "Task creation failed: HTTP ${HTTP_CODE}"
  fi
fi

END_MS=$(($(date +%s) * 1000 + $(date +%N 2>/dev/null | cut -c1-3 || echo 0)))
elapsed "$((END_MS - START_MS))"
echo ""

# ── Step 2: Verify webhook was fired (check task picked up) ────
log "Step 2: Polling for task status change (queued → running)..."

if [ "$MOCK_MODE" = "true" ]; then
  log "Simulating webhook dispatch to OpenClaw Gateway"
  log "Simulating 2-second delay for agent processing..."
  sleep 2
  log "Simulated status poll: { \"status\": \"running\" }"
  pass "Task status changed to running (simulated, 2s)"
else
  if [ -z "$TASK_ID" ]; then
    fail "No task ID — skipping poll"
  else
    POLL_INTERVAL=3
    POLL_MAX=30
    POLL_ELAPSED=0
    FOUND_RUNNING=false

    while [ "$POLL_ELAPSED" -lt "$POLL_MAX" ]; do
      STATUS=$(curl -s "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}" \
        ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")

      if [ "$STATUS" = "running" ] || [ "$STATUS" = "done" ] || [ "$STATUS" = "waiting" ]; then
        FOUND_RUNNING=true
        break
      fi

      sleep "$POLL_INTERVAL"
      POLL_ELAPSED=$((POLL_ELAPSED + POLL_INTERVAL))
      log "  Polling... ${POLL_ELAPSED}s elapsed (status: ${STATUS})"
    done

    if [ "$FOUND_RUNNING" = true ]; then
      pass "Task status changed to '${STATUS}' after ${POLL_ELAPSED}s"
    else
      fail "Task status still '${STATUS}' after ${POLL_MAX}s — webhook may not have fired"
    fi
  fi
fi

echo ""

# ── Step 3: Cleanup ─────────────────────────────────────────────
log "Step 3: Cleaning up test task..."

if [ "$MOCK_MODE" = "true" ]; then
  log "Simulating cleanup of task ${TASK_ID}"
  pass "Test task cleaned up (simulated)"
else
  if [ -n "$TASK_ID" ]; then
    curl -s -X PATCH "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
      -H "Content-Type: application/json" \
      ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
      -d '{"status": "failed"}' >/dev/null 2>&1
    TASK_ID=""  # Prevent double-cleanup in trap
    pass "Test task marked as failed (cleanup)"
  fi
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
