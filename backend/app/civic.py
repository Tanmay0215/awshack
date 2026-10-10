"""Garbage reports (report -> clean -> AI-verified) and recyclable pickup requests.

Both live in the scans table under fixed partitions ("REPORT", "PICKUP") with sk = id, and their
photos in the results bucket under reports/<id>/ and pickups/<id>/. Requires persistence (store.enabled()).
"""
import re
from datetime import datetime, timezone

from botocore.exceptions import ClientError

from . import store

REPORT_PK, PICKUP_PK = "REPORT", "PICKUP"
ESCALATE_HOURS = 48
PHONE_RE = re.compile(r"^\+?[0-9 ()-]{6,20}$")


class Conflict(Exception):
    """Item is missing or not in the expected status."""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _hours_since(iso: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds() / 3600


def _put_images(prefix: str, original: bytes, annotated: bytes) -> tuple[str, str]:
    s3 = store._s3()
    okey, akey = f"{prefix}.jpg", f"{prefix}_annotated.jpg"
    s3.put_object(Bucket=store.bucket(), Key=okey, Body=original, ContentType="image/jpeg")
    s3.put_object(Bucket=store.bucket(), Key=akey, Body=annotated, ContentType="image/jpeg")
    return okey, akey


def _url(key: str | None) -> str | None:
    if not key:
        return None
    return store._s3().generate_presigned_url(
        "get_object", Params={"Bucket": store.bucket(), "Key": key}, ExpiresIn=store.URL_TTL)


def _get(pk: str, item_id: str) -> dict | None:
    return store._table().get_item(Key={"day": pk, "sk": item_id}).get("Item")


def _put(item: dict, expect_status: str | None = None) -> None:
    kwargs = {"Item": store._dec(item)}
    if expect_status:
        kwargs["ConditionExpression"] = "#s = :s"
        kwargs["ExpressionAttributeNames"] = {"#s": "status"}
        kwargs["ExpressionAttributeValues"] = {":s": expect_status}
    try:
        store._table().put_item(**kwargs)
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise Conflict("status changed, reload and try again")
        raise


def _ints(d) -> dict:
    return {k: int(v) for k, v in (d or {}).items()}


# ---------------------------------------------------------------- reports

def create_report(rid: str, lat: float, lng: float, note: str, original: bytes, annotated: bytes,
                  counts: dict) -> dict:
    okey, akey = _put_images(f"reports/{rid}/before", original, annotated)
    item = {
        "day": REPORT_PK, "sk": rid, "id": rid, "ts": now_iso(), "lat": lat, "lng": lng, "note": note,
        "counts": counts, "total": sum(counts.values()), "status": "open",
        "before_key": okey, "before_annotated_key": akey, "attempts": [],
    }
    _put(item)
    return _public_report(item)


def resolve_report(rid: str, original: bytes, annotated: bytes, counts: dict, worker: str) -> dict:
    """AI verification: the report closes only if the after photo shows no waste."""
    item = _get(REPORT_PK, rid)
    if not item or item.get("status") != "open":
        raise Conflict("report not found or already resolved")
    n = len(item.get("attempts", []))
    okey, akey = _put_images(f"reports/{rid}/after_{n}", original, annotated)
    remaining = sum(counts.values())
    attempt = {"ts": now_iso(), "worker": worker, "counts": counts, "total": remaining,
               "key": okey, "annotated_key": akey, "verified": remaining == 0}
    item["attempts"] = list(item.get("attempts", [])) + [attempt]
    if remaining == 0:
        item.update(status="resolved", resolved_at=attempt["ts"], resolved_by=worker,
                    after_key=okey, after_annotated_key=akey)
    _put(item, expect_status="open")
    return {"verified": remaining == 0, "remaining": remaining, "remaining_counts": counts,
            "report": _public_report(item)}


def _public_report(i: dict) -> dict:
    status = i.get("status", "open")
    age_h = _hours_since(str(i["ts"]))
    attempts = i.get("attempts", [])
    return {
        "id": i["id"], "ts": i["ts"], "lat": float(i["lat"]), "lng": float(i["lng"]), "note": i.get("note", ""),
        "counts": _ints(i.get("counts")), "total": int(i.get("total", 0)), "status": status,
        "age_hours": round(age_h, 1),
        "escalated": status == "open" and age_h >= ESCALATE_HOURS,
        "resolved_at": i.get("resolved_at"), "resolved_by": i.get("resolved_by"),
        "hours_to_clean": round((datetime.fromisoformat(str(i["resolved_at"])) - datetime.fromisoformat(str(i["ts"])))
                                .total_seconds() / 3600, 1) if i.get("resolved_at") else None,
        "failed_attempts": sum(1 for a in attempts if not a.get("verified")),
        "last_remaining": int(attempts[-1]["total"]) if attempts else None,
        "before_url": _url(i.get("before_key")), "before_annotated_url": _url(i.get("before_annotated_key")),
        "after_url": _url(i.get("after_key")), "after_annotated_url": _url(i.get("after_annotated_key")),
    }


def _query(pk: str) -> list[dict]:
    return store._query_day(pk, None)


def list_reports(status: str | None) -> list[dict]:
    items = [i for i in _query(REPORT_PK) if not status or i.get("status") == status]
    items.sort(key=lambda i: str(i["ts"]), reverse=True)
    return [_public_report(i) for i in items]


# ---------------------------------------------------------------- pickups

def estimate_value(counts: dict, weight_kg: float | None) -> tuple[float, float]:
    """(kg, USD). Composition from the photo; total weight from the household if given, else from counts."""
    per = {c.upper(): int(n) * store.AVG_ITEM_KG.get(c.upper(), 0) for c, n in counts.items()}
    est = sum(per.values())
    kg = weight_kg if weight_kg else est
    if est <= 0:
        return round(kg, 2), 0.0
    usd = sum(kg * (w / est) * store.USD_PER_KG.get(c, 0) for c, w in per.items())
    return round(kg, 2), round(usd, 2)


def create_pickup(pid: str, name: str, phone: str, address: str, lat: float, lng: float,
                  weight_kg: float | None, original: bytes, annotated: bytes, counts: dict) -> dict:
    okey, akey = _put_images(f"pickups/{pid}/photo", original, annotated)
    kg, usd = estimate_value(counts, weight_kg)
    item = {
        "day": PICKUP_PK, "sk": pid, "id": pid, "ts": now_iso(), "name": name, "phone": phone,
        "address": address, "lat": lat, "lng": lng, "counts": counts, "total": sum(counts.values()),
        "weight_kg": kg, "weight_given": bool(weight_kg), "est_value_usd": usd, "status": "requested",
        "photo_key": okey, "photo_annotated_key": akey,
    }
    _put(item)
    return _public_pickup(item, reveal=True)


def accept_pickup(pid: str, collector: str) -> dict:
    item = _get(PICKUP_PK, pid)
    if not item or item.get("status") != "requested":
        raise Conflict("pickup not found or already taken")
    item.update(status="accepted", collector=collector, accepted_at=now_iso())
    _put(item, expect_status="requested")
    return _public_pickup(item, reveal=True)


def complete_pickup(pid: str, paid_usd: float | None, actual_kg: float | None) -> dict:
    item = _get(PICKUP_PK, pid)
    if not item or item.get("status") != "accepted":
        raise Conflict("pickup not found or not accepted")
    item.update(status="collected", collected_at=now_iso())
    if paid_usd is not None:
        item["paid_usd"] = paid_usd
    if actual_kg is not None:
        item["actual_kg"] = actual_kg
    _put(item, expect_status="accepted")
    return _public_pickup(item, reveal=True)


def _mask(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return f"****{digits[-3:]}" if digits else ""


def _public_pickup(i: dict, reveal: bool = False) -> dict:
    f = lambda k: float(i[k]) if i.get(k) is not None else None  # noqa: E731
    return {
        "id": i["id"], "ts": i["ts"], "name": i.get("name", ""), "address": i.get("address", ""),
        # The API has no auth: the phone is only returned to whoever accepts the job (and the requester).
        "phone": i.get("phone", "") if reveal else _mask(i.get("phone", "")),
        "lat": float(i["lat"]), "lng": float(i["lng"]), "counts": _ints(i.get("counts")),
        "total": int(i.get("total", 0)), "weight_kg": f("weight_kg"), "weight_given": bool(i.get("weight_given")),
        "est_value_usd": f("est_value_usd"), "status": i.get("status"), "collector": i.get("collector"),
        "accepted_at": i.get("accepted_at"), "collected_at": i.get("collected_at"),
        "paid_usd": f("paid_usd"), "actual_kg": f("actual_kg"),
        "photo_url": _url(i.get("photo_key")), "photo_annotated_url": _url(i.get("photo_annotated_key")),
    }


def list_pickups(status: str | None) -> list[dict]:
    items = [i for i in _query(PICKUP_PK) if not status or i.get("status") == status]
    items.sort(key=lambda i: str(i["ts"]), reverse=True)
    return [_public_pickup(i) for i in items]


def summary() -> dict:
    reports, pickups = _query(REPORT_PK), _query(PICKUP_PK)
    resolved = [r for r in reports if r.get("status") == "resolved"]
    hours = [_public_report(r)["hours_to_clean"] for r in resolved]
    collected = [p for p in pickups if p.get("status") == "collected"]
    return {
        "reports": {
            "total": len(reports), "open": len(reports) - len(resolved), "resolved": len(resolved),
            "escalated": sum(1 for r in reports if r.get("status") == "open" and _hours_since(str(r["ts"])) >= ESCALATE_HOURS),
            "avg_hours_to_clean": round(sum(hours) / len(hours), 1) if hours else None,
            "items_removed": sum(int(r.get("total", 0)) for r in resolved),
        },
        "pickups": {
            "total": len(pickups), "requested": sum(1 for p in pickups if p.get("status") == "requested"),
            "accepted": sum(1 for p in pickups if p.get("status") == "accepted"), "collected": len(collected),
            "kg_recovered": round(sum(float(p.get("actual_kg") or p.get("weight_kg") or 0) for p in collected), 2),
            "paid_usd": round(sum(float(p.get("paid_usd") or 0) for p in collected), 2),
        },
    }
