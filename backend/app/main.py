import asyncio
import base64
import logging
import os
import re
import threading
import time
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import civic, store

log = logging.getLogger("waste-api")

MODEL_PATH = os.getenv("MODEL_PATH", "/models/best.pt")
MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 50_000_000
IMGSZ = int(os.getenv("IMGSZ", "640"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]


def _sniff(data: bytes) -> bool:
    """Accept only JPEG, PNG or WebP by magic bytes."""
    return (
        data[:3] == b"\xff\xd8\xff"
        or data[:8] == b"\x89PNG\r\n\x1a\n"
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.model = None
    app.state.lock = threading.Lock()  # ultralytics predictors are not thread-safe
    if os.path.isfile(MODEL_PATH):
        from ultralytics import YOLO

        def _load():
            m = YOLO(MODEL_PATH)
            m.predict(np.zeros((IMGSZ, IMGSZ, 3), np.uint8), device="cpu", verbose=False)  # warm-up
            return m

        app.state.model = await asyncio.to_thread(_load)
        log.info("Model loaded from %s", MODEL_PATH)
    else:
        log.error("Model file not found at %s", MODEL_PATH)
    yield


app = FastAPI(title="Waste Detection API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*", "x-amz-content-sha256"],
)


def _run(model, lock, img: np.ndarray, conf: float) -> dict:
    t0 = time.perf_counter()
    with lock:
        res = model.predict(img, conf=conf, imgsz=IMGSZ, device="cpu", verbose=False)[0]
    ms = int((time.perf_counter() - t0) * 1000)

    names = res.names
    detections, counts = [], {}
    for b in res.boxes:
        cls = names[int(b.cls[0])]
        x1, y1, x2, y2 = (round(float(v), 1) for v in b.xyxy[0].tolist())
        detections.append({"class": cls, "confidence": round(float(b.conf[0]), 4), "box": [x1, y1, x2, y2]})
        counts[cls] = counts.get(cls, 0) + 1

    ok, buf = cv2.imencode(".jpg", res.plot(), [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise RuntimeError("failed to encode annotated image")
    return {
        "detections": detections,
        "counts": counts,
        "image": "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode(),
        "inference_ms": ms,
        "_annotated": buf.tobytes(),
    }


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": app.state.model is not None}


async def _load_image(file: UploadFile, max_bytes: int) -> tuple[bytes, np.ndarray]:
    """Read and validate an uploaded image. Also checks the model is loaded."""
    if app.state.model is None:
        raise HTTPException(503, "Model not loaded")
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"File exceeds {max_bytes // (1024 * 1024)}MB limit")
    if not data or not _sniff(data):
        raise HTTPException(415, "Only jpg, png or webp images are supported")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    if img.shape[0] * img.shape[1] > MAX_PIXELS:
        raise HTTPException(413, "Image dimensions too large")
    return data, img


def _as_jpeg(data: bytes, img: np.ndarray) -> bytes:
    """Store originals as JPEG (re-encode PNG/WebP uploads)."""
    if data[:3] == b"\xff\xd8\xff":
        return data
    ok, b = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return b.tobytes() if ok else data


def _persist(scan_id, line, data, img, result):
    try:
        store.save_scan(scan_id, line, _as_jpeg(data, img), result["_annotated"], result["counts"],
                        result["detections"], result["inference_ms"])
    except Exception:
        log.exception("Failed to persist scan %s", scan_id)


@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    conf: float = Query(0.4, ge=0.05, le=1.0),
    line: str = Query("line-1"),
):
    if not store.LINE_RE.match(line):
        raise HTTPException(422, "line must match [A-Za-z0-9_-]{1,32}")
    data, img = await _load_image(file, MAX_BYTES)
    result = await asyncio.to_thread(_run, app.state.model, app.state.lock, img, conf)
    scan_id = store.new_scan_id()
    if store.enabled():
        await _persist_async(scan_id, line, data, img, result)
    result.pop("_annotated")
    result["scan_id"] = scan_id
    result["impact"] = store.impact(result["counts"])
    return result


async def _persist_async(scan_id, line, data, img, result):
    await asyncio.to_thread(_persist, scan_id, line, data, img, result)


MAX_FRAME_BYTES = 1024 * 1024


def _run_frame(model, lock, img: np.ndarray, conf: float, imgsz: int):
    """Non-blocking inference for live mode. Returns None if the model is busy."""
    if not lock.acquire(blocking=False):
        return None
    try:
        t0 = time.perf_counter()
        res = model.predict(img, conf=conf, imgsz=imgsz, device="cpu", verbose=False)[0]
        ms = int((time.perf_counter() - t0) * 1000)
    finally:
        lock.release()
    detections, counts = [], {}
    for b in res.boxes:
        cls = res.names[int(b.cls[0])]
        x1, y1, x2, y2 = (round(float(v), 1) for v in b.xyxy[0].tolist())
        detections.append({"class": cls, "confidence": round(float(b.conf[0]), 4), "box": [x1, y1, x2, y2]})
        counts[cls] = counts.get(cls, 0) + 1
    return {"detections": detections, "counts": counts, "inference_ms": ms}


@app.post("/detect-frame")
async def detect_frame(
    file: UploadFile = File(...),
    conf: float = Query(0.4, ge=0.05, le=1.0),
    imgsz: int = Query(416, ge=160, le=1280),
):
    """Lightweight live-mode endpoint: no annotated image, no persistence; 429 if the model is busy."""
    _, img = await _load_image(file, MAX_FRAME_BYTES)
    imgsz = max(32, imgsz // 32 * 32)
    result = await asyncio.to_thread(_run_frame, app.state.model, app.state.lock, img, conf, imgsz)
    if result is None:
        raise HTTPException(429, "Model busy", headers={"Retry-After": "1"})
    result["width"], result["height"] = int(img.shape[1]), int(img.shape[0])
    return result


@app.get("/stats")
async def stats(days: int = Query(7, ge=1, le=90), line: str | None = Query(None)):
    line = line or None
    if line is not None and not store.LINE_RE.match(line):
        raise HTTPException(422, "line must match [A-Za-z0-9_-]{1,32}")
    try:
        return await asyncio.to_thread(store.get_stats, days, line)
    except Exception:
        log.exception("stats failed")
        raise HTTPException(502, "Failed to read scan store")


@app.get("/scans")
async def scans(limit: int = Query(24, ge=1, le=100), line: str | None = Query(None)):
    line = line or None
    if line is not None and not store.LINE_RE.match(line):
        raise HTTPException(422, "line must match [A-Za-z0-9_-]{1,32}")
    try:
        return {"scans": await asyncio.to_thread(store.get_scans, limit, line)}
    except Exception:
        log.exception("scans failed")
        raise HTTPException(502, "Failed to read scan store")


# ------------------------------------------------------------- reports and pickups

CIVIC_CONF = 0.35
TEXT_MAX = 300


def _need_store():
    if not store.enabled():
        raise HTTPException(503, "Storage is not configured")


def _clean(text: str, field: str, required: bool = False) -> str:
    text = " ".join(text.split())
    if len(text) > TEXT_MAX:
        raise HTTPException(422, f"{field} is too long (max {TEXT_MAX} characters)")
    if required and not text:
        raise HTTPException(422, f"{field} is required")
    return text


def _coords(lat: float, lng: float):
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "Invalid location")


async def _civic_detect(file: UploadFile) -> tuple[bytes, dict]:
    data, img = await _load_image(file, MAX_BYTES)
    result = await asyncio.to_thread(_run, app.state.model, app.state.lock, img, CIVIC_CONF)
    return _as_jpeg(data, img), result


async def _call(fn, *args):
    try:
        return await asyncio.to_thread(fn, *args)
    except civic.Conflict as e:
        raise HTTPException(409, str(e))
    except HTTPException:
        raise
    except Exception:
        log.exception("%s failed", fn.__name__)
        raise HTTPException(502, "Failed to access storage")


@app.post("/reports")
async def create_report(file: UploadFile = File(...), lat: float = Form(...), lng: float = Form(...),
                        note: str = Form("")):
    """Citizen reports a garbage spot: photo + GPS. The model tags what is in the pile."""
    _need_store()
    _coords(lat, lng)
    note = _clean(note, "note")
    original, r = await _civic_detect(file)
    report = await _call(civic.create_report, store.new_scan_id(), lat, lng, note, original, r["_annotated"], r["counts"])
    return {"report": report, "detections": r["detections"]}


@app.get("/reports")
async def list_reports(status: str | None = Query(None, pattern="^(open|resolved)$")):
    _need_store()
    return {"reports": await _call(civic.list_reports, status)}


@app.post("/reports/{rid}/resolve")
async def resolve_report(rid: str, file: UploadFile = File(...), worker: str = Form(...)):
    """Cleanup crew uploads an after photo. Closes only if the model finds no waste left."""
    _need_store()
    if not re.fullmatch(r"[0-9a-f]{32}", rid):
        raise HTTPException(404, "Report not found")
    worker = _clean(worker, "worker", required=True)
    original, r = await _civic_detect(file)
    out = await _call(civic.resolve_report, rid, original, r["_annotated"], r["counts"], worker)
    out["annotated_image"] = r["image"]
    return out


@app.post("/pickups")
async def create_pickup(file: UploadFile = File(...), name: str = Form(...), phone: str = Form(...),
                        address: str = Form(""), lat: float = Form(...), lng: float = Form(...),
                        weight_kg: float | None = Form(None)):
    """Household asks a recycler to collect its sorted recyclables. The photo sets composition and value."""
    _need_store()
    _coords(lat, lng)
    name = _clean(name, "name", required=True)
    address = _clean(address, "address")
    if not civic.PHONE_RE.match(phone.strip()):
        raise HTTPException(422, "Invalid phone number")
    if weight_kg is not None and not (0 < weight_kg <= 1000):
        raise HTTPException(422, "weight_kg must be between 0 and 1000")
    original, r = await _civic_detect(file)
    if not r["counts"]:
        raise HTTPException(422, "No recyclables detected in the photo. Try a clearer photo of the sorted waste.")
    pickup = await _call(civic.create_pickup, store.new_scan_id(), name, phone.strip(), address, lat, lng,
                         weight_kg, original, r["_annotated"], r["counts"])
    return {"pickup": pickup, "detections": r["detections"]}


@app.get("/pickups")
async def list_pickups(status: str | None = Query(None, pattern="^(requested|accepted|collected)$")):
    _need_store()
    return {"pickups": await _call(civic.list_pickups, status)}


def _pid(pid: str):
    if not re.fullmatch(r"[0-9a-f]{32}", pid):
        raise HTTPException(404, "Pickup not found")


@app.post("/pickups/{pid}/accept")
async def accept_pickup(pid: str, collector: str = Form(...)):
    _need_store()
    _pid(pid)
    return {"pickup": await _call(civic.accept_pickup, pid, _clean(collector, "collector", required=True))}


@app.post("/pickups/{pid}/complete")
async def complete_pickup(pid: str, paid_usd: float | None = Form(None), actual_kg: float | None = Form(None)):
    _need_store()
    _pid(pid)
    for v, n in ((paid_usd, "paid_usd"), (actual_kg, "actual_kg")):
        if v is not None and not (0 <= v <= 100000):
            raise HTTPException(422, f"{n} out of range")
    return {"pickup": await _call(civic.complete_pickup, pid, paid_usd, actual_kg)}


@app.get("/civic/summary")
async def civic_summary():
    _need_store()
    return await _call(civic.summary)
