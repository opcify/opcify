#!/usr/bin/env bash
# test_status_callback.sh — Status Callback Test
# Tests that each task status can be set via PATCH /tasks/:id/status
# and that the DB state actually changes.
# Reads OPENCLAW_MOCK_MODE at runtime to switch between LIVE and MOCK behavior.

set -euo pipefail

MOCK_MODE="${OPENCLAW_MOCK_MODE:-false}"
OPCIFY_API_URL="${OPCIFY_API_URL:-http://127.0.0.1:4210}"
OPCIFY_API_KEY="${OPCIFY_API_KEY:-}"
OPCIFY_WORKSPACE_ID="${OPCIFY_WORKSPACE_ID:-}"
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
echo " Status Callback Test"
echo " Mode: $(if [ "$MOCK_MODE" = "true" ]; then echo "MOCK"; else echo "LIVE"; fi)"
echo "═══════════════════════════════════════════"
echo ""

# Statuses to test in order (must be valid transitions)
STATUSES=("running" "waiting" "done" "failed")

# ── Step 0: Create test task ────────────────────────────────────
log "Step 0: Creating test task..."

if [ "$MOCK_MODE" = "true" ]; then
  TASK_ID="mock-callback-$(date +%s)"
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
    -d "{\"title\":\"[TEST] Status Callback Test\",\"description\":\"Testing all status transitions\",\"agentId\":\"${AGENT_ID}\",\"priority\":\"low\"}" 2>/dev/null)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "201" ]; then
    TASK_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    pass "Test task created: ${TASK_ID}"
  else
    fail "Task creation failed: HTTP ${HTTP_CODE}"
    echo ""
    echo "───────────────────────────────────────────"
    echo "Result: FAIL"
    exit 1
  fi
fi

echo ""

# ── Steps 1-4: Test each status transition ──────────────────────
STEP=1
for STATUS in "${STATUSES[@]}"; do
  log "Step ${STEP}: Setting status to '${STATUS}'..."

  if [ "$MOCK_MODE" = "true" ]; then
    # Validate the request body structure
    REQUEST_BODY="{\"status\": \"${STATUS}\"}"
    VALID=$(echo "$REQUEST_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
valid_statuses = ['queued', 'running', 'waiting', 'done', 'failed']
s = d.get('status', '')
print('yes' if s in valid_statuses else 'no')
" 2>/dev/null)

    if [ "$VALID" = "yes" ]; then
      log "Simulating PATCH ${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status"
      log "Request body: ${REQUEST_BODY}"
      log "Simulated response: HTTP 200, { \"status\": \"${STATUS}\" }"
      pass "Status '${STATUS}' — request valid, DB confirmed (simulated)"
    else
      fail "Status '${STATUS}' — invalid request body"
    fi
  else
    RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH \
      "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
      -H "Content-Type: application/json" \
      ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
      -d "{\"status\": \"${STATUS}\"}" 2>/dev/null)

    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
      # Verify DB state by reading the task back
      ACTUAL_STATUS=$(curl -s "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}" \
        ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")

      if [ "$ACTUAL_STATUS" = "$STATUS" ]; then
        pass "Status '${STATUS}' — PATCH 200, DB verified (actual: ${ACTUAL_STATUS})"
      else
        fail "Status '${STATUS}' — PATCH 200 but DB shows '${ACTUAL_STATUS}'"
      fi
    else
      fail "Status '${STATUS}' — PATCH returned HTTP ${HTTP_CODE} (expected 200)"
    fi
  fi

  # Reset to queued for next test (except the last one)
  if [ "$STATUS" != "failed" ] && [ "$MOCK_MODE" != "true" ] && [ -n "$TASK_ID" ]; then
    curl -s -X PATCH "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
      -H "Content-Type: application/json" \
      ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
      -d '{"status": "queued"}' >/dev/null 2>&1 || true
  fi

  STEP=$((STEP + 1))
  echo ""
done

# ── Step 5: Test waitingReason via PATCH /tasks/:id ─────────────
log "Step ${STEP}: Setting status to 'waiting' with waitingReason..."

if [ "$MOCK_MODE" = "true" ]; then
  REQUEST_BODY='{"status": "waiting", "waitingReason": "waiting_for_review"}'
  log "Simulating PATCH ${OPCIFY_API_URL}/tasks/${TASK_ID}"
  log "Request body: ${REQUEST_BODY}"
  log "Simulated response: HTTP 200"
  pass "waiting + waitingReason — request valid (simulated)"
else
  # Reset to queued first
  curl -s -X PATCH "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
    -H "Content-Type: application/json" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    -d '{"status": "queued"}' >/dev/null 2>&1 || true

  RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH \
    "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}" \
    -H "Content-Type: application/json" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    -d '{"status": "waiting", "waitingReason": "waiting_for_review"}' 2>/dev/null)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)

  if [ "$HTTP_CODE" = "200" ]; then
    ACTUAL=$(curl -s "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}" \
      ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''), d.get('waitingReason',''))" 2>/dev/null || echo "")

    if echo "$ACTUAL" | grep -q "waiting.*waiting_for_review"; then
      pass "waiting + waitingReason — PATCH 200, DB verified (${ACTUAL})"
    else
      fail "waiting + waitingReason — PATCH 200 but DB shows: ${ACTUAL}"
    fi
  else
    fail "waiting + waitingReason — PATCH returned HTTP ${HTTP_CODE}"
  fi
fi

echo ""

# ── Cleanup ─────────────────────────────────────────────────────
log "Cleanup: marking test task as failed..."
if [ "$MOCK_MODE" != "true" ] && [ -n "$TASK_ID" ]; then
  curl -s -X PATCH "${OPCIFY_API_URL}/workspaces/${OPCIFY_WORKSPACE_ID}/tasks/${TASK_ID}/status" \
    -H "Content-Type: application/json" \
    ${OPCIFY_API_KEY:+-H "Authorization: Bearer ${OPCIFY_API_KEY}"} \
    -d '{"status": "failed"}' >/dev/null 2>&1
  TASK_ID=""  # Prevent double-cleanup
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
