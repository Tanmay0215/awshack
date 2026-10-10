export type Impact = { weight_kg: number; co2e_kg: number; car_km: number; tree_days: number };
export type Detection = { class: string; confidence: number; box: [number, number, number, number] };
export type DetectResult = {
  detections: Detection[];
  counts: Record<string, number>;
  image: string;
  inference_ms: number;
  scan_id?: string;
  impact?: Impact;
};

export type Stats = {
  range_days: number;
  totals: { scans: number; items: number; avg_confidence: number; avg_inference_ms: number };
  by_class: Record<string, number>;
  by_day: { day: string; counts: Record<string, number>; total: number }[];
  by_hour: { hour: number; total: number }[];
  top_class: string | null;
  est_weight_kg: number;
  est_value_usd: number;
  purity_pct: number;
  est_co2e_kg: number;
  co2e_by_class: Record<string, number>;
  car_km: number;
  tree_days: number;
};
export type Scan = {
  id: string; ts: string; counts: Record<string, number>; total: number;
  avg_confidence: number; original_url: string; annotated_url: string; demo: boolean;
};

export const CLASSES = ['BIODEGRADABLE', 'CARDBOARD', 'GLASS', 'METAL', 'PAPER', 'PLASTIC'] as const;
export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const BASE = (process.env.NEXT_PUBLIC_API_BASE ?? '').replace(/\/$/, '');
// Same-origin (CloudFront) uses /api/*; a direct backend base serves routes without the /api prefix.
export const url = (path: string) => (BASE ? `${BASE}${path}` : `/api${path}`);

export function validateFile(f: File): string | null {
  if (!ALLOWED.includes(f.type)) return 'Unsupported file type. Use JPG, PNG or WebP.';
  if (f.size > MAX_BYTES) return 'File is larger than 10 MB.';
  return null;
}

export async function detect(file: File, confPct: number, signal?: AbortSignal): Promise<DetectResult> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${url('/detect')}?conf=${(confPct / 100).toFixed(2)}`, {
    method: 'POST',
    body: fd,
    signal,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export type FrameResult = {
  detections: Detection[];
  counts: Record<string, number>;
  inference_ms: number;
  width: number;
  height: number;
};

/** Live mode: small JPEG in, boxes out. Throws Error('busy') on 429 so the caller can back off. */
export async function detectFrame(blob: Blob, confPct: number, signal?: AbortSignal): Promise<FrameResult> {
  const fd = new FormData();
  fd.append('file', blob, 'frame.jpg');
  const res = await fetch(`${url('/detect-frame')}?conf=${(confPct / 100).toFixed(2)}&imgsz=416`, { method: 'POST', body: fd, signal });
  if (res.status === 429) throw new Error('busy');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function health(): Promise<boolean> {
  try { return (await fetch(url('/health'))).ok; } catch { return false; }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url(path), { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}
export const getStats = (days: number, signal?: AbortSignal) =>
  getJson<Stats>(`/stats?days=${days}`, signal);
export const getScans = (limit = 24, signal?: AbortSignal) =>
  getJson<{ scans: Scan[] }>(`/scans?limit=${limit}`, signal);

/** Downscale to max 1600px longest side, JPEG q0.85 (Lambda body cap ~6MB). Falls back to the original on failure. */
export async function resizeImage(file: File, max = 1600): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
