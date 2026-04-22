#!/usr/bin/env bash
# run_all.sh — Integration Test Suite Entry Point
# Runs all integration tests in sequence and reports a summary.
# Reads OPENCLAW_MOCK_MODE at runtime to determine mode.

set -uo pipefail

MOCK_MODE="${OPENCLAW_MOCK_MODE:-false}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PASSED=0
FAILED=0
TOTAL=4

echo "╔═══════════════════════════════════════════╗"
echo "║   Opcify ↔ OpenClaw Integration Tests     ║"
echo "╠═══════════════════════════════════════════╣"
if [ "$MOCK_MODE" = "true" ]; then
  echo "║   Mode: MOCK                              ║"
else
  echo "║   Mode: LIVE                              ║"
fi
echo "╚═══════════════════════════════════════════╝"
echo ""

TESTS=(
  "test_gateway_connection.sh:Gateway Connectivity"
  "test_webhook_e2e.sh:Webhook End-to-End"
  "test_status_callback.sh:Status Callback"
  "test_heartbeat.sh:Heartbeat Fallback"
)

RESULTS=()

for entry in "${TESTS[@]}"; do
  SCRIPT="${entry%%:*}"
  NAME="${entry##*:}"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Running: ${NAME}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  if [ -f "${SCRIPT_DIR}/${SCRIPT}" ]; then
    if bash "${SCRIPT_DIR}/${SCRIPT}"; then
      PASSED=$((PASSED + 1))
      RESULTS+=("✅ ${NAME}")
    else
      FAILED=$((FAILED + 1))
      RESULTS+=("❌ ${NAME}")
    fi
  else
    FAILED=$((FAILED + 1))
    RESULTS+=("❌ ${NAME} (script not found: ${SCRIPT})")
    echo "  ❌ Script not found: ${SCRIPT_DIR}/${SCRIPT}"
  fi
done

echo ""
echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║              Test Summary                  ║"
echo "╠═══════════════════════════════════════════╣"

for result in "${RESULTS[@]}"; do
  printf "║  %-40s ║\n" "$result"
done

echo "╠═══════════════════════════════════════════╣"
printf "║  Passed: %d/%d" "$PASSED" "$TOTAL"
if [ "$FAILED" -gt 0 ]; then
  printf "  Failed: %d" "$FAILED"
fi
printf "%*s║\n" $((33 - ${#PASSED} - ${#TOTAL} - $(if [ "$FAILED" -gt 0 ]; then echo $((12 + ${#FAILED})); else echo 0; fi))) ""
echo "╚═══════════════════════════════════════════╝"

if [ "$FAILED" -gt 0 ]; then
  exit 1
else
  exit 0
fi
