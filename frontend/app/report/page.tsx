'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { resizeImage, validateFile } from '@/lib/api';
import { CivicSummary, Report, ago, createReport, getSummary, listReports, locate } from '@/lib/civic';
import MapView, { MapPoint } from '@/app/_components/MapView';
import PlaceSearch from '@/app/_components/PlaceSearch';
import { Alert, Box, Chips, PhotoField, Shell, Stat, btn, btnAlt, field, labelCls } from '@/app/_components/ui';

const statusColor = (r: Report) => (r.status === 'resolved' ? '#4d8f2a' : r.escalated ? '#b4491f' : '#e0a21a');
const statusText = (r: Report) => (r.status === 'resolved' ? 'Cleaned' : r.escalated ? 'Escalated' : 'Open');

function ReportCard({ r }: { r: Report }) {
  return (
    <li className="border-2 border-ink bg-sheet p-2">
      <div className="grid grid-cols-2 gap-2">
        {([['Before', r.before_annotated_url], ['After (AI-verified)', r.after_annotated_url]] as const).map(([cap, src]) => (
          <figure key={cap}>
            <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-widest">{cap}</figcaption>
            {src
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={src} alt={`${cap} photo of report ${r.id}`} loading="lazy" className="aspect-[4/3] w-full border border-ink/30 object-cover" />
              : <div className="flex aspect-[4/3] items-center justify-center border border-dashed border-ink/40 text-[11px] uppercase text-ink/50">awaiting cleanup</div>}
          </figure>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-wider">
        <span className="px-1.5 font-bold text-white" style={{ background: statusColor(r) }}>{statusText(r)}</span>
        <span>reported {ago(r.age_hours)} ago</span>
        {r.hours_to_clean !== null && <span>cleaned in {ago(r.hours_to_clean)}</span>}
        {r.failed_attempts > 0 && <span className="text-rust">{r.failed_attempts} rejected cleanup{r.failed_attempts > 1 ? 's' : ''}</span>}
      </div>
      {r.note && <p className="mt-1 text-xs">&ldquo;{r.note}&rdquo;</p>}
      <div className="mt-2"><Chips counts={r.counts} /></div>
    </li>
  );
}

export default function ReportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Report | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [summary, setSummary] = useState<CivicSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([listReports(), getSummary()]);
      setReports(l.reports); setSummary(s); setLoadError(null);
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Failed to load reports.'); }
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
    setBusy(true); setError(null);
    try {
      const { report } = await createReport(await resizeImage(file), pos.lat, pos.lng, note);
      setCreated(report); setFile(null); setNote(''); setPos(null); setPlace('');
      load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send the report.'); }
    finally { setBusy(false); }
  }

  const points = useMemo<MapPoint[]>(() => (reports ?? []).map((r) => ({
    id: r.id, lat: r.lat, lng: r.lng, color: statusColor(r), label: `${statusText(r)} - ${r.total} item${r.total === 1 ? '' : 's'}, ${ago(r.age_hours)} ago`,
  })), [reports]);

  return (
    <Shell kicker="Citizens / report a garbage spot" title="Report" accent="Garbage">
      <p className="mb-6 max-w-3xl text-sm">
        Seen a dump, an overflowing bin or litter? Snap it. The AI tags what is in the pile and the spot goes straight to the cleanup crew&apos;s queue.
        It is only marked <strong>cleaned</strong> when the crew&apos;s after photo passes an AI check, and it escalates if it is still open after 48 hours.
      </p>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Box title="New report">
          <form onSubmit={submit} className="space-y-4">
            <PhotoField file={file} onFile={setFile} label="Photo of the garbage" />
            <div>
              <span className={labelCls}>Location</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button type="button" onClick={useMyLocation} className={btnAlt}>Use my location</button>
                <span className="text-xs">{pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : 'or search / tap the map'}</span>
              </div>
              <label htmlFor="place" className="sr-only">Search a place</label>
              <PlaceSearch id="place" value={place} onChange={setPlace} near={pos} placeholder="Search a street or landmark"
                onPick={(p) => setPos({ lat: p.lat, lng: p.lng })} />
            </div>
            <div>
              <label htmlFor="note" className={labelCls}>Note (optional)</label>
              <input id="note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. behind the bus stop" className={`mt-1 ${field}`} />
            </div>
            <button type="submit" disabled={!file || !pos || busy} className={`w-full ${btn}`}>{busy ? 'Sending...' : 'Send report'}</button>
            {!pos && file && <p className="text-xs">Add a location to send.</p>}
            {error && <Alert>{error}</Alert>}
            {created && (
              <Alert ok>
                Report sent (ticket <strong>{created.id.slice(0, 8)}</strong>). AI found {created.total} item{created.total === 1 ? '' : 's'}. The cleanup crew can see it now.
              </Alert>
            )}
          </form>
        </Box>

        <div className="space-y-4">
          <MapView points={points} pick={pos} onPick={setPos} className="h-80 lg:h-[420px]" />
          <ul className="flex flex-wrap gap-4 text-xs" aria-label="Map legend">
            {[['#e0a21a', 'Open'], ['#b4491f', 'Escalated (48h+)'], ['#4d8f2a', 'Cleaned'], ['#c6e03a', 'Your pin']].map(([c, l]) => (
              <li key={l} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border border-ink" style={{ background: c }} aria-hidden />{l}</li>
            ))}
          </ul>
        </div>
      </div>

      {loadError && <div className="mt-6"><Alert>Could not load reports: {loadError}</Alert></div>}

      {summary && (
        <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Reported" value={summary.reports.total} />
          <Stat label="Cleaned (verified)" value={summary.reports.resolved} />
          <Stat label="Still open" value={summary.reports.open} />
          <Stat label="Escalated" value={summary.reports.escalated} />
          <Stat label="Avg time to clean" value={summary.reports.avg_hours_to_clean === null ? '-' : ago(summary.reports.avg_hours_to_clean)} />
        </dl>
      )}

      {reports && reports.length > 0 && (
        <section className="mt-8" aria-label="All reports">
          <h2 className="mb-3 font-display text-3xl font-black uppercase">All reports</h2>
          <ul className="grid gap-4 md:grid-cols-2">{reports.map((r) => <ReportCard key={r.id} r={r} />)}</ul>
        </section>
      )}
      {reports && reports.length === 0 && <p className="mt-8 text-sm">No reports yet. Be the first.</p>}
    </Shell>
  );
}
