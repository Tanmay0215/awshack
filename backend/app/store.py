"""Best-effort scan persistence (S3 + DynamoDB) and analytics.

Enabled only when RESULTS_BUCKET and SCANS_TABLE are both set; otherwise every
function is a harmless no-op returning empty data.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.config import Config

log = logging.getLogger("waste-api")

REGION = "ap-southeast-2"
CLASSES = ["BIODEGRADABLE", "CARDBOARD", "GLASS", "METAL", "PAPER", "PLASTIC"]
LINE_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
URL_TTL = 3600

# Rough estimates only: average item mass (kg) and scrap/recycling value (USD/kg).
AVG_ITEM_KG = {"BIODEGRADABLE": 0.30, "CARDBOARD": 0.25, "GLASS": 0.40, "METAL": 0.05, "PAPER": 0.05, "PLASTIC": 0.03}
USD_PER_KG = {"BIODEGRADABLE": 0.02, "CARDBOARD": 0.10, "GLASS": 0.05, "METAL": 1.20, "PAPER": 0.12, "PLASTIC": 0.35}

_clients: dict = {}


def bucket() -> str | None:
    return os.getenv("RESULTS_BUCKET") or None


def table_name() -> str | None:
    return os.getenv("SCANS_TABLE") or None


def enabled() -> bool:
    return bool(bucket() and table_name())


def _s3():
    if "s3" not in _clients:
        _clients["s3"] = boto3.client(
            "s3",
            region_name=REGION,
            # regional host: the global s3.amazonaws.com host 307-redirects and breaks presigned URLs
            endpoint_url=f"https://s3.{REGION}.amazonaws.com",
            config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
        )
    return _clients["s3"]


def _table():
    if "ddb" not in _clients:
        _clients["ddb"] = boto3.resource("dynamodb", region_name=REGION).Table(table_name())
    return _clients["ddb"]


def reset_clients() -> None:
    _clients.clear()


def new_scan_id() -> str:
    return uuid.uuid4().hex


def _dec(o):
    """Convert floats to Decimal recursively for DynamoDB."""
    if isinstance(o, float):
        return Decimal(str(o))
    if isinstance(o, dict):
        return {k: _dec(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_dec(v) for v in o]
    return o


def build_item(scan_id: str, ts: datetime, line: str, counts: dict, detections: list, inference_ms: int,
               original_key: str, annotated_key: str, demo: bool = False) -> dict:
    total = sum(counts.values())
    confs = [d["confidence"] for d in detections]
    avg = round(sum(confs) / len(confs), 4) if confs else 0.0
    ts = ts.astimezone(timezone.utc)
    iso = ts.isoformat(timespec="milliseconds")
    return _dec({
        "day": ts.strftime("%Y-%m-%d"),
        "sk": f"{iso}#{scan_id}",
        "id": scan_id,
        "ts": iso,
        "line": line,
        "counts": {k: int(v) for k, v in counts.items()},
        "total": int(total),
        "avg_confidence": avg,
        "inference_ms": int(inference_ms),
        "original_key": original_key,
        "annotated_key": annotated_key,
        "detections": detections,
        "demo": bool(demo),
    })


def keys_for(day: str, scan_id: str) -> tuple[str, str]:
    return f"scans/{day}/{scan_id}/original.jpg", f"scans/{day}/{scan_id}/annotated.jpg"


def save_scan(scan_id: str, line: str, original: bytes, annotated: bytes, counts: dict, detections: list,
              inference_ms: int, demo: bool = False, ts: datetime | None = None) -> bool:
    """Upload images and write the DynamoDB item. Returns False if disabled."""
    if not enabled():
        return False
    ts = ts or datetime.now(timezone.utc)
    okey, akey = keys_for(ts.astimezone(timezone.utc).strftime("%Y-%m-%d"), scan_id)
    s3 = _s3()
    s3.put_object(Bucket=bucket(), Key=okey, Body=original, ContentType="image/jpeg")
    s3.put_object(Bucket=bucket(), Key=akey, Body=annotated, ContentType="image/jpeg")
    _table().put_item(Item=build_item(scan_id, ts, line, counts, detections, inference_ms, okey, akey, demo))
    return True


def _query_day(day: str, line: str | None) -> list[dict]:
    kwargs = {"KeyConditionExpression": Key("day").eq(day)}
    if line:
        kwargs["FilterExpression"] = Attr("line").eq(line)
    items, t = [], _table()
    while True:
        r = t.query(**kwargs)
        items += r.get("Items", [])
        if "LastEvaluatedKey" not in r:
            return items
        kwargs["ExclusiveStartKey"] = r["LastEvaluatedKey"]


def _days(n: int) -> list[str]:
    today = datetime.now(timezone.utc).date()
    return [(today - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def _zero_classes() -> dict:
    return {c: 0 for c in CLASSES}


def compute_stats(days: int, line: str | None, items_by_day: dict[str, list[dict]], lines: list[str]) -> dict:
    by_class = _zero_classes()
    by_day, hours = [], [0] * 24
    scans = items = 0
    conf_sum = ms_sum = 0.0
    purity_sum, purity_n = 0.0, 0
    for day in sorted(items_by_day):
        dcounts, dtotal = _zero_classes(), 0
        for it in items_by_day[day]:
            scans += 1
            total = int(it.get("total", 0))
            conf_sum += float(it.get("avg_confidence", 0))
            ms_sum += float(it.get("inference_ms", 0))
            items += total
            dtotal += total
            try:
                hours[int(str(it["ts"])[11:13])] += total
            except (KeyError, ValueError):
                pass
            mx = 0
            for k, v in (it.get("counts") or {}).items():
                v = int(v)
                by_class[k] = by_class.get(k, 0) + v
                dcounts[k] = dcounts.get(k, 0) + v
                mx = max(mx, v)
            if total > 0:
                purity_sum += mx / total * 100
                purity_n += 1
        by_day.append({"day": day, "counts": dcounts, "total": dtotal})
    weight = sum(by_class.get(c, 0) * AVG_ITEM_KG[c] for c in CLASSES)
    value = sum(by_class.get(c, 0) * AVG_ITEM_KG[c] * USD_PER_KG[c] for c in CLASSES)
    top = max(by_class, key=by_class.get) if items else None
    return {
        "range_days": days,
        "line": line,
        "lines": sorted(lines),
        "totals": {
            "scans": scans,
            "items": items,
            "avg_confidence": round(conf_sum / scans, 4) if scans else 0.0,
            "avg_inference_ms": int(round(ms_sum / scans)) if scans else 0,
        },
        "by_class": by_class,
        "by_day": by_day,
        "by_hour": [{"hour": h, "total": hours[h]} for h in range(24)],
        "top_class": top,
        "est_weight_kg": round(weight, 2),
        "est_value_usd": round(value, 2),
        "purity_pct": round(purity_sum / purity_n, 2) if purity_n else 0.0,
    }


def get_stats(days: int, line: str | None) -> dict:
    day_list = _days(days)
    if not enabled():
        return compute_stats(days, line, {d: [] for d in day_list}, [])
    all_items = {d: _query_day(d, None) for d in day_list}
    lines = {it.get("line") for v in all_items.values() for it in v if it.get("line")}
    if line:
        all_items = {d: [i for i in v if i.get("line") == line] for d, v in all_items.items()}
    return compute_stats(days, line, all_items, list(lines))


def get_scans(limit: int, line: str | None, lookback_days: int = 90) -> list[dict]:
    if not enabled():
        return []
    out: list[dict] = []
    for day in reversed(_days(lookback_days)):
        items = sorted(_query_day(day, line), key=lambda i: i["sk"], reverse=True)
        out += items
        if len(out) >= limit:
            break
    s3 = _s3()

    def url(key):
        return s3.generate_presigned_url("get_object", Params={"Bucket": bucket(), "Key": key}, ExpiresIn=URL_TTL)

    return [{
        "id": i["id"], "ts": i["ts"], "line": i.get("line"),
        "counts": {k: int(v) for k, v in (i.get("counts") or {}).items()},
        "total": int(i.get("total", 0)),
        "avg_confidence": float(i.get("avg_confidence", 0)),
        "original_url": url(i["original_key"]),
        "annotated_url": url(i["annotated_key"]),
        "demo": bool(i.get("demo", False)),
    } for i in out[:limit]]
