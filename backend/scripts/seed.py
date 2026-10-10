"""Seed synthetic demo scans straight into DynamoDB (demo=true).

  uv run python scripts/seed.py --count 300 --days 7
  uv run python scripts/seed.py --clear-demo

Needs RESULTS_BUCKET and SCANS_TABLE (+ AWS credentials).
"""
import argparse
import io
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from boto3.dynamodb.conditions import Attr  # noqa: E402

from app import store  # noqa: E402

LINES = ["line-1", "line-2", "line-3"]
# Rough class mix of a mixed-waste stream.
MIX = {"PLASTIC": 30, "PAPER": 20, "CARDBOARD": 18, "BIODEGRADABLE": 14, "METAL": 10, "GLASS": 8}
# Relative scan volume by UTC hour: heavy 08:00-17:00.
HOUR_W = [1, 1, 1, 1, 1, 2, 4, 8, 14, 16, 16, 15, 11, 15, 16, 15, 12, 7, 4, 3, 2, 2, 1, 1]


def placeholder_jpegs(n: int = 3) -> list[bytes]:
    import numpy as np
    from PIL import Image

    rng = np.random.default_rng(7)
    out = []
    for i in range(n):
        base = rng.integers(60, 200, 3)
        arr = np.clip(base + rng.normal(0, 25, (180, 240, 3)), 0, 255).astype("uint8")
        buf = io.BytesIO()
        Image.fromarray(arr).save(buf, "JPEG", quality=70)
        out.append(buf.getvalue())
    return out


def upload_placeholders(paths: list[str] | None) -> list[str]:
    blobs = [open(p, "rb").read() for p in paths] if paths else placeholder_jpegs()
    keys = []
    for i, b in enumerate(blobs):
        key = f"scans/demo/placeholder-{i}.jpg"
        store._s3().put_object(Bucket=store.bucket(), Key=key, Body=b, ContentType="image/jpeg")
        keys.append(key)
    return keys


def make_scan(rng: random.Random, days: int, keys: list[str], now: datetime) -> dict:
    day_off = rng.randrange(days)
    hour = rng.choices(range(24), HOUR_W)[0]
    ts = (now - timedelta(days=day_off)).replace(hour=hour, minute=rng.randrange(60), second=rng.randrange(60),
                                                  microsecond=rng.randrange(1000) * 1000)
    if ts > now:
        ts -= timedelta(days=1)
    n = rng.choices([0, 1, 2, 3, 4, 5, 6, 7, 8], [3, 14, 18, 18, 15, 12, 9, 6, 5])[0]
    classes = rng.choices(list(MIX), list(MIX.values()), k=n)
    # Sorted belts are mostly one dominant class; bias towards the first pick.
    if n > 1:
        classes = [classes[0] if rng.random() < 0.55 else c for c in classes]
    counts: dict = {}
    dets = []
    for c in classes:
        counts[c] = counts.get(c, 0) + 1
        x, y = rng.uniform(0, 500), rng.uniform(0, 350)
        dets.append({"class": c, "confidence": round(rng.uniform(0.45, 0.97), 4),
                     "box": [round(x, 1), round(y, 1), round(x + rng.uniform(40, 140), 1), round(y + rng.uniform(40, 140), 1)]})
    sid = store.new_scan_id()
    key = rng.choice(keys)
    item = store.build_item(sid, ts, rng.choice(LINES), counts, dets, rng.randint(70, 320), key, key, demo=True)
    return item


def clear_demo() -> int:
    t, n = store._table(), 0
    kw = {"FilterExpression": Attr("demo").eq(True), "ProjectionExpression": "#d, sk",
          "ExpressionAttributeNames": {"#d": "day"}}
    with t.batch_writer() as bw:
        while True:
            r = t.scan(**kw)
            for it in r["Items"]:
                bw.delete_item(Key={"day": it["day"], "sk": it["sk"]})
                n += 1
            if "LastEvaluatedKey" not in r:
                break
            kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=300)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--image", nargs="*", help="JPEG paths to use as placeholders")
    ap.add_argument("--clear-demo", action="store_true", help="delete demo items and exit")
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()
    if not store.enabled():
        sys.exit("Set RESULTS_BUCKET and SCANS_TABLE")
    if a.clear_demo:
        print(f"Deleted {clear_demo()} demo scans")
        return
    keys = upload_placeholders(a.image)
    rng = random.Random(a.seed)
    now = datetime.now(timezone.utc)
    with store._table().batch_writer() as bw:
        for _ in range(a.count):
            bw.put_item(Item=make_scan(rng, a.days, keys, now))
    print(f"Seeded {a.count} demo scans over {a.days} days; placeholders: {keys}")


if __name__ == "__main__":
    main()
