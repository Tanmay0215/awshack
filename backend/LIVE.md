# Live detection

Can it be done with OpenCV? Yes for capture, drawing and local use; the model is still YOLOv8s on CPU, so speed is set by inference, not OpenCV.

## Local script (OpenCV window)
```
cd backend
uv run python scripts/live.py                       # webcam 0, q to quit
uv run python scripts/live.py clip.mp4 --imgsz 416 --skip 1 --save out.mp4
uv run python scripts/live.py clip.mp4 --headless --max-frames 90     # no window
uv run python scripts/live.py 0 --post http://localhost:8000/detect --post-every 5   # optional snapshot POST
```
Flags: `--conf` (0.4), `--imgsz` (416), `--skip N` (infer every N+1th frame, reuse boxes between), `--save`, `--headless`, `--max-frames`.
Weights come from `MODEL_PATH` (default `model/weights/best.pt`).

## Browser live mode (/live)
The page opens the webcam (`getUserMedia`, rear camera preferred on phones), downscales each frame to max 480 px JPEG and POSTs it to `/api/detect-frame`
(imgsz 416). Only after the response arrives does it grab the next frame (no overlapping requests). The server replies with boxes only
(no annotated image, nothing saved to S3/DynamoDB) and the page draws them on a canvas over the video. If the model lock is busy the server
returns 429 immediately and the page waits 150 ms. Requires HTTPS or localhost (prod: https://sortline.dsabuddy.com is fine).

## Measured (Apple M4 Mac, CPU, 640x480 test clip, 90 frames; not the prod box)
| imgsz | YOLO ms | live.py effective FPS | /detect-frame inference_ms (480x360 JPEG) |
|---|---|---|---|
| 640 | 52 | 18.8 | 52 |
| 416 | 25 | 37.9 | 24 |
| 320 | 16 | 57.6 | 18 |
`--skip 2` at 416: 112 FPS displayed (YOLO ran on 1/3 of frames). curl loop incl. process spawn: 16.6 / 30 / 37 req/s.
With 4 simultaneous requests: 1 got 200, 3 got 429 (lock behaviour verified).

## Expected on prod (c7i-flex.large, 2 vCPU, CPU torch) - estimates, not measured
Existing prod figure is 55-190 ms/image at 640. Cost scales roughly with pixels, so imgsz 416 is about 0.4x: roughly 60-90 ms inference.
Add JPEG upload + decode + RTT (20-80 ms): about 5-8 FPS for ONE viewer at 416, 3-5 FPS at 640. Detections lag the video by roughly 150-250 ms (boxes lag moving items).
Concurrent viewers share one lock: total throughput stays ~10-14 inferences/s, so 2 viewers get ~3-6 FPS each, 4 viewers ~2-3 FPS each with many 429s.
Live viewers also starve the normal /detect upload endpoint of the lock (it blocks, live requests are dropped).

## Limits and scaling options
- One shared model + lock: ~1 viewer is realistic, 2-3 tolerable. Not a multi-user live service as deployed.
- Lower `imgsz` (320), client-side frame skipping, or lower send resolution.
- Export to ONNX / OpenVINO (typically 1.5-3x faster on Intel CPUs) - not tried here.
- Bigger instance (more vCPUs), or yolov8n (the repo has yolov8n.pt, but it is not trained on these classes).

## Not verified
- No real webcam test: the OpenCV script was run on a generated mp4 only; the browser page was only compiled (`npm run build`), never exercised in a browser with a camera (permission, facingMode, canvas alignment untested).
- Prod numbers above are extrapolations; no EC2 benchmark was run. Caddy `/api/*` proxy path was not tested locally.
