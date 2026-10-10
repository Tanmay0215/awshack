#!/usr/bin/env bash
# Usage: ./upload-model.sh <path/to/best.pt> [s3-key, default models/best.pt]
set -euo pipefail
cd "$(dirname "$0")"
. ./env-config
WEIGHTS="${1:?usage: upload-model.sh <weights-path> [key]}"
KEY="${2:-models/best.pt}"
[ -f "$WEIGHTS" ] || { echo "not found: $WEIGHTS" >&2; exit 1; }
BUCKET="$(stack_output ModelBucketName)"
aws s3 cp "$WEIGHTS" "s3://$BUCKET/$KEY" --region "$REGION"
echo "Uploaded to s3://$BUCKET/$KEY"
echo "If the instance already started, run ./update-instance.sh to recreate the containers."
