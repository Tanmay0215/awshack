#!/usr/bin/env bash
# Create/update the Route 53 DNS stack ($STACK_NAME-dns). Run after deploy.sh (needs its ElasticIp output).
# Usage: ./deploy-dns.sh [parameter overrides, e.g. DomainName=x.example.com]
# Then set the printed NameServers at the domain registrar.
set -euo pipefail
cd "$(dirname "$0")/.."
. ./scripts/env-config

EIP="$(stack_output ElasticIp)"
[ -n "$EIP" ] && [ "$EIP" != "None" ] || { echo "No ElasticIp output on $STACK_NAME; run deploy.sh first." >&2; exit 1; }

aws cloudformation deploy --region "$REGION" --stack-name "$DNS_STACK_NAME" \
  --template-file dns.yaml --parameter-overrides "ElasticIp=$EIP" ${@+"$@"}

aws cloudformation describe-stacks --region "$REGION" --stack-name "$DNS_STACK_NAME" \
  --query 'Stacks[0].Outputs' --output table
