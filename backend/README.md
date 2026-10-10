# Waste Detection API

FastAPI + YOLOv8 (CPU). Classes come from the weights file.

## Run locally
```bash
uv sync
MODEL_PATH=/path/to/best.pt uv run uvicorn app.main:app --port 8000

curl localhost:8000/health
curl -F file=@image.jpg "localhost:8000/detect?conf=0.4"
```

## Docker
```bash
docker build -t waste-api .
docker run -p 8000:8000 -v /path/to/weights:/models waste-api
# or pull weights from S3 (needs IAM credentials/role with s3:GetObject):
docker run -p 8000:8000 -e MODEL_S3_URI=s3://bucket/best.pt waste-api
```

## Env vars
| Var | Default | Purpose |
|---|---|---|
| `MODEL_PATH` | `/models/best.pt` | weights location |
| `MODEL_S3_URI` | unset | if set, downloaded to `MODEL_PATH` at start (region ap-southeast-2) |
| `CORS_ORIGINS` | `*` | comma-separated allowed origins |
| `IMGSZ` | `640` | inference size |
| `RESULTS_BUCKET` | unset | S3 bucket for scan images (`scans/<date>/<scan_id>/original.jpg`, `annotated.jpg`) |
| `SCANS_TABLE` | unset | DynamoDB table (PK `day` S, SK `sk` S). Persistence is off unless **both** this and `RESULTS_BUCKET` are set |

Persistence uses region `ap-southeast-2`; the task role needs `s3:PutObject/GetObject` on the bucket and `dynamodb:PutItem/Query` on the table.
When persistence is off, `/detect` still works, `/stats` returns zeros and `/scans` returns `[]`.

## Endpoints
- `GET /health`
- `POST /detect?conf=0.4` - multipart `file`. Returns detections, counts, annotated `image`, `inference_ms`, plus `scan_id` and `impact` (`weight_kg`, `co2e_kg`, `car_km`, `tree_days`). An optional `line` query param (`[A-Za-z0-9_-]{1,32}`, default `line-1`) is still accepted but the UI no longer uses it. Saving to S3/DynamoDB is best-effort and never fails the request.
- `POST /detect-frame?conf=0.4&imgsz=416` - small JPEG (max 1 MB) for live mode. Returns detections, counts, `inference_ms`, `width`, `height` only; nothing is saved. Returns 429 immediately if the model is busy. See `LIVE.md`.
- `GET /stats?days=7&line=` - (days 1-90) totals, `by_class`, `by_day`, `by_hour` (UTC), `top_class`, `est_weight_kg`, `est_value_usd`, `est_co2e_kg`, `co2e_by_class`, `car_km`, `tree_days` (rough per-class constants in `app/store.py`; CO2e factors rounded from US EPA WARM), `purity_pct`.
- `GET /scans?limit=24&line=` - (1-100) newest first with 1h presigned `original_url` / `annotated_url`.

### Garbage reports (report -> clean -> AI-verified) and recyclable pickups
Need persistence (503 otherwise). Stored in the scans table under partitions `REPORT` / `PICKUP` (sk = id), photos under `reports/<id>/` and `pickups/<id>/` in the results bucket (no expiry). Detection runs at conf 0.35.
- `POST /reports` - multipart `file`, `lat`, `lng`, `note?`. Model tags the pile; status `open`.
- `GET /reports?status=open|resolved` - newest first, presigned before/after URLs, `escalated` = open 48h+.
- `POST /reports/{id}/resolve` - multipart `file` (after photo), `worker`. Closes **only if the model finds no waste**; otherwise records a rejected attempt and returns `verified: false` with what remains. 409 if already resolved.
- `POST /pickups` - multipart `file`, `name`, `phone`, `address?`, `lat`, `lng`, `weight_kg?`. 422 if no recyclables detected. Value = weight (given, else estimated from counts) split by detected composition x `USD_PER_KG`.
- `GET /pickups?status=requested|accepted|collected` - phone masked (`****456`).
- `POST /pickups/{id}/accept` (`collector`) -> returns the full phone; `POST /pickups/{id}/complete` (`paid_usd?`, `actual_kg?`). Conditional writes, so a job can only be accepted once (409).
- `GET /civic/summary` - counts, avg hours to clean, kg recovered, amount paid.

No auth: anyone can accept a pickup or submit a cleanup photo; the AI check is the only gate on closing a report.

CORS allows GET, POST and OPTIONS. In production the site and API are same-origin through Caddy, so CORS is only needed for local dev.

## Seeding demo data
```bash
export RESULTS_BUCKET=... SCANS_TABLE=... AWS_REGION=ap-southeast-2
uv run python scripts/seed.py --count 300 --days 7   # backdated, demo=true (spread over line-1..line-3 internally)
uv run python scripts/seed.py --clear-demo           # remove seeded items
```
Optional `--image a.jpg b.jpg` to use your own placeholder images (uploaded to `scans/demo/`).
