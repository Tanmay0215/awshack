#!/usr/bin/env bash
# Build web image (Caddy + static frontend, linux/amd64) and push to Docker Hub. Requires `docker login`.
# Usage: DOCKERHUB_USER=tanman0215 ./build-push-web.sh [tag]   (default tag: latest)
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:-latest}"
IMAGE="${DOCKERHUB_USER:-tanman0215}/sortline-web:$TAG"
docker buildx build --platform linux/amd64 -t "$IMAGE" --push ../frontend
echo "Pushed docker.io/$IMAGE  (stack parameter WebImageUri=docker.io/$IMAGE)"
