"""Local live waste detection with OpenCV.

  uv run python scripts/live.py                 # webcam 0
  uv run python scripts/live.py clip.mp4 --headless --save out.mp4
"""
import argparse
import os
import time
from collections import Counter

import cv2

DEFAULT_MODEL = "/Users/tanmay/Desktop/awshack/model/weights/best.pt"
PALETTE = {  # BGR
    "BIODEGRADABLE": (42, 143, 77), "CARDBOARD": (47, 116, 168), "GLASS": (138, 143, 31),
    "METAL": (122, 107, 91), "PAPER": (176, 95, 138), "PLASTIC": (45, 65, 194),
}


def draw(frame, res, names):
    counts = Counter()
    for b in res.boxes:
        cls = names[int(b.cls[0])]
        counts[cls] += 1
        x1, y1, x2, y2 = (int(v) for v in b.xyxy[0].tolist())
        col = PALETTE.get(cls.upper(), (30, 30, 30))
        cv2.rectangle(frame, (x1, y1), (x2, y2), col, 2)
        label = f"{cls} {float(b.conf[0]):.0%}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(frame, (x1, max(0, y1 - th - 6)), (x1 + tw + 4, y1), col, -1)
        cv2.putText(frame, label, (x1 + 2, max(th, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return counts


def overlay(frame, fps, infer_ms, counts):
    lines = [f"FPS {fps:.1f}  infer {infer_ms:.0f} ms"] + [f"{k}: {v}" for k, v in sorted(counts.items())]
    cv2.rectangle(frame, (0, 0), (230, 8 + 20 * len(lines)), (0, 0, 0), -1)
    for i, t in enumerate(lines):
        cv2.putText(frame, t, (6, 18 + 20 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 255, 120), 1, cv2.LINE_AA)


def post_snapshot(url, frame):
    import urllib.request
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return
    boundary = "----live"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"snap.jpg\"\r\n"
            f"Content-Type: image/jpeg\r\n\r\n").encode() + buf.tobytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"[post] {r.status}")
    except Exception as e:
        print(f"[post] failed: {e}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", default="0", help="webcam index or video file path")
    ap.add_argument("--conf", type=float, default=0.4)
    ap.add_argument("--imgsz", type=int, default=416)
    ap.add_argument("--skip", type=int, default=0, help="run YOLO on every (N+1)th frame; reuse last boxes between")
    ap.add_argument("--save", help="write annotated video to this .mp4")
    ap.add_argument("--headless", action="store_true", help="no window")
    ap.add_argument("--max-frames", type=int, default=0, help="stop after N frames (0 = all)")
    ap.add_argument("--post", help="URL of /detect (e.g. http://localhost:8000/detect) to POST a snapshot to")
    ap.add_argument("--post-every", type=float, default=5.0, help="seconds between --post snapshots")
    a = ap.parse_args()

    from ultralytics import YOLO
    model = YOLO(os.getenv("MODEL_PATH", DEFAULT_MODEL))
    model.predict(__import__("numpy").zeros((a.imgsz, a.imgsz, 3), "uint8"), imgsz=a.imgsz, device="cpu", verbose=False)

    src = int(a.source) if a.source.isdigit() else a.source
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise SystemExit(f"Cannot open source: {a.source}")
    is_file = not isinstance(src, int)
    writer = None
    n = infer_n = 0
    infer_total = 0.0
    counts, last_res, last_ms = Counter(), None, 0.0
    t_start = last_post = time.perf_counter()
    fps = 0.0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t0 = time.perf_counter()
        if last_res is None or n % (a.skip + 1) == 0:
            ti = time.perf_counter()
            last_res = model.predict(frame, conf=a.conf, imgsz=a.imgsz, device="cpu", verbose=False)[0]
            last_ms = (time.perf_counter() - ti) * 1000
            infer_total += last_ms
            infer_n += 1
        raw = frame.copy() if a.post else None
        counts = draw(frame, last_res, last_res.names)
        n += 1
        dt = time.perf_counter() - t0
        fps = 0.9 * fps + 0.1 / max(dt, 1e-6) if fps else 1 / max(dt, 1e-6)
        overlay(frame, fps, last_ms, counts)
        if a.save:
            if writer is None:
                h, w = frame.shape[:2]
                writer = cv2.VideoWriter(a.save, cv2.VideoWriter_fourcc(*"mp4v"), 15 if not is_file else (cap.get(cv2.CAP_PROP_FPS) or 15), (w, h))
            writer.write(frame)
        if a.post and time.perf_counter() - last_post >= a.post_every:
            last_post = time.perf_counter()
            post_snapshot(a.post, raw)
        if not a.headless:
            cv2.imshow("Sortline live (q to quit)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
        if a.max_frames and n >= a.max_frames:
            break
    total = time.perf_counter() - t_start
    cap.release()
    if writer:
        writer.release()
    if not a.headless:
        cv2.destroyAllWindows()
    if n:
        print(f"frames={n} yolo_runs={infer_n} imgsz={a.imgsz} skip={a.skip} "
              f"avg_infer_ms={infer_total / max(infer_n, 1):.1f} effective_fps={n / total:.2f}")


if __name__ == "__main__":
    main()
