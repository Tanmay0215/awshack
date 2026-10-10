'use client';

import { useCallback, useEffect, useState } from 'react';
import { resizeImage, validateFile } from '@/lib/api';
import { Pickup, createPickup, listPickups, locate, remember, remembered } from '@/lib/civic';
import { fmtKg } from '@/lib/guidance';
import MapView from '@/app/_components/MapView';
import { Alert, Box, Chips, PhotoField, Shell, btn, btnAlt, field, labelCls } from '@/app/_components/ui';

const KEY = 'sortline-my-pickups';
const STEPS = ['requested', 'accepted', 'collected'] as const;
const money = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `$${v.toFixed(2)}`);

function Progress({ p }: { p: Pickup }) {
  const at = STEPS.indexOf(p.status);
  return (
    <ol className="flex gap-1 text-[10px] font-bold uppercase tracking-wider">
      {STEPS.map((s, i) => <li key={s} className={`flex-1 border-2 border-ink px-1 py-0.5 text-center ${i <= at ? 'bg-ink text-lime' : 'bg-sheet text-ink/50'}`}>{s}</li>)}
    </ol>
  );
}

export default function PickupPage() {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [weight, setWeight] = useState('');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Pickup[]>([]);

  const load = useCallback(async () => {
    const ids = remembered(KEY);
    if (!ids.length) return;
    try { setMine((await listPickups()).pickups.filter((p) => ids.includes(p.id))); } catch {}
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  async function useMyLocation() {
    setError(null);
    try { setPos(await locate()); } catch (e) { setError((e as Error).message); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !pos) return;
    const bad = validateFile(file);
    if (bad) { setError(bad); return; }
    const w = weight ? Number(weight) : undefined;
    if (w !== undefined && !(w > 0 && w <= 1000)) { setError('Weight must be between 0 and 1000 kg.'); return; }
    setBusy(true); setError(null);
    try {
      const { pickup } = await createPickup({ file: await resizeImage(file), name, phone, address, lat: pos.lat, lng: pos.lng, weight_kg: w });
      remember(KEY, pickup.id);
      setMine((m) => [pickup, ...m]);
      setFile(null); setWeight('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create the request.'); }
    finally { setBusy(false); }
  }

  return (
    <Shell kicker="Households / sell sorted recyclables" title="Sell your" accent="Waste">
      <p className="mb-6 max-w-3xl text-sm">
        Sorted recyclables are worth money, but only if they reach a recycler. Photograph your sorted bag: the AI works out what is in it and
        what it is worth, and nearby scrap collectors get a pickup request. Segregating now pays, and the material never reaches landfill.
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Box title="Request a pickup">
          <form onSubmit={submit} className="space-y-4">
            <PhotoField file={file} onFile={setFile} label="Photo of your sorted recyclables" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className={labelCls}>Name</label>
                <input id="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${field}`} />
              </div>
              <div>
                <label htmlFor="phone" className={labelCls}>Phone</label>
                <input id="phone" required type="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} className={`mt-1 ${field}`} />
              </div>
            </div>
            <div>
              <label htmlFor="address" className={labelCls}>Address / landmark</label>
              <input id="address" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className={`mt-1 ${field}`} />
            </div>
            <div>
              <label htmlFor="weight" className={labelCls}>Approx. weight in kg (optional, improves the estimate)</label>
              <input id="weight" type="number" min="0.1" max="1000" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} className={`mt-1 ${field}`} />
            </div>
            <div>
              <span className={labelCls}>Pickup location</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button type="button" onClick={useMyLocation} className={btnAlt}>Use my location</button>
                <span className="text-xs">{pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : 'or tap the map'}</span>
              </div>
              <MapView points={[]} pick={pos} onPick={setPos} className="mt-2 h-56" />
            </div>
            <button type="submit" disabled={!file || !pos || !name || !phone || busy} className={`w-full ${btn}`}>{busy ? 'Checking photo...' : 'Request pickup'}</button>
            {error && <Alert>{error}</Alert>}
          </form>
        </Box>

        <Box title="My requests">
          {mine.length === 0 && <p className="text-sm text-ink/70">Requests you make on this device show up here with live status.</p>}
          <ul className="space-y-4">
            {mine.map((p) => (
              <li key={p.id} className="border-2 border-ink bg-white p-3">
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.photo_annotated_url && <img src={p.photo_annotated_url} alt="Your recyclables" className="h-24 w-32 shrink-0 border border-ink/30 object-cover" />}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-display text-3xl font-black leading-none">{money(p.paid_usd ?? p.est_value_usd)}</p>
                    <p className="text-xs">{p.status === 'collected' && p.paid_usd !== null ? 'paid' : 'estimated'} for {fmtKg(p.actual_kg ?? p.weight_kg ?? 0)}{p.weight_given || p.actual_kg ? '' : ' (estimated from the photo)'}</p>
                    <Chips counts={p.counts} />
                  </div>
                </div>
                <div className="mt-3"><Progress p={p} /></div>
                {p.collector && <p className="mt-2 text-xs">Collector: <strong>{p.collector}</strong>{p.status === 'accepted' && ' is on the way'}</p>}
              </li>
            ))}
          </ul>
        </Box>
      </div>
      <p className="mt-4 text-xs text-ink/70">Values use rough per-material scrap prices; the collector confirms the final weight and price at pickup.</p>
    </Shell>
  );
}
