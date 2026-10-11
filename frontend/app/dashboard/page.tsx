'use client';

import Link from 'next/link';
import Nav from '@/app/_components/Nav';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CLASSES, Scan, Stats, getScans, getStats } from '@/lib/api';
import { fmtKg } from '@/lib/guidance';

const COLORS: Record<string, string> = {
  BIODEGRADABLE: '#4d8f2a',
  CARDBOARD: '#a8742f',
  GLASS: '#1f8f8a',
  METAL: '#5b6b7a',
  PAPER: '#8a5fb0',
  PLASTIC: '#c2412d',
};
const colorOf = (c: string) => COLORS[c.toUpperCase()] ?? '#16201a';
const RANGES = [1, 7, 30];
const nf = new Intl.NumberFormat('en-US');

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-ink/15 ${className}`} aria-hidden />;
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-2 border-ink bg-sheet p-4 shadow-[6px_6px_0_#16201a] ${className}`} aria-label={title}>
      <h2 className="mb-3 font-display text-2xl font-black uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, unit, est }: { label: string; value: string; unit?: string; est?: boolean }) {
  return (
    <div className="border-2 border-ink bg-sheet p-3 shadow-[4px_4px_0_#16201a]">
      <dt className="text-[11px] font-bold uppercase tracking-widest">{label}{est && <span className="text-rust"> *</span>}</dt>
      <dd className="mt-1 font-display text-3xl font-black leading-none sm:text-4xl">
        {value}{unit && <span className="ml-1 text-base font-bold text-moss">{unit}</span>}
      </dd>
    </div>
  );
}

function DayChart({ data }: { data: Stats['by_day'] }) {
  const W = 640, H = 240, L = 36, B = 28, T = 10;
  const max = Math.max(1, ...data.map((d) => d.total));
  const bw = (W - L) / Math.max(1, data.length);
  const ph = H - B - T;
  const summary = data.map((d) => `${d.day}: ${d.total}`).join(', ');
  const step = Math.ceil(data.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Stacked bar chart of items detected per day by material. ${summary}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W} y1={T + ph * (1 - f)} y2={T + ph * (1 - f)} stroke="#16201a" strokeOpacity={0.15} />
          <text x={L - 4} y={T + ph * (1 - f) + 4} textAnchor="end" fontSize={11} fill="#16201a">{Math.round(max * f)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        let y = T + ph;
        const x = L + i * bw + bw * 0.12;
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.total} items`}</title>
            {CLASSES.map((c) => {
              const n = d.counts[c] ?? d.counts[c.toLowerCase()] ?? 0;
              if (!n) return null;
              const h = (n / max) * ph;
              y -= h;
              return <rect key={c} x={x} y={y} width={bw * 0.76} height={h} fill={colorOf(c)} stroke="#16201a" strokeWidth={1}><title>{`${d.day} ${c}: ${n}`}</title></rect>;
            })}
            {i % step === 0 && <text x={x + bw * 0.38} y={H - 10} textAnchor="middle" fontSize={11} fill="#16201a">{d.day.slice(5)}</text>}
          </g>
        );
      })}
      <line x1={L} x2={W} y1={T + ph} y2={T + ph} stroke="#16201a" strokeWidth={2} />
    </svg>
  );
}

function HourChart({ data }: { data: Stats['by_hour'] }) {
  const W = 640, H = 180, L = 30, B = 24, T = 8;
  const byHour = new Map(data.map((h) => [h.hour, h.total]));
  const vals = Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? 0);
  const max = Math.max(1, ...vals);
  const bw = (W - L) / 24;
  const ph = H - B - T;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Activity by hour of day. Peak ${max} items at ${vals.indexOf(max)}:00`}>
      {vals.map((v, h) => {
        const bh = (v / max) * ph;
        return (
          <g key={h}>
            <rect x={L + h * bw + 2} y={T + ph - bh} width={bw - 4} height={bh} fill="#2f4a38" stroke="#16201a"><title>{`${String(h).padStart(2, '0')}:00 - ${v} items`}</title></rect>
            {h % 3 === 0 && <text x={L + h * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#16201a">{h}</text>}
          </g>
        );
      })}
      <text x={L - 4} y={T + 8} textAnchor="end" fontSize={11} fill="#16201a">{max}</text>
      <line x1={L} x2={W} y1={T + ph} y2={T + ph} stroke="#16201a" strokeWidth={2} />
    </svg>
  );
}

function Donut({ byClass }: { byClass: Record<string, number> }) {
  const entries = CLASSES.map((c) => [c, byClass[c] ?? byClass[c.toLowerCase()] ?? 0] as const);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0" role="img"
        aria-label={`Class composition donut. ${entries.map(([c, n]) => `${c} ${total ? Math.round((n / total) * 100) : 0}%`).join(', ')}`}>
        <circle cx={70} cy={70} r={R} fill="none" stroke="#16201a" strokeOpacity={0.12} strokeWidth={26} />
        {total > 0 && entries.map(([c, n]) => {
          const len = (n / total) * C;
          const el = <circle key={c} cx={70} cy={70} r={R} fill="none" stroke={colorOf(c)} strokeWidth={26}
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)"><title>{`${c}: ${n}`}</title></circle>;
          offset += len;
          return el;
        })}
        <text x={70} y={68} textAnchor="middle" fontSize={20} fontWeight={800} fill="#16201a">{nf.format(total)}</text>
        <text x={70} y={84} textAnchor="middle" fontSize={10} fill="#16201a">items</text>
      </svg>
      <ul className="min-w-[160px] flex-1 space-y-1 text-xs" aria-label="Class legend">
        {entries.map(([c, n]) => (
          <li key={c} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 border border-ink" style={{ background: colorOf(c) }} aria-hidden />
            <span className="flex-1 font-bold">{c}</span>
            <span>{nf.format(n)}</span>
            <span className="w-12 text-right text-ink/70">{total ? ((n / total) * 100).toFixed(1) : '0.0'}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScanCard({ s }: { s: Scan }) {
  const chips = Object.entries(s.counts).filter(([, n]) => n > 0);
  return (
    <li className="border-2 border-ink bg-sheet p-2">
      <div className="grid grid-cols-2 gap-2">
        {([['Original', s.original_url], ['Annotated', s.annotated_url]] as const).map(([cap, src]) => (
          <figure key={cap}>
            <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-widest">{cap}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${cap} scan ${s.id}`} loading="lazy" className="aspect-[4/3] w-full border border-ink/30 bg-ink/10 object-cover" />
          </figure>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-wider">
        <time dateTime={s.ts}>{new Date(s.ts).toLocaleString()}</time>
        <span>{s.total} item{s.total === 1 ? '' : 's'}</span>
        {s.demo && <span className="border border-ink bg-lime px-1.5 font-bold">demo</span>}
      </div>
      <ul className="mt-2 flex flex-wrap gap-1" aria-label="Counts per class">
        {chips.length === 0 && <li className="text-[11px] text-ink/60">no detections</li>}
        {chips.map(([c, n]) => (
          <li key={c} className="px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: colorOf(c) }}>{c} {n}</li>
        ))}
      </ul>
    </li>
  );
}

function ImpactPanel({ stats }: { stats: Stats }) {
  const rows = CLASSES.map((c) => [c, stats.co2e_by_class?.[c] ?? 0] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 0;
  return (
    <Panel title="Climate impact" className="lg:col-span-2">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <p className="font-display text-5xl font-black leading-none">{fmtKg(stats.est_co2e_kg)} <span className="text-xl">CO&#8322;e</span></p>
          <p className="mt-2 text-sm">avoided by recycling or composting {fmtKg(stats.est_weight_kg)} of sorted waste instead of landfilling it.</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="border-l-4 border-moss pl-2">Like not driving a car <strong>{nf.format(Math.round(stats.car_km))} km</strong></li>
            <li className="border-l-4 border-moss pl-2">What one tree absorbs in <strong>{nf.format(Math.round(stats.tree_days))} days</strong></li>
          </ul>
        </div>
        <ul className="space-y-2" aria-label="CO2e avoided by material">
          {rows.length === 0 && <li className="text-sm text-ink/60">No impact recorded yet.</li>}
          {rows.map(([c, v]) => (
            <li key={c} className="text-xs">
              <div className="flex justify-between font-bold"><span>{c}</span><span>{fmtKg(v)}</span></div>
              <div className="mt-0.5 h-3 border border-ink bg-ink/10"><div className="h-full" style={{ width: `${(v / max) * 100}%`, background: colorOf(c) }} /></div>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-xs text-ink/70">Estimate: item counts x average item weight x rounded US EPA WARM factors (recycling/composting vs landfill).</p>
    </Panel>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    try {
      const [st, sc] = await Promise.all([getStats(days, ac.signal), getScans(24, ac.signal)]);
      if (ac.signal.aborted) return;
      setStats(st); setScans(sc.scans);
      setError(null); setUpdated(new Date());
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    }
  }, [days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => { clearInterval(t); ctrl.current?.abort(); };
  }, [load]);

  const loading = !stats && !error;
  const empty = !!stats && stats.totals.scans === 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-4 border-ink pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-moss">Segregation facility / live dashboard</p>
          <h1 className="font-display text-4xl font-black uppercase leading-none sm:text-6xl">Sortline <span className="text-rust">Facility</span></h1>
        </div>
        <Nav />
      </header>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div role="group" aria-label="Range">
          <span className="block text-xs font-bold uppercase tracking-widest">Range</span>
          <div className="mt-1 flex">
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={days === r} onClick={() => setDays(r)}
                className={`border-2 border-ink px-3 py-2 text-sm font-bold ${days === r ? 'bg-ink text-lime' : 'bg-sheet hover:bg-lime'}`}>
                {r === 1 ? '24h' : `${r}d`}
              </button>
            ))}
          </div>
        </div>
        <p className="ml-auto flex items-center gap-2 text-xs uppercase tracking-widest" role="status">
          <span className={`inline-block h-3 w-3 border border-ink ${error ? 'bg-rust' : 'bg-lime motion-safe:animate-pulse'}`} aria-hidden />
          {error ? 'offline' : 'live'}
          {updated && <span className="text-ink/70">- updated {updated.toLocaleTimeString()}</span>}
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 border-l-4 border-rust bg-rust/10 p-3 text-sm text-rust">
          <span>Could not load dashboard data: {error}</span>
          <button type="button" onClick={load} className="border-2 border-ink bg-ink px-3 py-1 font-bold uppercase text-lime hover:bg-moss">Retry</button>
        </div>
      )}

      {loading && (
        <div aria-busy="true" aria-label="Loading dashboard">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="mt-6 h-64" />
          <div className="mt-6 grid gap-6 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        </div>
      )}

      {empty && !error && (
        <div className="border-2 border-dashed border-ink bg-sheet p-10 text-center">
          <p className="font-display text-4xl font-black uppercase">No scans yet</p>
          <p className="mt-2 text-sm">Nothing recorded for this range. <Link href="/scan" className="font-bold text-rust underline">Run a scan</Link> to populate the dashboard.</p>
        </div>
      )}

      {stats && !empty && (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Scans" value={nf.format(stats.totals.scans)} />
            <Kpi label="Items detected" value={nf.format(stats.totals.items)} />
            <Kpi label="Top material" value={stats.top_class ?? '-'} />
            <Kpi label="Avg confidence" value={(stats.totals.avg_confidence * 100).toFixed(1)} unit="%" />
            <Kpi label="Est. weight" value={stats.est_weight_kg.toFixed(1)} unit="kg" est />
            <Kpi label="Est. recovery value" value={`$${stats.est_value_usd.toFixed(2)}`} est />
            <Kpi label="Stream purity" value={stats.purity_pct.toFixed(1)} unit="%" est />
            <Kpi label="CO₂e avoided" value={fmtKg(stats.est_co2e_kg ?? 0)} est />
          </dl>
          <p className="mt-2 text-xs text-ink/70"><span className="text-rust">*</span> Weight, recovery value, purity and CO&#8322;e are estimates derived from detected item counts, not measured values.</p>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {stats.est_co2e_kg != null && <ImpactPanel stats={stats} />}
            <Panel title="Items by day" className="lg:col-span-2">
              <DayChart data={stats.by_day} />
              <ul className="mt-2 flex flex-wrap gap-3 text-xs" aria-label="Chart legend">
                {CLASSES.map((c) => <li key={c} className="flex items-center gap-1"><span className="inline-block h-3 w-3 border border-ink" style={{ background: colorOf(c) }} aria-hidden />{c}</li>)}
              </ul>
            </Panel>
            <Panel title="Activity by hour"><HourChart data={stats.by_hour} /></Panel>
            <Panel title="Composition"><Donut byClass={stats.by_class} /></Panel>
          </div>
        </>
      )}

      {scans && scans.length > 0 && (
        <section className="mt-8" aria-label="Recent scans">
          <h2 className="mb-3 font-display text-3xl font-black uppercase">Recent scans</h2>
          <ul className="grid gap-4 md:grid-cols-2">{scans.map((s) => <ScanCard key={s.id} s={s} />)}</ul>
        </section>
      )}
    </main>
  );
}
