#!/usr/bin/env bash
set -euo pipefail

IMAGE="qiguangyang/openclaw"
TAG="${1:-latest}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Building ${IMAGE}:${TAG} for local ARM (linux/arm64)"
docker build \
  --platform linux/arm64 \
  -f "${SCRIPT_DIR}/Dockerfile.openclaw" \
  -t "${IMAGE}:${TAG}" \
  "${SCRIPT_DIR}"

echo "==> Done: ${IMAGE}:${TAG} (local only, not pushed)"
