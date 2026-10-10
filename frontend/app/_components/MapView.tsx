'use client';

/// <reference types="google.maps" />
import { useEffect, useRef, useState } from 'react';

export type MapPoint = { id: string; lat: number; lng: number; color: string; label: string };
type LatLng = { lat: number; lng: number };

export const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? '';
let loader: Promise<typeof google.maps> | null = null;

/** Load the Maps JavaScript API once per page. */
export function loadMaps(): Promise<typeof google.maps> {
  if (typeof google !== 'undefined' && google.maps?.Map) return Promise.resolve(google.maps);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const cb = '__sortlineMapsReady';
      (window as unknown as Record<string, () => void>)[cb] = () => resolve(google.maps);
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=${cb}`;
      s.async = true;
      s.onerror = () => { loader = null; reject(new Error('Google Maps failed to load')); };
      document.head.appendChild(s);
    });
  }
  return loader;
}

const dot = (g: typeof google.maps, color: string, scale = 9, stroke = '#16201a', weight = 2): google.maps.Symbol => ({
  path: g.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 0.95, strokeColor: stroke, strokeWeight: weight,
});

/** Google Map with coloured circle markers and an optional tap-to-pick pin. */
export default function MapView({ points, pick, onPick, className = 'h-72' }: {
  points: MapPoint[]; pick?: LatLng | null; onPick?: (p: LatLng) => void; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const g = useRef<typeof google.maps | null>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const pin = useRef<google.maps.Marker | null>(null);
  const info = useRef<google.maps.InfoWindow | null>(null);
  const fitted = useRef(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(KEY ? null : 'Map unavailable: Google Maps key not configured.');

  useEffect(() => {
    if (!KEY) return;
    let alive = true;
    loadMaps().then((maps) => {
      if (!alive || !el.current) return;
      g.current = maps;
      map.current = new maps.Map(el.current, {
        center: { lat: 20, lng: 0 }, zoom: 2, mapTypeControl: false, streetViewControl: false,
        fullscreenControl: true, gestureHandling: 'cooperative', clickableIcons: false,
      });
      info.current = new maps.InfoWindow();
      map.current.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (e.latLng) onPickRef.current?.({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
      setReady(true);
    }).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const maps = g.current, m = map.current;
    if (!ready || !maps || !m) return;
    markers.current.forEach((mk) => mk.setMap(null));
    markers.current = points.map((p) => {
      const mk = new maps.Marker({ position: { lat: p.lat, lng: p.lng }, map: m, title: p.label, icon: dot(maps, p.color) });
      mk.addListener('click', () => { info.current?.setContent(p.label); info.current?.open({ map: m, anchor: mk }); });
      return mk;
    });
    pin.current?.setMap(null);
    pin.current = pick
      ? new maps.Marker({ position: pick, map: m, title: 'Selected location', icon: dot(maps, '#c6e03a', 11, '#b4491f', 4), zIndex: 999 })
      : null;
    if (pick) {
      m.panTo(pick);
      if ((m.getZoom() ?? 0) < 15) m.setZoom(15);
    } else if (!fitted.current && points.length) {
      fitted.current = true;
      const b = new maps.LatLngBounds();
      points.forEach((p) => b.extend(p));
      m.fitBounds(b, 60);
      if (points.length === 1) maps.event.addListenerOnce(m, 'idle', () => m.setZoom(15));
    }
  }, [ready, points, pick]);

  return (
    <div className={`relative w-full border-2 border-ink bg-ink/10 ${className}`}>
      <div ref={el} className="h-full w-full" role="application" aria-label={onPick ? 'Map: tap to set the location' : 'Map'} />
      {error && <p role="alert" className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-rust">{error}</p>}
    </div>
  );
}
