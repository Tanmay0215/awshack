import asyncio
import base64
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import store

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


def _persist(scan_id, line, data, img, result):
    try:
        # Store the original as JPEG (re-encode PNG/WebP uploads).
        original = data
        if data[:3] != b"\xff\xd8\xff":
            ok, b = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
            original = b.tobytes() if ok else data
        store.save_scan(scan_id, line, original, result["_annotated"], result["counts"],
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
    if app.state.model is None:
        raise HTTPException(503, "Model not loaded")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File exceeds 10MB limit")
    if not data or not _sniff(data):
        raise HTTPException(415, "Only jpg, png or webp images are supported")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    if img.shape[0] * img.shape[1] > MAX_PIXELS:
        raise HTTPException(413, "Image dimensions too large")
    result = await asyncio.to_thread(_run, app.state.model, app.state.lock, img, conf)
    scan_id = store.new_scan_id()
    if store.enabled():
        await _persist_async(scan_id, line, data, img, result)
    result.pop("_annotated")
    result["scan_id"] = scan_id
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
    if app.state.model is None:
        raise HTTPException(503, "Model not loaded")
    data = await file.read(MAX_FRAME_BYTES + 1)
    if len(data) > MAX_FRAME_BYTES:
        raise HTTPException(413, "Frame exceeds 1MB limit")
    if not data or not _sniff(data):
        raise HTTPException(415, "Only jpg, png or webp images are supported")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    if img.shape[0] * img.shape[1] > MAX_PIXELS:
        raise HTTPException(413, "Image dimensions too large")
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
