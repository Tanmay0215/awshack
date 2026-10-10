#!/usr/bin/env bash
# Build web image (Caddy + static frontend, linux/amd64) and push to Docker Hub. Requires `docker login`.
# Usage: DOCKERHUB_USER=tanman0215 ./build-push-web.sh [tag]   (default tag: latest)
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${1:-latest}"
IMAGE="${DOCKERHUB_USER:-tanman0215}/sortline-web:$TAG"
# Google Maps browser key: env var, else frontend/.env.local.
KEY="${NEXT_PUBLIC_GOOGLE_MAPS_KEY:-$(sed -n 's/^NEXT_PUBLIC_GOOGLE_MAPS_KEY=//p' ../frontend/.env.local 2>/dev/null)}"
[ -n "$KEY" ] || echo "warning: NEXT_PUBLIC_GOOGLE_MAPS_KEY not set, maps will not load" >&2
docker buildx build --platform linux/amd64 --build-arg NEXT_PUBLIC_GOOGLE_MAPS_KEY="$KEY" -t "$IMAGE" --push ../frontend
echo "Pushed docker.io/$IMAGE  (stack parameter WebImageUri=docker.io/$IMAGE)"
