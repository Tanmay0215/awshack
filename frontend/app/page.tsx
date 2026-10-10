'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CLASSES, DetectResult, LINES, detect, health, resizeImage, validateFile } from '@/lib/api';

const COLORS: Record<string, string> = {
  BIODEGRADABLE: '#4d8f2a',
  CARDBOARD: '#a8742f',
  GLASS: '#1f8f8a',
  METAL: '#5b6b7a',
  PAPER: '#8a5fb0',
  PLASTIC: '#c2412d',
};
const colorOf = (c: string) => COLORS[c.toUpperCase()] ?? '#16201a';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [conf, setConf] = useState(40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [line, setLine] = useState(LINES[0]);
  const [drag, setDrag] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { health().then(setOnline); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = useCallback((f: File | undefined) => {
    if (!f) return;
    const err = validateFile(f);
    setResult(null);
    setSelected([]);
    if (err) { setError(err); return; }
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }, []);

  async function run() {
    if (!file) return;
    setLoading(true); setError(null);
    try { const r = await detect(await resizeImage(file), conf, line); setSelected([]); setResult(r); }
    catch (e) { setError(e instanceof Error ? e.message : 'Detection failed.'); }
    finally { setLoading(false); }
  }

  const total = result?.detections.length ?? 0;
  const filtering = selected.length > 0;
  const shown = (result?.detections ?? []).filter((d) => !filtering || selected.includes(d.class.toUpperCase()));
  const toggle = (c: string) => setSelected((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-4 border-ink pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-moss">Material recovery / vision unit</p>
          <h1 className="font-display text-5xl font-black uppercase leading-none sm:text-7xl">Sort<span className="text-rust">line</span></h1>
        </div>
        <nav aria-label="Primary" className="flex gap-2 text-xs font-bold uppercase tracking-widest">
          <Link href="/" aria-current="page" className="border-2 border-ink bg-ink px-3 py-1 text-lime">Scan</Link>
          <Link href="/dashboard" className="border-2 border-ink bg-sheet px-3 py-1 hover:bg-lime">Dashboard</Link>
        </nav>
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest" role="status">
          <span className={`inline-block h-3 w-3 ${online === null ? 'bg-ink/30' : online ? 'bg-lime border border-ink' : 'bg-rust'}`} aria-hidden />
          API {online === null ? 'checking' : online ? 'online' : 'offline'}
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1fr_320px]" aria-label="Input">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={`relative border-2 border-dashed border-ink p-3 transition-colors ${drag ? 'bg-lime/40' : 'bg-sheet'}`}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-[260px] w-full flex-col items-center justify-center gap-2 text-center"
            aria-label="Choose an image or drop it here"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected upload preview" className="max-h-[420px] w-auto max-w-full object-contain" />
            ) : (
              <>
                <span className="font-display text-3xl font-bold uppercase">Drop image here</span>
                <span className="text-sm">or click to browse - JPG, PNG, WebP, max 10 MB</span>
              </>
            )}
          </button>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1}
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          {file && <p className="mt-2 truncate text-xs">{file.name} - {(file.size / 1024).toFixed(0)} KB</p>}
        </div>

        <div className="flex flex-col gap-5 border-2 border-ink bg-sheet p-4 shadow-[6px_6px_0_#16201a]">
          <div>
            <label htmlFor="conf" className="flex justify-between text-xs font-bold uppercase tracking-widest">
              <span>Confidence threshold</span><span>{conf}%</span>
            </label>
            <input id="conf" type="range" min={5} max={100} step={5} value={conf}
              onChange={(e) => setConf(Number(e.target.value))} className="mt-2 w-full" />
          </div>
          <div>
            <label htmlFor="line" className="block text-xs font-bold uppercase tracking-widest">Line</label>
            <select id="line" value={line} onChange={(e) => setLine(e.target.value)}
              className="mt-2 w-full border-2 border-ink bg-sheet p-2 text-sm">
              {LINES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <button type="button" onClick={run} disabled={!file || loading}
            className="bg-ink px-4 py-3 font-display text-2xl font-bold uppercase tracking-wider text-lime transition hover:bg-moss disabled:cursor-not-allowed disabled:opacity-40">
            {loading ? 'Scanning...' : 'Detect'}
          </button>
          {loading && <div className="h-2 w-full overflow-hidden bg-ink/15" role="progressbar" aria-label="Detecting"><div className="h-full w-1/3 animate-pulse bg-rust" /></div>}
          {error && <p role="alert" className="border-l-4 border-rust bg-rust/10 p-2 text-sm text-rust">{error}</p>}
        </div>
      </section>

      {result && (
        <section className="mt-10" aria-label="Results" aria-live="polite">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-3xl font-black uppercase">Result - {total} item{total === 1 ? '' : 's'}</h2>
            <p className="text-xs uppercase tracking-widest">Inference {result.inference_ms} ms</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <figure className="border-2 border-ink bg-sheet p-2">
              <figcaption className="mb-1 text-xs font-bold uppercase tracking-widest">Original</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview && <img src={preview} alt="Original upload" className="w-full" />}
            </figure>
            <figure className="border-2 border-ink bg-sheet p-2">
              <figcaption className="mb-1 text-xs font-bold uppercase tracking-widest">
                Annotated{filtering ? ` - ${selected.join(', ')} (${shown.length})` : ''}
              </figcaption>
              {filtering && preview && dims ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt={`Filtered result: ${shown.length} ${selected.join(', ')} detections`} className="w-full" />
                  <svg viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                    {shown.map((d, i) => {
                      const [x1, y1, x2, y2] = d.box;
                      const col = colorOf(d.class);
                      const sw = Math.max(2, dims.w / 300);
                      return (
                        <g key={i}>
                          <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} fill="none" stroke={col} strokeWidth={sw} />
                          <text x={x1 + sw} y={Math.max(y1 - sw, sw * 6)} fill={col} fontSize={sw * 6} fontWeight="bold">{d.class} {(d.confidence * 100).toFixed(0)}%</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.image}
                alt={`Annotated result with ${total} detections`}
                className={filtering && dims ? 'hidden' : 'w-full'}
                onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
            </figure>
          </div>

          <ul className="mt-5 flex flex-wrap items-center gap-2" aria-label="Filter by class">
            {CLASSES.map((c) => {
              const n = result.counts[c] ?? result.counts[c.toLowerCase()] ?? 0;
              const on = selected.includes(c);
              return (
                <li key={c}>
                  <button type="button" disabled={!n} aria-pressed={on} onClick={() => toggle(c)}
                    title={n ? `Show only ${c}` : `No ${c} detected`}
                    className={`flex items-center gap-2 border-2 px-3 py-1 text-xs font-bold tracking-wider transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${n && (on || !filtering) ? 'text-white' : 'bg-sheet text-ink/50'} ${n && filtering && !on ? 'opacity-60' : ''}`}
                    style={{ borderColor: colorOf(c), background: n && (on || !filtering) ? colorOf(c) : undefined }}>
                    {on && <span aria-hidden>&#10003;</span>}{c}<span className="bg-white/90 px-1.5 text-ink">{n}</span>
                  </button>
                </li>
              );
            })}
            {filtering && (
              <li><button type="button" onClick={() => setSelected([])} className="border-2 border-ink px-3 py-1 text-xs font-bold uppercase tracking-wider hover:bg-ink hover:text-lime">Show all</button></li>
            )}
          </ul>

          <div className="mt-5 overflow-x-auto border-2 border-ink bg-sheet">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Detections</caption>
              <thead className="bg-ink text-xs uppercase tracking-widest text-lime">
                <tr><th scope="col" className="p-2">#</th><th scope="col" className="p-2">Class</th><th scope="col" className="p-2">Confidence</th><th scope="col" className="p-2">Box [x1, y1, x2, y2]</th></tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={4} className="p-3">{total === 0 ? 'No detections. Try lowering the threshold.' : 'No detections for the selected classes.'}</td></tr>}
                {shown.map((d, i) => (
                  <tr key={i} className="border-t border-ink/20">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2 font-bold"><span className="mr-2 inline-block h-3 w-3 align-middle" style={{ background: colorOf(d.class) }} aria-hidden />{d.class}</td>
                    <td className="p-2">{(d.confidence * 100).toFixed(1)}%</td>
                    <td className="p-2">[{d.box.map((v) => Math.round(v)).join(', ')}]</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
