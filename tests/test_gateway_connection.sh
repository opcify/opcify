#!/usr/bin/env bash
# test_gateway_connection.sh — Gateway Connectivity Test
# Tests that the OpenClaw Gateway is reachable and responds to agent messages.
# Reads OPENCLAW_MOCK_MODE at runtime to switch between LIVE and MOCK behavior.

set -euo pipefail

MOCK_MODE="${OPENCLAW_MOCK_MODE:-false}"
GATEWAY_TOKEN="${GATEWAY_TOKEN:-${OPENCLAW_GATEWAY_TOKEN:-}}"
GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
GATEWAY_URL="http://${GATEWAY_HOST}:${GATEWAY_PORT}"
TEST_PASSED=true

prefix() {
  if [ "$MOCK_MODE" = "true" ]; then echo "[MOCK]"; else echo "[LIVE]"; fi
}

log() { echo "$(prefix) $*"; }
pass() { echo "  ✅ $*"; }
fail() { echo "  ❌ $*"; TEST_PASSED=false; }

echo "═══════════════════════════════════════════"
echo " Gateway Connectivity Test"
echo " Mode: $(if [ "$MOCK_MODE" = "true" ]; then echo "MOCK"; else echo "LIVE"; fi)"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: Check gateway health endpoint ───────────────────────
log "Step 1: Checking gateway health endpoint..."

if [ "$MOCK_MODE" = "true" ]; then
  log "Simulating GET ${GATEWAY_URL}/health"
  log "Simulated response: HTTP 200"
  pass "Health endpoint reachable (simulated)"
else
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
    -H "Authorization: Bearer ${GATEWAY_TOKEN}" \
    "${GATEWAY_URL}/health" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ]; then
    pass "Health endpoint returned HTTP 200"
  else
    fail "Health endpoint returned HTTP ${HTTP_CODE} (expected 200)"
  fi
fi

echo ""

# ── Step 2: Validate token is configured ────────────────────────
log "Step 2: Validating gateway token..."

if [ -n "$GATEWAY_TOKEN" ]; then
  TOKEN_LEN=${#GATEWAY_TOKEN}
  pass "Gateway token is set (${TOKEN_LEN} chars)"
else
  if [ "$MOCK_MODE" = "true" ]; then
    log "Token not set — acceptable in MOCK mode"
    pass "Token check skipped (mock mode)"
  else
    fail "GATEWAY_TOKEN / OPENCLAW_GATEWAY_TOKEN is empty or unset"
  fi
fi

echo ""

# ── Step 3: Send test message to agent ──────────────────────────
log "Step 3: Sending test message to agent..."

TEST_MESSAGE="[TEST] Gateway connectivity check. Reply with exactly: GATEWAY_OK"

if [ "$MOCK_MODE" = "true" ]; then
  log "Would execute: openclaw agent --agent main --message \"${TEST_MESSAGE}\" --json"
  log "Simulated response: { \"status\": \"ok\", \"result\": { \"payloads\": [{ \"text\": \"GATEWAY_OK\" }] } }"

  # Validate that the request payload would be correctly formed
  if [ -n "$TEST_MESSAGE" ]; then
    pass "Request payload is correctly formed (simulated)"
    pass "Agent response contains reply content (simulated)"
  else
    fail "Request payload is empty"
  fi
else
  AGENT_ARGS=(agent --agent main --message "$TEST_MESSAGE" --json --timeout 30)
  if [ -n "$GATEWAY_TOKEN" ]; then
    AGENT_ARGS+=(--token "$GATEWAY_TOKEN")
  fi

  RESPONSE=$(openclaw "${AGENT_ARGS[@]}" 2>/dev/null) || {
    fail "openclaw agent command failed"
    RESPONSE=""
  }

  if [ -n "$RESPONSE" ]; then
    STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
    REPLY_TEXT=$(echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
payloads = d.get('result',{}).get('payloads',[])
print(payloads[0].get('text','') if payloads else '')
" 2>/dev/null || echo "")

    if [ "$STATUS" = "ok" ]; then
      pass "Agent returned status: ok"
    else
      fail "Agent returned status: ${STATUS} (expected ok)"
    fi

    if [ -n "$REPLY_TEXT" ]; then
      pass "Agent reply content is present: \"${REPLY_TEXT:0:80}\""
    else
      fail "Agent reply content is empty"
    fi
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
