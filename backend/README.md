# Waste Detection API

FastAPI + YOLOv8 (CPU). Classes come from the weights file.

## Run locally
```bash
uv sync
MODEL_PATH=/path/to/best.pt uv run uvicorn app.main:app --port 8000

curl localhost:8000/health
curl -F file=@image.jpg "localhost:8000/detect?conf=0.4&line=line-1"
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
- `POST /detect?conf=0.4&line=line-1` - multipart `file`. Returns detections, counts, annotated `image`, `inference_ms`, plus `scan_id`. `line` matches `[A-Za-z0-9_-]{1,32}`. Saving to S3/DynamoDB is best-effort and never fails the request.
- `GET /stats?days=7&line=` - (days 1-90) totals, `by_class`, `by_day`, `by_hour` (UTC), `top_class`, `est_weight_kg`, `est_value_usd` (rough per-class constants in `app/store.py`), `purity_pct`.
- `GET /scans?limit=24&line=` - (1-100) newest first with 1h presigned `original_url` / `annotated_url`.

CORS allows GET, POST, OPTIONS and the `x-amz-content-sha256` header.

## Seeding demo data
```bash
export RESULTS_BUCKET=... SCANS_TABLE=... AWS_REGION=ap-southeast-2
uv run python scripts/seed.py --count 300 --days 7   # backdated, demo=true, line-1..line-3
uv run python scripts/seed.py --clear-demo           # remove seeded items
```
Optional `--image a.jpg b.jpg` to use your own placeholder images (uploaded to `scans/demo/`).
