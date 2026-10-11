# Deploying Sortline

After this guide you have Sortline running at your own HTTPS domain on a single EC2 instance. For how the pieces fit together, see [`AWS.md`](AWS.md).

Current deployment: stack `waste-detect`, Region `ap-southeast-2`, Elastic IP `13.55.1.7`, domain `pixelapp.tech` (+ `www.pixelapp.tech`, set via `SITE_ADDRESS` in `infra/scripts/env-config`), images `tanman0215/waste-detect-api` and `tanman0215/sortline-web` on Docker Hub.

## 1. Prerequisites

- AWS CLI v2, logged in (`aws sts get-caller-identity` works).
- Docker with buildx, and a Docker Hub login (`docker login`). The two repositories must be public.
- [uv](https://docs.astral.sh/uv/) (Python backend) and Node 22+ with npm (frontend).
- A domain whose name servers you can change at the registrar.
- The YOLO weights file `best.pt`. In this repo it is at `model/weights/best.pt`.

## 2. Confirm Region and plan

All resources go in one Region. The scripts default to `ap-southeast-2` (`infra/scripts/env-config`); override with `REGION=...`. Confirm it in AWS Settings > View all projects > Overview > Additional Info > Region.

Check the plan, because the free plan limits instance types:

```bash
aws freetier get-account-plan-state
aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true \
  --query 'InstanceTypes[].InstanceType' --output text --region ap-southeast-2
```

The default `c7i-flex.large` is eligible. `t3.*` types are rejected on the free plan.

## 3. Run locally

With Docker (mirrors production: Caddy serves the site and proxies `/api/*`):

```bash
docker compose up --build
```

Open http://localhost:8080. The weights are mounted from `model/weights/best.pt` (see `docker-compose.yml`; update it if the folder moves). Persistence is off locally, so `/dashboard` is empty.

Without Docker, in two terminals:

```bash
# terminal 1
cd backend && uv sync
MODEL_PATH="/absolute/path/to/best.pt" uv run uvicorn app.main:app --port 8000

# terminal 2
cd frontend && npm ci
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

The camera on `/live` works on `localhost` and on HTTPS only.

## 4. First-time deploy

No secrets are needed. Run everything from `infra/`.

```bash
cd infra
./scripts/deploy.sh
```

This creates the stack (VPC, EC2 instance, Elastic IP, ModelBucket, ResultsBucket, ScansTable, log groups) and prints the outputs. Override parameters if needed, for example `./scripts/deploy.sh DomainName=x.example.com InstanceType=c7i-flex.large`.

The instance pulls both images from Docker Hub at first boot and retries every 30 seconds until they exist, so push the images (below) whenever convenient.

Upload the weights. The path **must be absolute**:

```bash
./scripts/upload-model.sh "/Users/you/awshack/model/weights/best.pt"
```

Build and push both images (linux/amd64):

```bash
./scripts/build-push.sh        # tanman0215/waste-detect-api:latest
./scripts/build-push-web.sh    # tanman0215/sortline-web:latest
```

Set `DOCKERHUB_USER=<you>` to push to your own account, and pass matching `ImageUri` / `WebImageUri` to `deploy.sh`.

Make the instance run the latest images and the uploaded model:

```bash
./scripts/update-instance.sh
```

The API downloads the model when its container starts and needs about 15-30 seconds to load it.

## 5. DNS in Route 53

DNS for the domain is a Route 53 public hosted zone in its own stack (`infra/dns.yaml`, stack `waste-detect-dns`), separate from the app stack so tearing down the app never removes DNS or mail records.

```bash
cd infra
./scripts/deploy-dns.sh                          # reads ElasticIp from the app stack; prints NameServers
./scripts/deploy-dns.sh DomainName=x.example.com # other domain
```

It creates A records for the apex and `www` pointing at the Elastic IP, plus the records copied from the registrar's DNS: apex MX (SES inbound, us-east-1), Google site verification TXT, `_dmarc` TXT, and the Resend email records (`send.` MX/SPF TXT, `resend._domainkey` DKIM TXT). Before switching, compare against the registrar's record list; anything else must be added to `dns.yaml` first or it stops resolving.

Then, at the registrar (Namify for `pixelapp.tech`), replace the name servers with the four in the `NameServers` output. Propagation takes minutes to a few hours; check with `dig +short NS pixelapp.tech`. Caddy keeps serving and renewing the Let's Encrypt certificate as before; it does not depend on which DNS provider answers.

The hosted zone has `DeletionPolicy: Retain` and costs about $0.50/month plus queries.

## 6. Smoke tests

```bash
SITE=https://pixelapp.tech
curl -s $SITE/api/health                                    # model_loaded should be true
curl -s -F file=@sample.jpg "$SITE/api/detect?conf=0.4" | head -c 400
curl -s -F file=@sample.jpg "$SITE/api/detect-frame?conf=0.4&imgsz=416"
curl -s "$SITE/api/stats?days=7"
curl -s "$SITE/api/scans?limit=3"
```

Expected: `/detect` returns `detections`, `counts`, `image`, `inference_ms` and `scan_id`. `/detect-frame` returns detections only and saves nothing. `/scans` lists the scan you just made, with presigned image URLs that open in a browser.

## 7. Redeploy after code changes

User data runs only on first boot, so changing code or the template does not touch a running instance by itself.

```bash
cd infra
./scripts/build-push.sh          # if backend/ changed
./scripts/build-push-web.sh      # if frontend/ changed
./scripts/update-instance.sh     # pulls images, recreates both containers
```

If you changed `template.yaml`, run `./scripts/deploy.sh` first, then `update-instance.sh`. The `caddy_data` volume is kept, so the certificate survives.

## 8. Demo data

Demo seeding exists but the demo data was cleared and is not loaded. To seed or clear it, export credentials (boto3 cannot read the `aws login` session) and the stack outputs:

```bash
cd backend
eval "$(aws configure export-credentials --format env)"
export AWS_REGION=ap-southeast-2
export RESULTS_BUCKET=$(aws cloudformation describe-stacks --stack-name waste-detect --region $AWS_REGION \
  --query "Stacks[0].Outputs[?OutputKey=='ResultsBucketName'].OutputValue" --output text)
export SCANS_TABLE=$(aws cloudformation describe-stacks --stack-name waste-detect --region $AWS_REGION \
  --query "Stacks[0].Outputs[?OutputKey=='ScansTableName'].OutputValue" --output text)

uv run python scripts/seed.py --count 300 --days 7   # add demo items
uv run python scripts/seed.py --clear-demo           # remove them
```

Seeded scans carry the optional `line` value (`line-1` to `line-3`); the UI no longer shows lines.

## 9. Logs

Both containers log to CloudWatch (14-day retention):

```bash
aws logs tail /sortline/api --follow --region ap-southeast-2
aws logs tail /sortline/web --follow --region ap-southeast-2
```

The first-boot log is `/var/log/bootstrap.log` on the instance (open a shell with SSM Session Manager; there is no SSH).

## 10. Disk cleanup on the instance

`update-instance.sh` runs `docker image prune -af` and `docker builder prune -af` after recreating the containers, so old images do not fill the 30 GB disk.

## 11. Tear down

```bash
cd infra
./scripts/destroy.sh     # asks for confirmation; empties both buckets, deletes the stack
```

Then:

- Leave the DNS stack in place if the domain is still used (mail records live there). To remove it: `aws cloudformation delete-stack --stack-name waste-detect-dns`; the hosted zone is retained, so delete it in Route 53 afterwards and point the registrar at other name servers first.
- Delete the stale buckets `waste-detect-sitebucket-*` and `waste-detect-cfn-artifacts-*` by hand. They are left from earlier designs, are not in the stack, and `destroy.sh` does not touch them.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ImportError: libGL.so.1` in API logs | OpenCV needs libGL. The backend Dockerfile installs `libgl1` and `libglib2.0-0`; rebuild and push the image, then `update-instance.sh`. |
| Stack create fails with "not eligible for Free Tier" | The free plan rejects `t3.*`. Use `InstanceType=c7i-flex.large` or another type from the eligible list in step 2. |
| `upload-model.sh` says "not found" | The path must be absolute and quoted (the default folder name contains spaces). |
| `ExpiredToken` or login errors partway through a script | Running several AWS CLI jobs in parallel can break login-token refresh. Run commands one at a time and log in again. |
| Scan images are broken on the dashboard | Presigned S3 URLs must use the regional endpoint (`s3.ap-southeast-2.amazonaws.com`); the global host redirects and breaks the signature. `backend/app/store.py` already sets it. |
| `502` or a blank API response right after a deploy | The model is still loading (about 15-30 s). Check `/api/health` for `model_loaded: true`. |
| `/detect` returns 503 | Model not loaded: weights missing from `ModelBucket`. Run `upload-model.sh`, then `update-instance.sh`. |
| `/detect-frame` returns 429 | Normal: the model is busy with another request. The live page retries on its own. |
| HTTPS fails or certificate not issued | DNS does not resolve to the Elastic IP yet (name servers not switched to Route 53, or still propagating), or ports 80/443 are blocked. Check `dig +short pixelapp.tech`; Caddy retries automatically. Check `aws logs tail /sortline/web`. |
| `docker push` fails with a TLS handshake timeout | Docker Hub flakiness. Retry the build-push script. |
| `/live` says the camera is unavailable | Browsers allow the camera only on HTTPS or localhost. Use the https:// address and grant permission. |
| Everything suddenly returns Access Denied | Check for a spend limit in AWS Settings > Billing; a limit pauses the project when exceeded. |
