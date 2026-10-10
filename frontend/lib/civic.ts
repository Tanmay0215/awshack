import { url } from './api';

export type Report = {
  id: string; ts: string; lat: number; lng: number; note: string;
  counts: Record<string, number>; total: number; status: 'open' | 'resolved';
  age_hours: number; escalated: boolean; resolved_at: string | null; resolved_by: string | null;
  hours_to_clean: number | null; failed_attempts: number; last_remaining: number | null;
  before_url: string | null; before_annotated_url: string | null;
  after_url: string | null; after_annotated_url: string | null;
};
export type Pickup = {
  id: string; ts: string; name: string; address: string; phone: string; lat: number; lng: number;
  counts: Record<string, number>; total: number; weight_kg: number | null; weight_given: boolean;
  est_value_usd: number | null; status: 'requested' | 'accepted' | 'collected'; collector: string | null;
  accepted_at: string | null; collected_at: string | null; paid_usd: number | null; actual_kg: number | null;
  photo_url: string | null; photo_annotated_url: string | null;
};
export type ResolveResult = { verified: boolean; remaining: number; remaining_counts: Record<string, number>; report: Report; annotated_image: string };
export type CivicSummary = {
  reports: { total: number; open: number; resolved: number; escalated: number; avg_hours_to_clean: number | null; items_removed: number };
  pickups: { total: number; requested: number; accepted: number; collected: number; kg_recovered: number; paid_usd: number };
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), { cache: 'no-store', ...init });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const j = await res.json(); if (typeof j?.detail === 'string') msg = j.detail; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function form(fields: Record<string, string | Blob | number | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === '') continue;
    fd.append(k, typeof v === 'number' ? String(v) : v);
  }
  return fd;
}
const post = <T,>(path: string, fields: Parameters<typeof form>[0]) => call<T>(path, { method: 'POST', body: form(fields) });

export const createReport = (file: File, lat: number, lng: number, note: string) =>
  post<{ report: Report }>('/reports', { file, lat, lng, note });
export const listReports = (status?: 'open' | 'resolved') =>
  call<{ reports: Report[] }>(`/reports${status ? `?status=${status}` : ''}`);
export const resolveReport = (id: string, file: File, worker: string) =>
  post<ResolveResult>(`/reports/${id}/resolve`, { file, worker });

export const createPickup = (f: { file: File; name: string; phone: string; address: string; lat: number; lng: number; weight_kg?: number }) =>
  post<{ pickup: Pickup }>('/pickups', f);
export const listPickups = (status?: Pickup['status']) =>
  call<{ pickups: Pickup[] }>(`/pickups${status ? `?status=${status}` : ''}`);
export const acceptPickup = (id: string, collector: string) =>
  post<{ pickup: Pickup }>(`/pickups/${id}/accept`, { collector });
export const completePickup = (id: string, paid_usd?: number, actual_kg?: number) =>
  post<{ pickup: Pickup }>(`/pickups/${id}/complete`, { paid_usd, actual_kg });
export const getSummary = () => call<CivicSummary>('/civic/summary');

/** Browser geolocation as a promise. */
export function locate(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available in this browser.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error('Could not get your location. Allow location access or tap the map.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

/** Distance in km between two points (haversine). */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

export const ago = (hours: number) => (hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`);

/** Remember ids this browser created or claimed (no accounts). */
export function remembered(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
}
export function remember(key: string, id: string) {
  try { localStorage.setItem(key, JSON.stringify([id, ...remembered(key).filter((x) => x !== id)].slice(0, 50))); } catch {}
}
export function savedText(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
export function saveText(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch {}
}
