'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Nav from '@/app/_components/Nav';
import { FrameResult, detectFrame, health } from '@/lib/api';

const COLORS: Record<string, string> = {
  BIODEGRADABLE: '#4d8f2a',
  CARDBOARD: '#a8742f',
  GLASS: '#1f8f8a',
  METAL: '#5b6b7a',
  PAPER: '#8a5fb0',
  PLASTIC: '#c2412d',
};
const colorOf = (c: string) => COLORS[c.toUpperCase()] ?? '#16201a';
const MAX_SIDE = 480;

type Status = 'idle' | 'starting' | 'running' | 'denied' | 'nocamera' | 'error';

export default function Live() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0); // loop generation; bump to cancel
  const confRef = useRef(40);

  const [status, setStatus] = useState<Status>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [conf, setConf] = useState(40);
  const [online, setOnline] = useState<boolean | null>(null);
  const [stats, setStats] = useState({ fps: 0, ms: 0, busy: 0 });
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => { health().then(setOnline); }, []);
  useEffect(() => { confRef.current = conf; }, [conf]);

  const stop = useCallback(() => {
    runRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const c = overlayRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setStatus((s) => (s === 'running' || s === 'starting' ? 'idle' : s));
    setCounts({});
  }, []);

  useEffect(() => stop, [stop]); // stop the stream on unmount

  function draw(r: FrameResult) {
    const c = overlayRef.current, v = videoRef.current;
    if (!c || !v) return;
    const W = v.videoWidth, H = v.videoHeight;
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const sx = W / r.width, sy = H / r.height;
    const lw = Math.max(2, W / 240), fs = Math.max(12, W / 40);
    ctx.lineWidth = lw; ctx.font = `bold ${fs}px monospace`; ctx.textBaseline = 'bottom';
    for (const d of r.detections) {
      const [x1, y1, x2, y2] = d.box;
      const col = colorOf(d.class);
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
      const label = `${d.class} ${(d.confidence * 100).toFixed(0)}%`;
      const tw = ctx.measureText(label).width + 6;
      const ty = Math.max(fs + 2, y1 * sy);
      ctx.fillRect(x1 * sx, ty - fs - 2, tw, fs + 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x1 * sx + 3, ty);
    }
  }

  async function start() {
    setMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setMsg('Camera access needs HTTPS (or localhost) and a browser that supports getUserMedia.');
      return;
    }
    setStatus('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('denied'); setMsg('Camera permission was denied. Allow camera access in your browser settings and try again.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setStatus('nocamera'); setMsg('No camera was found on this device.');
      } else {
        setStatus('error'); setMsg('Could not start the camera. It may be in use by another app.');
      }
      return;
    }
    streamRef.current = stream;
    const v = videoRef.current!;
    v.srcObject = stream;
    try { await v.play(); } catch { /* autoplay blocked; muted+playsInline normally avoids this */ }
    setStatus('running');
    const gen = ++runRef.current;
    loop(gen);
  }

  async function loop(gen: number) {
    const v = videoRef.current!;
    const grab = (grabRef.current ??= document.createElement('canvas'));
    let ema = 0, last = performance.now();
    while (runRef.current === gen) {
      if (v.readyState < 2 || !v.videoWidth) { await new Promise((r) => setTimeout(r, 50)); continue; }
      const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
      grab.width = Math.round(v.videoWidth * scale); grab.height = Math.round(v.videoHeight * scale);
      grab.getContext('2d')!.drawImage(v, 0, 0, grab.width, grab.height);
      const blob = await new Promise<Blob | null>((r) => grab.toBlob(r, 'image/jpeg', 0.7));
      if (!blob || runRef.current !== gen) continue;
      try {
        const r = await detectFrame(blob, confRef.current);
        if (runRef.current !== gen) return;
        draw(r);
        const now = performance.now();
        ema = ema ? 0.8 * ema + 0.2 * (now - last) : now - last;
        last = now;
        setStats((s) => ({ ...s, fps: 1000 / ema, ms: r.inference_ms }));
        setCounts(r.counts);
      } catch (e) {
        if (runRef.current !== gen) return;
        if (e instanceof Error && e.message === 'busy') {
          setStats((s) => ({ ...s, busy: s.busy + 1 }));
          await new Promise((r) => setTimeout(r, 150));
        } else {
          setStatus('error'); setMsg(e instanceof Error ? e.message : 'Detection failed.');
          stop(); setStatus('error');
          return;
        }
      }
    }
  }

  const running = status === 'running' || status === 'starting';
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b-4 border-ink pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-moss">Material recovery / vision unit</p>
          <h1 className="font-display text-5xl font-black uppercase leading-none sm:text-7xl">Sort<span className="text-rust">line</span></h1>
        </div>
        <Nav />
        <p className="flex items-center gap-2 text-xs uppercase tracking-widest" role="status">
          <span className={`inline-block h-3 w-3 ${online === null ? 'bg-ink/30' : online ? 'bg-lime border border-ink' : 'bg-rust'}`} aria-hidden />
          API {online === null ? 'checking' : online ? 'online' : 'offline'}
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1fr_320px]" aria-label="Live camera">
        <div className="relative min-h-[260px] overflow-hidden border-2 border-ink bg-ink p-0 shadow-[6px_6px_0_#16201a]">
          <video ref={videoRef} muted playsInline className="block w-full" aria-label="Camera preview" />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
          {status !== 'running' && (
            <div className="absolute inset-0 flex items-center justify-center bg-sheet p-6 text-center">
              <p className="font-display text-3xl font-bold uppercase">{status === 'starting' ? 'Starting camera...' : 'Camera off'}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 border-2 border-ink bg-sheet p-4 shadow-[6px_6px_0_#16201a]">
          <div className="flex gap-2">
            <button type="button" onClick={start} disabled={running}
              className="flex-1 bg-ink px-4 py-3 font-display text-2xl font-bold uppercase tracking-wider text-lime transition hover:bg-moss disabled:cursor-not-allowed disabled:opacity-40">
              Start
            </button>
            <button type="button" onClick={stop} disabled={!running}
              className="flex-1 border-2 border-ink px-4 py-3 font-display text-2xl font-bold uppercase tracking-wider transition hover:bg-rust hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
              Stop
            </button>
          </div>
          <div>
            <label htmlFor="conf" className="flex justify-between text-xs font-bold uppercase tracking-widest">
              <span>Confidence threshold</span><span>{conf}%</span>
            </label>
            <input id="conf" type="range" min={5} max={100} step={5} value={conf}
              onChange={(e) => setConf(Number(e.target.value))} className="mt-2 w-full" />
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center" aria-live="off">
            <div className="border-2 border-ink p-2"><dt className="text-[10px] font-bold uppercase tracking-widest">FPS</dt><dd className="font-display text-2xl font-black">{status === 'running' ? stats.fps.toFixed(1) : '-'}</dd></div>
            <div className="border-2 border-ink p-2"><dt className="text-[10px] font-bold uppercase tracking-widest">Infer ms</dt><dd className="font-display text-2xl font-black">{status === 'running' ? stats.ms : '-'}</dd></div>
            <div className="border-2 border-ink p-2"><dt className="text-[10px] font-bold uppercase tracking-widest">Busy</dt><dd className="font-display text-2xl font-black">{stats.busy}</dd></div>
          </dl>
          <ul className="flex flex-wrap gap-2" aria-label="Detected items by class">
            {entries.length === 0 && <li className="text-xs">{status === 'running' ? 'Nothing detected yet.' : 'Start the camera to detect.'}</li>}
            {entries.map(([c, n]) => (
              <li key={c} className="flex items-center gap-2 border-2 px-3 py-1 text-xs font-bold tracking-wider text-white" style={{ borderColor: colorOf(c), background: colorOf(c) }}>
                {c}<span className="bg-white/90 px-1.5 text-ink">{n}</span>
              </li>
            ))}
          </ul>
          {msg && <p role="alert" className="border-l-4 border-rust bg-rust/10 p-2 text-sm text-rust">{msg}</p>}
          <p className="text-xs">Frames are sent to the server at up to 480 px; nothing is stored. A shared server handles one frame at a time, so FPS drops with more viewers.</p>
        </div>
      </section>
    </main>
  );
}
