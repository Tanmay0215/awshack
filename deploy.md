# Deployment Guide

After this guide you will have the waste detection app running at a CloudFront URL: static site on S3, `/api/*` through Lambda to an ALB and an EC2 instance running the YOLOv8 container.

See [AWS.md](AWS.md) for the architecture.

> **Status.** Deployed and verified in ap-southeast-2 as stack `waste-detect`: `/api/health` and `POST /api/detect` (with `x-amz-content-sha256`) work through CloudFront. Still unverified: uploads near Lambda's ~6 MB payload cap (the app limit is 10 MB) and the HTTP-only Lambda-to-ALB hop.

All commands run from the repo root (`/Users/tanmay/Desktop/awshack`) unless stated. Scripts live in `infra/scripts/` and source `env-config`, which defaults to `REGION=ap-southeast-2` and `STACK_NAME=waste-detect`.

## 1. Prerequisites

- AWS CLI v2 with a profile for your project: `aws sts get-caller-identity` succeeds.
- Docker with `buildx` (Docker Desktop includes it) and the daemon running: `docker buildx version && docker info`. Only needed to build the image yourself.
- A Docker Hub account with push access to `tanman0215/waste-detect-api` (or your own repo) and `docker login` done. Skip if you use the existing public image.
- [uv](https://docs.astral.sh/uv/) (Python package manager, for running the backend locally).
- Node.js 18+ and npm (frontend build).
- `python3` (used by `destroy.sh`). The backend needs Python 3.11, which `uv` installs for you.
- `openssl` (to generate the origin secret).
- The weights file: `waste-model/streamlit-detection-tracking - app/weights/best.pt` (note the spaces in the folder name; always quote it).

Select your profile and Region for the shell:

```bash
export AWS_PROFILE=<your-profile>
export REGION=ap-southeast-2
```

## 2. Confirm your Region

All resources must be in the project's Region (ap-southeast-2 here). Confirm it in AWS Settings > View all projects > Overview > Additional Info > Region. If you cannot see it, check `~/.aws/config`.

If your Region differs, set `REGION` before running any script, but note the backend entrypoint (`backend/entrypoint.sh`) hard-codes `ap-southeast-2` for the S3 download client.

## 3. Check plan state and spend limit

```bash
aws freetier get-account-plan-state
```

- `accountPlanType: FREE` or `PAID` tells you which supported-services list applies. Check that EC2, ELB, CloudFront, Lambda, and S3 are supported; see the [supported services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) page.
- The default instance is `c7i-flex.large` (4 GB), which is free-plan eligible. `t3.*` types such as `t3.medium` were rejected on the free plan ("not eligible for Free Tier"). List eligible types: `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true`. Override with `InstanceType=<type>` in step 6.
- If you start seeing `AccessDenied` on calls that worked before, check whether a spend limit paused the project: AWS Settings > Billing. Only project owners can change the limit.

## 4. Run locally (optional but recommended)

Backend:

```bash
cd backend
uv sync          # installs from pyproject.toml / uv.lock
MODEL_PATH="../waste-model/streamlit-detection-tracking - app/weights/best.pt" \
  CORS_ORIGINS=http://localhost:3000 uv run uvicorn app.main:app --port 8000
```

In another terminal:

```bash
curl localhost:8000/health        # {"status":"ok","model_loaded":true}
curl -F file=@image.jpg "localhost:8000/detect?conf=0.4"
```

Frontend (second terminal):

```bash
cd frontend
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev   # http://localhost:3000
```

With `NEXT_PUBLIC_API_BASE` set, the frontend calls `${BASE}/detect` and `${BASE}/health` directly (no `/api` prefix). Without it (production), it calls `/api/detect` and `/api/health`.

## 5. Generate the origin secret

```bash
export ORIGIN_SECRET=$(openssl rand -hex 24)
echo "$ORIGIN_SECRET"   # store it somewhere safe; you need it to redeploy
```

It must be 16 to 128 characters of `A-Za-z0-9_-`. Re-running `deploy.sh` with a different value rotates it.

## 6. Deploy the stack

```bash
cd infra/scripts
./deploy.sh
# optional overrides, e.g.: ./deploy.sh InstanceType=c7i-flex.large ImageUri=docker.io/<you>/waste-detect-api:<tag>
```

What it does: runs `aws cloudformation deploy` directly against `infra/template.yaml` with `CAPABILITY_IAM` and prints the stack outputs. There is no packaging step: the Lambda code is inline in the template (`ZipFile`, copied from `lambda/api/index.js`). If you change `lambda/api/index.js`, paste the change into `template.yaml` too; CloudFormation limits inline code to 4 KB.

Expected: the stack reaches `CREATE_COMPLETE` (CloudFront can take 5 to 15 minutes) and prints outputs `CloudFrontDomain`, `DistributionId`, `SiteBucketName`, `ModelBucketName`, `AlbDnsName`, `InstanceId`.

Order matters. The instance boots before the image or model exist; its user data retries the Docker Hub pull every 30 s, so the stack works with the default public image immediately, and you can push a new image after the stack is up.

## 7. Upload the model

```bash
./upload-model.sh "/Users/tanmay/Desktop/awshack/waste-model/streamlit-detection-tracking - app/weights/best.pt"
```

Pass an absolute path. The script changes into its own directory, so a relative path resolves from `infra/scripts/` and can fail with "not found".

Uploads to `s3://<ModelBucketName>/models/best.pt` (the default `ModelKey`). A custom key is the optional second argument, but the stack's `ModelKey` parameter must match it.

## 8. Build and push the backend image (optional)

The stack pulls `docker.io/tanman0215/waste-detect-api:latest` (public repo, `ImageUri` parameter). Build and push only if you changed the backend or use your own repo:

```bash
docker login
DOCKERHUB_USER=<you> ./build-push.sh            # tag defaults to "latest"
```

Runs `docker buildx build --platform linux/amd64 ... --push ../../backend` and pushes to `docker.io/$DOCKERHUB_USER/waste-detect-api:<tag>` (default user `tanman0215`). For your own repo, deploy with `ImageUri=docker.io/<you>/waste-detect-api:<tag>`. Make the Docker Hub repo public, because the instance pulls without credentials. The platform flag matters on Apple Silicon: the instance is x86_64. The first build downloads PyTorch and takes several minutes.

On first boot the instance pulls the image from Docker Hub (retrying every 30 s). Container start then downloads the model from S3 and warms it up (allow a few minutes).

### 8a. Restart the container if the model was uploaded late

The model is fetched only when the container starts. If you uploaded the model after the container started (health shows `model_loaded: false`), restart it through SSM:

```bash
INSTANCE_ID=$(aws cloudformation describe-stacks --region ap-southeast-2 --stack-name waste-detect \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue | [0]" --output text)

aws ssm send-command --region ap-southeast-2 --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker restart backend","sleep 5","docker logs --tail 20 backend"]' \
  --query 'Command.CommandId' --output text
```

Fetch the output with `aws ssm get-command-invocation --region ap-southeast-2 --command-id <id> --instance-id "$INSTANCE_ID"`. If SSM reports the instance is not managed, wait a few minutes after boot. Rebooting the instance also works.

## 9. Deploy the frontend

```bash
./deploy-frontend.sh
```

Do not run this in parallel with `upload-model.sh`: with login-session credentials, concurrent CLI processes can hit an OAuth token refresh error. Run them one after the other.

Runs `npm ci` and `npm run build` in `frontend/` (static export to `out/`), syncs to `SiteBucketName` (HTML uncached, `_next/static` immutable for a year), and invalidates `/*`. It prints `Site: https://<CloudFrontDomain>`.

## 10. Smoke tests

```bash
CF=$(aws cloudformation describe-stacks --region ap-southeast-2 --stack-name waste-detect \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomain'].OutputValue | [0]" --output text)

curl -i "https://$CF/"                 # 200, HTML
curl -s "https://$CF/api/health"       # {"status":"ok","model_loaded":true}
```

Upload test from the CLI. CloudFront OAC to Lambda requires the SHA-256 of the exact body, so build the body first and send it unchanged:

```bash
python3 - <<'PY'
import hashlib, os
boundary = "----smoke"
img = open("image.jpg", "rb").read()
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"image.jpg\"\r\n"
        f"Content-Type: image/jpeg\r\n\r\n").encode() + img + f"\r\n--{boundary}--\r\n".encode()
open("body.bin", "wb").write(body)
open("sha.txt", "w").write(hashlib.sha256(body).hexdigest())
PY

curl -s -X POST "https://$CF/api/detect?conf=0.40" \
  -H "Content-Type: multipart/form-data; boundary=----smoke" \
  -H "x-amz-content-sha256: $(cat sha.txt)" \
  --data-binary @body.bin | head -c 400
```

Expected: JSON with `detections`, `counts`, `image`, `inference_ms`. Easiest test: open `https://$CF/` in a browser and upload a JPG, PNG, or WebP; the frontend adds the hash header for you. Use an image under about 4 MB, since Lambda function URLs limit payloads to roughly 6 MB (not yet tested near the limit).

Check the guard: calling the ALB directly without the header should return 403.

```bash
curl -i "http://$(aws cloudformation describe-stacks --region ap-southeast-2 --stack-name waste-detect \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue | [0]" --output text)/health"   # 403
```

## 11. Update, redeploy, roll back

| Change | Action |
|---|---|
| Frontend code | `./deploy-frontend.sh` |
| Backend code | `./build-push.sh [tag]`, then pull the new image and restart the container (below) |
| New model weights | `./upload-model.sh <path>`, then restart the container (step 8a) |
| Lambda code or template | Edit `lambda/api/index.js` and the inline copy in `template.yaml`, then `ORIGIN_SECRET=<same secret> ./deploy.sh` |
| Rotate the origin secret | `ORIGIN_SECRET=<new> ./deploy.sh` |

Pull a new image and restart on the instance (the container was created from the `ImageUri` image; Docker Hub is public, so no login is needed):

```bash
aws ssm send-command --region ap-southeast-2 --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --parameters 'commands=[
  "IMG=$(docker inspect backend --format {{.Config.Image}})",
  "docker pull $IMG && docker rm -f backend",
  "docker run -d --name backend --restart always -p 8000:8000 -e MODEL_S3_URI=s3://<ModelBucketName>/models/best.pt -e AWS_REGION=ap-southeast-2 -e AWS_DEFAULT_REGION=ap-southeast-2 $IMG"]'
```

Replace `<ModelBucketName>` with the stack output. This command is untested. User data only runs on first boot, so rebooting the instance restarts the existing container without pulling a new image. To switch to a different tag, pass a new `ImageUri` to `deploy.sh`; this replaces the instance, so it re-runs user data.

Rollback:

- Frontend: check out the previous commit and run `./deploy-frontend.sh`.
- Backend image: images are tagged; push with an explicit tag (`./build-push.sh v2`) and re-run the pull steps above with the older tag (Docker Hub keeps all tags you pushed).
- Model: `ModelBucket` is versioned; restore a previous version of `models/best.pt` (copy the old version over the current key) and restart the container.
- Stack: re-run `deploy.sh` from the previous template commit. CloudFormation rolls back automatically on failed updates.

## 12. Monitoring and logs

- Lambda logs: CloudWatch Logs group `/aws/lambda/<ApiFunction name>` (14-day retention).

  ```bash
  aws logs tail "/aws/lambda/$(aws cloudformation describe-stack-resource --region ap-southeast-2 \
    --stack-name waste-detect --logical-resource-id ApiFunction \
    --query StackResourceDetail.PhysicalResourceId --output text)" --region ap-southeast-2 --follow
  ```

- Container logs (no log driver to CloudWatch is configured): run `docker logs --tail 100 backend` on the instance via SSM (`send-command` as in step 8a), or start a session with `aws ssm start-session --target "$INSTANCE_ID"` (requires the Session Manager plugin).
- Boot log on the instance: `/var/log/backend-bootstrap.log`.
- Target health: EC2 console > Target Groups, or `aws elbv2 describe-target-health --target-group-arn <arn>`.
- Set a budget in the Billing and Cost Management console; the instance and ALB cost money while idle.

## 13. Clean up

```bash
cd infra/scripts
./destroy.sh        # prompts: type y
```

It empties `ModelBucket` and `SiteBucket` (including versions), deletes the stack, and waits. CloudFront deletion can take several minutes.

Leftover: a stray bucket `waste-detect-cfn-artifacts-<account>-<region>` may exist from an early packaging attempt. It is not part of the stack; delete it if present:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3 rb "s3://waste-detect-cfn-artifacts-$ACCOUNT_ID-ap-southeast-2" --force --region ap-southeast-2
```

The Docker Hub image is not touched by teardown.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `403` on `POST /api/detect` (health works) | Missing or wrong `x-amz-content-sha256`: Lambda OAC requires the SHA-256 of the exact body bytes | Use the site (frontend sends it) or compute the hash of the bytes you send. Do not re-encode the body after hashing. Also check you rebuilt/redeployed the frontend. |
| `403` on both `/api/health` and `/api/detect` | Lambda permissions or OAC misconfigured | Check `InvokeUrlPermission` and `InvokeFunctionPermission` exist; confirm the `/api/*` behavior uses `LambdaOac`. |
| `403` Forbidden text from the ALB | `X-Origin-Secret` mismatch between Lambda env and listener rule | Redeploy with one `ORIGIN_SECRET`; verify Lambda env `ORIGIN_SECRET`. |
| `502 Backend unavailable` | Lambda cannot reach the ALB or instance is down | Check the target group health, `Ec2Sg`/`AlbSg`, and the container (`docker ps`). |
| `504` | Inference or queueing took more than 25 s, or the instance is overloaded | Use a smaller image, lower load, or a bigger `InstanceType`. Inference is serialized. |
| `413` | File over 10 MB, or request over Lambda's ~6 MB payload limit | Use a smaller image. |
| `503 Model not loaded` / `model_loaded: false` | Model not uploaded yet or uploaded after container start; wrong `ModelKey` | Run `upload-model.sh`, then restart the container (step 8a). Check `docker logs backend` for the S3 download error. |
| Target `unhealthy` / `/health` failing | Container not started, image not yet pushed, or still loading the model (start period ~90 s plus download) | Run `build-push.sh`; wait for user data retries; check `/var/log/backend-bootstrap.log` and `docker logs backend`. |
| Stack stuck `CREATE_IN_PROGRESS` | Normal for CloudFront (5 to 15 min). If the instance never reports healthy it does not block creation. | Wait; inspect events: `aws cloudformation describe-stack-events`. |
| `Cannot connect to the Docker daemon` | Docker not running | Start Docker Desktop or the daemon; rerun `./build-push.sh`. |
| `exec format error` on the instance | Image built for arm64 | Use `build-push.sh` (forces `linux/amd64`); don't `docker build` locally and push. |
| `denied` / `unauthorized` on push to Docker Hub | Not logged in or no push access to the repo | Run `docker login` with an account that owns the repo, then re-run `./build-push.sh`. |
| Sudden `AccessDenied` on things that worked | Spend limit reached, project paused | AWS Settings > Billing; owners can raise the limit. |
| Service or instance type not available | Plan restriction | Re-check step 3; deploy with a different `InstanceType`. |
| Stack fails with `not eligible for Free Tier` on the instance | Free plan rejects instance types such as `t3.medium` | Use `c7i-flex.large` (default) or another type from `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true`. |
| `ImportError: libGL.so.1: cannot open shared object file` in `docker logs backend` | OpenCV needs libGL on the slim base image | Fixed: `backend/Dockerfile` installs `libgl1` (and `libglib2.0-0`). Rebuild and push with `build-push.sh`, then pull and restart. |
| `upload-model.sh` says `not found` | Relative path; the script runs from `infra/scripts/` | Pass an absolute path to `best.pt`. |
| OAuth token refresh error from the AWS CLI | Parallel CLI processes (for example `upload-model.sh` and `deploy-frontend.sh` together) refreshing the same login-session credentials | Run the commands one at a time and retry. |
| Site shows stale content | CloudFront cache | `deploy-frontend.sh` invalidates `/*`; wait for the invalidation to complete. |
