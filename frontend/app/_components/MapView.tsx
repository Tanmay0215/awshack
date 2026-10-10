'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';

export type MapPoint = { id: string; lat: number; lng: number; color: string; label: string };
type LatLng = { lat: number; lng: number };

/** OpenStreetMap with circle markers. Leaflet needs `window`, so it is imported on mount. */
export default function MapView({ points, pick, onPick, className = 'h-72' }: {
  points: MapPoint[]; pick?: LatLng | null; onPick?: (p: LatLng) => void; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const pin = useRef<Leaflet.CircleMarker | null>(null);
  const fitted = useRef(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let alive = true;
    import('leaflet').then((mod) => {
      if (!alive || !el.current || map.current) return;
      L.current = mod;
      const m = mod.map(el.current, { scrollWheelZoom: false }).setView([20, 0], 2);
      mod.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
      }).addTo(m);
      m.on('click', (e: Leaflet.LeafletMouseEvent) => onPickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      layer.current = mod.layerGroup().addTo(m);
      map.current = m;
      draw();
    });
    return () => { alive = false; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const mod = L.current, m = map.current, g = layer.current;
    if (!mod || !m || !g) return;
    g.clearLayers();
    for (const p of points) {
      mod.circleMarker([p.lat, p.lng], { radius: 9, color: '#16201a', weight: 2, fillColor: p.color, fillOpacity: 0.9 })
        .bindTooltip(p.label).addTo(g);
    }
    pin.current?.remove();
    pin.current = pick ? mod.circleMarker([pick.lat, pick.lng], { radius: 11, color: '#b4491f', weight: 4, fillColor: '#c6e03a', fillOpacity: 1 }).addTo(m) : null;
    if (pick) m.setView([pick.lat, pick.lng], Math.max(m.getZoom(), 15));
    else if (!fitted.current && points.length) {
      fitted.current = true;
      m.fitBounds(mod.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.3), { maxZoom: 15 });
    }
  }

  useEffect(draw, [points, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={`z-0 w-full border-2 border-ink ${className}`} role="application" aria-label={onPick ? 'Map: tap to set the location' : 'Map'} />;
}
