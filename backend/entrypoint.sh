#!/bin/sh
set -eu

export MODEL_PATH="${MODEL_PATH:-/models/best.pt}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-2}"

if [ -n "${MODEL_S3_URI:-}" ]; then
  echo "Downloading weights from ${MODEL_S3_URI} to ${MODEL_PATH}"
  python - <<'PY'
import os, sys, boto3
uri = os.environ["MODEL_S3_URI"]
if not uri.startswith("s3://") or "/" not in uri[5:]:
    sys.exit("MODEL_S3_URI must look like s3://bucket/key")
bucket, key = uri[5:].split("/", 1)
dest = os.environ["MODEL_PATH"]
os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
boto3.client("s3", region_name="ap-southeast-2").download_file(bucket, key, dest)
PY
fi

exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
