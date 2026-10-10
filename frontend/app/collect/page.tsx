'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CivicSummary, Pickup, acceptPickup, ago, completePickup, getSummary, km, listPickups, locate, mapsLink, remember, remembered, savedText, saveText } from '@/lib/civic';
import { fmtKg } from '@/lib/guidance';
import MapView, { MapPoint } from '@/app/_components/MapView';
import { Alert, Chips, Shell, Stat, btn, btnAlt, field, labelCls } from '@/app/_components/ui';

const KEY = 'sortline-my-jobs';
const money = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `$${v.toFixed(2)}`);
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3.6e6;

function Card({ p, me, here, revealed, onChange }: {
  p: Pickup; me: string; here: { lat: number; lng: number } | null; revealed?: Pickup; onChange: (p: Pickup) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState('');
  const [kg, setKg] = useState('');
  const shown = revealed ?? p;

  async function act(fn: () => Promise<{ pickup: Pickup }>) {
    setBusy(true); setError(null);
    try { onChange((await fn()).pickup); } catch (e) { setError(e instanceof Error ? e.message : 'Failed.'); }
    finally { setBusy(false); }
  }

  return (
    <li className="border-2 border-ink bg-sheet p-3 shadow-[6px_6px_0_#16201a]">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.photo_annotated_url && <img src={p.photo_annotated_url} alt={`Recyclables from ${p.name}`} className="h-28 w-36 shrink-0 border border-ink/30 object-cover" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-display text-3xl font-black leading-none">{money(p.paid_usd ?? p.est_value_usd)}</p>
          <p className="text-xs">{fmtKg(p.actual_kg ?? p.weight_kg ?? 0)}{p.weight_given ? '' : ' (est.)'} - {here ? `${km(here, p).toFixed(1)} km away` : `posted ${ago(hoursSince(p.ts))} ago`}</p>
          <Chips counts={p.counts} />
        </div>
      </div>
      <p className="mt-2 text-xs"><strong>{shown.name}</strong> - {shown.phone}{shown.address && ` - ${shown.address}`}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={mapsLink(p.lat, p.lng)} target="_blank" rel="noreferrer" className={btnAlt}>Navigate</a>
        {p.status === 'requested' && (
          <button type="button" disabled={busy || !me} onClick={() => act(() => acceptPickup(p.id, me))} className={btn}>{busy ? '...' : 'Accept pickup'}</button>
        )}
      </div>
      {p.status === 'accepted' && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t-2 border-dashed border-ink/40 pt-3">
          <div>
            <label htmlFor={`kg-${p.id}`} className={labelCls}>Actual kg</label>
            <input id={`kg-${p.id}`} type="number" min="0" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} className={`mt-1 ${field}`} />
          </div>
          <div>
            <label htmlFor={`paid-${p.id}`} className={labelCls}>Paid ($)</label>
            <input id={`paid-${p.id}`} type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} className={`mt-1 ${field}`} />
          </div>
          <button type="button" disabled={busy} className={`col-span-2 ${btn}`}
            onClick={() => act(() => completePickup(p.id, paid ? Number(paid) : undefined, kg ? Number(kg) : undefined))}>
            {busy ? '...' : 'Mark collected'}
          </button>
        </div>
      )}
      {p.status === 'collected' && <p className="mt-2 text-xs font-bold uppercase text-moss">Collected - diverted from landfill</p>}
      {!me && p.status === 'requested' && <p className="mt-2 text-xs text-rust">Enter your name above to accept jobs.</p>}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </li>
  );
}

export default function CollectPage() {
  const [me, setMe] = useState('');
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [all, setAll] = useState<Pickup[] | null>(null);
  const [revealed, setRevealed] = useState<Record<string, Pickup>>({});
  const [summary, setSummary] = useState<CivicSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mineIds, setMineIds] = useState<string[]>([]);

  useEffect(() => { setMe(savedText('sortline-collector')); setMineIds(remembered(KEY)); }, []);
  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([listPickups(), getSummary()]);
      setAll(l.pickups); setSummary(s); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load pickups.'); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  function update(p: Pickup) {
    // The accept/complete response carries the full phone number; keep it for this session.
    setRevealed((r) => ({ ...r, [p.id]: p }));
    remember(KEY, p.id); setMineIds(remembered(KEY));
    setAll((a) => (a ?? []).map((x) => (x.id === p.id ? p : x)));
    getSummary().then(setSummary).catch(() => {});
  }

  const open = useMemo(() => {
    const o = (all ?? []).filter((p) => p.status === 'requested');
    return here ? o.sort((a, b) => km(here, a) - km(here, b)) : o;
  }, [all, here]);
  const mine = useMemo(() => (all ?? []).filter((p) => p.status !== 'requested' && mineIds.includes(p.id)), [all, mineIds]);
  const points = useMemo<MapPoint[]>(() => open.map((p) => ({
    id: p.id, lat: p.lat, lng: p.lng, color: '#4d8f2a', label: `${money(p.est_value_usd)} - ${fmtKg(p.weight_kg ?? 0)}`,
  })), [open]);

  return (
    <Shell kicker="Scrap collectors & recyclers / pickup board" title="Collect" accent="Recyclables">
      <p className="mb-6 max-w-3xl text-sm">
        Households near you have sorted recyclables ready. Each job shows what is in the bag (AI-detected) and its estimated value.
        Accept a job to see the contact number, collect, and record what you paid.
      </p>
      <div className="mb-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div>
            <label htmlFor="me" className={labelCls}>Collector / business name</label>
            <input id="me" value={me} maxLength={60} placeholder="e.g. GreenScrap Recyclers"
              onChange={(e) => { setMe(e.target.value); saveText('sortline-collector', e.target.value); }} className={`mt-1 ${field}`} />
          </div>
          <button type="button" className={btnAlt} onClick={async () => { try { setHere(await locate()); } catch (e) { setError((e as Error).message); } }}>
            Sort by distance from me
          </button>
          {summary && (
            <dl className="grid grid-cols-2 gap-2">
              <Stat label="Open jobs" value={summary.pickups.requested} />
              <Stat label="Collected" value={summary.pickups.collected} />
              <Stat label="Recovered" value={fmtKg(summary.pickups.kg_recovered)} />
              <Stat label="Paid to homes" value={money(summary.pickups.paid_usd)} />
            </dl>
          )}
        </div>
        <MapView points={points} pick={here} className="h-80" />
      </div>
      {error && <Alert>{error}</Alert>}

      {mine.length > 0 && (
        <section className="mb-8" aria-label="My jobs">
          <h2 className="mb-3 font-display text-3xl font-black uppercase">My jobs</h2>
          <ul className="grid gap-6 lg:grid-cols-2">{mine.map((p) => <Card key={p.id} p={p} me={me.trim()} here={here} revealed={revealed[p.id]} onChange={update} />)}</ul>
        </section>
      )}
      <section aria-label="Available pickups">
        <h2 className="mb-3 font-display text-3xl font-black uppercase">Available pickups</h2>
        {all && open.length === 0 && <p className="text-sm">No open requests right now.</p>}
        <ul className="grid gap-6 lg:grid-cols-2">{open.map((p) => <Card key={p.id} p={p} me={me.trim()} here={here} onChange={update} />)}</ul>
      </section>
    </Shell>
  );
}
