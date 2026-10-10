#!/usr/bin/env bash
# Build backend image (linux/amd64) and push to Docker Hub. Requires `docker login`.
# Usage: DOCKERHUB_USER=tanman0215 ./build-push.sh [tag]   (default tag: latest)
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:-latest}"
IMAGE="${DOCKERHUB_USER:-tanman0215}/waste-detect-api:$TAG"
docker buildx build --platform linux/amd64 -t "$IMAGE" --push ../backend
echo "Pushed docker.io/$IMAGE  (stack parameter ImageUri=docker.io/$IMAGE)"
