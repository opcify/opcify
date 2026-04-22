#!/usr/bin/env bash
set -euo pipefail

IMAGE="qiguangyang/openclaw"
TAG="${1:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure a buildx builder exists
if ! docker buildx inspect multiarch >/dev/null 2>&1; then
  echo "==> Creating buildx builder 'multiarch'"
  docker buildx create --name multiarch --use
else
  docker buildx use multiarch
fi

# Build tags
TAGS=("-t" "${IMAGE}:${TAG}")
if [ "${TAG}" != "latest" ]; then
  TAGS+=("-t" "${IMAGE}:latest")
fi

echo "==> Building ${IMAGE}:${TAG} for ${PLATFORMS}"
docker buildx build \
  --builder multiarch \
  --platform "${PLATFORMS}" \
  -f "${SCRIPT_DIR}/Dockerfile.openclaw" \
  "${TAGS[@]}" \
  --push \
  "${SCRIPT_DIR}"

echo "==> Done: ${IMAGE}:${TAG} (${PLATFORMS})"
