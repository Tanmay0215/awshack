#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
. ./env-config
read -r -p "Delete stack $STACK_NAME in $REGION and all data? [y/N] " a
[ "$a" = "y" ] || exit 1

empty_bucket() {
  local b="$1"
  [ -n "$b" ] && [ "$b" != "None" ] || return 0
  echo "Emptying $b"
  while :; do
    local out
    out="$(aws s3api list-object-versions --bucket "$b" --region "$REGION" --max-items 500 \
      --query '{Objects: [].{Key:Key,VersionId:VersionId}}' --output json 2>/dev/null || echo '{"Objects":null}')"
    if [ "$(echo "$out" | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("Objects") or []))')" = "0" ]; then break; fi
    aws s3api delete-objects --bucket "$b" --region "$REGION" --delete "$out" >/dev/null
  done
}

empty_bucket "$(stack_output ModelBucketName)"
empty_bucket "$(stack_output ResultsBucketName)"

aws cloudformation delete-stack --region "$REGION" --stack-name "$STACK_NAME"
aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$STACK_NAME"
echo "Deleted. A stray $STACK_NAME-cfn-artifacts-* bucket from an early packaging attempt may remain; delete it manually if present."
