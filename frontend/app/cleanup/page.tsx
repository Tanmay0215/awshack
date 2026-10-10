'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { resizeImage, validateFile } from '@/lib/api';
import { Report, ResolveResult, ago, listReports, mapsLink, resolveReport, savedText, saveText } from '@/lib/civic';
import MapView, { MapPoint } from '@/app/_components/MapView';
import { Alert, Chips, PhotoField, Shell, btn, field, labelCls } from '@/app/_components/ui';

function Job({ r, worker, onDone }: { r: Report; worker: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<ResolveResult | null>(null);

  async function submit() {
    if (!file) return;
    const bad = validateFile(file);
    if (bad) { setError(bad); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      const out = await resolveReport(r.id, await resizeImage(file), worker);
      setRes(out); setFile(null);
      if (out.verified) setTimeout(onDone, 2500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); }
  }

  return (
    <li className={`border-2 bg-sheet p-3 ${r.escalated ? 'border-rust shadow-[6px_6px_0_#b4491f]' : 'border-ink shadow-[6px_6px_0_#16201a]'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
        {r.escalated && <span className="bg-rust px-1.5 text-white">Escalated</span>}
        <span>Open {ago(r.age_hours)}</span>
        <span>#{r.id.slice(0, 8)}</span>
        {r.failed_attempts > 0 && <span className="text-rust">{r.failed_attempts} rejected</span>}
        <a href={mapsLink(r.lat, r.lng)} target="_blank" rel="noreferrer" className="ml-auto border-2 border-ink bg-lime px-2 py-0.5 text-ink hover:bg-ink hover:text-lime">Navigate</a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <figure>
          <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-widest">Reported</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {r.before_annotated_url && <img src={r.before_annotated_url} alt={`Reported garbage ${r.id}`} className="aspect-[4/3] w-full border border-ink/30 object-cover" />}
          <div className="mt-1"><Chips counts={r.counts} /></div>
          {r.note && <p className="mt-1 text-xs">&ldquo;{r.note}&rdquo;</p>}
        </figure>
        <div className="space-y-2">
          {res && !res.verified ? (
            <figure>
              <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-widest">Your photo - AI check</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={res.annotated_image} alt="After photo with remaining waste marked" className="aspect-[4/3] w-full border border-rust object-cover" />
            </figure>
          ) : (
            <PhotoField file={file} onFile={setFile} label="After photo (same spot)" />
          )}
          {res && !res.verified && (
            <Alert>
              Not verified: the AI still sees {res.remaining} item{res.remaining === 1 ? '' : 's'}. Clear it and take a new photo.
              <span className="mt-1 block"><Chips counts={res.remaining_counts} /></span>
            </Alert>
          )}
          {res?.verified && <Alert ok>Verified clean. Ticket closed and the reporter&apos;s map shows it as cleaned.</Alert>}
          {error && <Alert>{error}</Alert>}
          {res && !res.verified
            ? <button type="button" onClick={() => setRes(null)} className={`w-full ${btn}`}>Retake photo</button>
            : !res?.verified && <button type="button" onClick={submit} disabled={!file || busy || !worker} className={`w-full ${btn}`}>{busy ? 'AI checking...' : 'Submit for AI check'}</button>}
          {!worker && <p className="text-xs text-rust">Enter your crew name above first.</p>}
        </div>
      </div>
    </li>
  );
}

export default function CleanupPage() {
  const [worker, setWorker] = useState('');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setWorker(savedText('sortline-worker')); }, []);
  const load = useCallback(async () => {
    try { setReports((await listReports('open')).reports); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load jobs.'); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  // Escalated first, then oldest first.
  const jobs = useMemo(() => [...(reports ?? [])].sort((a, b) => Number(b.escalated) - Number(a.escalated) || b.age_hours - a.age_hours), [reports]);
  const points = useMemo<MapPoint[]>(() => jobs.map((r) => ({
    id: r.id, lat: r.lat, lng: r.lng, color: r.escalated ? '#b4491f' : '#e0a21a', label: `#${r.id.slice(0, 8)} - open ${ago(r.age_hours)}`,
  })), [jobs]);

  return (
    <Shell kicker="Cleanup crews / work queue" title="Cleanup" accent="Queue">
      <p className="mb-6 max-w-3xl text-sm">
        Every citizen report lands here. Go to the spot, clean it, and take an <strong>after photo</strong>.
        The AI checks it: the ticket only closes if no waste is left. Escalated jobs (open 48h+) are listed first.
      </p>
      <div className="mb-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <div>
          <label htmlFor="worker" className={labelCls}>Crew / worker name</label>
          <input id="worker" value={worker} maxLength={60} placeholder="e.g. Ward 12 crew"
            onChange={(e) => { setWorker(e.target.value); saveText('sortline-worker', e.target.value); }} className={`mt-1 ${field}`} />
          <p className="mt-4 font-display text-5xl font-black leading-none">{jobs.length}</p>
          <p className="text-xs font-bold uppercase tracking-widest">open job{jobs.length === 1 ? '' : 's'} {jobs.some((j) => j.escalated) && <span className="text-rust">({jobs.filter((j) => j.escalated).length} escalated)</span>}</p>
        </div>
        <MapView points={points} className="h-64" />
      </div>
      {error && <Alert>Could not load jobs: {error}</Alert>}
      {reports && jobs.length === 0 && <Alert ok>No open reports. Every reported spot has been cleaned and verified.</Alert>}
      <ul className="grid gap-6 lg:grid-cols-2">{jobs.map((r) => <Job key={r.id} r={r} worker={worker.trim()} onDone={load} />)}</ul>
    </Shell>
  );
}
