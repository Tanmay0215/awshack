#!/usr/bin/env bash
# Pull latest api + web images on the instance and recreate both containers (via SSM; no SSH).
# Usage: ./update-instance.sh [api-image] [web-image]
set -euo pipefail
cd "$(dirname "$0")"
. ./env-config
API_IMAGE="${1:-docker.io/${DOCKERHUB_USER:-tanman0215}/waste-detect-api:latest}"
WEB_IMAGE="${2:-docker.io/${DOCKERHUB_USER:-tanman0215}/sortline-web:latest}"
IID="$(stack_output InstanceId)"
MODEL_BUCKET="$(stack_output ModelBucketName)"
RESULTS_BUCKET="$(stack_output ResultsBucketName)"
TABLE="$(stack_output ScansTableName)"
API_LOG="$(stack_output ApiLogGroupName)"
WEB_LOG="$(stack_output WebLogGroupName)"
DOMAIN="$(stack_output SiteUrl)"; DOMAIN="${DOMAIN#https://}"
MODEL_KEY="${MODEL_KEY:-models/best.pt}"

CMDS=$(cat <<SCRIPT
set -e
docker network create sortline 2>/dev/null || true
docker pull $API_IMAGE
docker pull $WEB_IMAGE
docker rm -f api web backend 2>/dev/null || true
docker run -d --name api --network sortline --restart always \
  --log-driver awslogs --log-opt awslogs-region=$REGION --log-opt awslogs-group=$API_LOG --log-opt awslogs-stream=api \
  -e MODEL_S3_URI=s3://$MODEL_BUCKET/$MODEL_KEY -e RESULTS_BUCKET=$RESULTS_BUCKET -e SCANS_TABLE=$TABLE \
  -e AWS_REGION=$REGION -e AWS_DEFAULT_REGION=$REGION $API_IMAGE
docker run -d --name web --network sortline --restart always \
  --log-driver awslogs --log-opt awslogs-region=$REGION --log-opt awslogs-group=$WEB_LOG --log-opt awslogs-stream=web \
  -p 80:80 -p 443:443 -p 443:443/udp -e SITE_ADDRESS=$DOMAIN \
  -v caddy_data:/data -v caddy_config:/config $WEB_IMAGE
docker image prune -af
docker builder prune -af
docker ps
SCRIPT
)

CID="$(aws ssm send-command --region "$REGION" --instance-ids "$IID" \
  --document-name AWS-RunShellScript --comment "sortline update" \
  --parameters "$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.argv[1]]}))' "$CMDS")" \
  --query Command.CommandId --output text)"
aws ssm wait command-executed --region "$REGION" --command-id "$CID" --instance-id "$IID" || true
aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" \
  --query '{Status:Status,Out:StandardOutputContent,Err:StandardErrorContent}' --output yaml
