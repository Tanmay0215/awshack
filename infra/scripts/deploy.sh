#!/usr/bin/env bash
# Create/update the stack (single EC2 + Caddy; images come from Docker Hub).
# Usage: ./deploy.sh [parameter overrides, e.g. InstanceType=c7i-flex.large DomainName=x.example.com]
# Order: 1) build-push.sh + build-push-web.sh  2) deploy.sh  3) upload-model.sh  4) deploy-dns.sh (Route 53)
set -euo pipefail
cd "$(dirname "$0")/.."
. ./scripts/env-config

aws cloudformation deploy --region "$REGION" --stack-name "$STACK_NAME" \
  --template-file template.yaml --capabilities CAPABILITY_IAM \
  ${@:+--parameter-overrides "$@"}

aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs' --output table
