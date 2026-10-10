'use client';

import { useEffect, useRef, useState } from 'react';
import Nav from './Nav';

export const COLORS: Record<string, string> = {
  BIODEGRADABLE: '#4d8f2a', CARDBOARD: '#a8742f', GLASS: '#1f8f8a', METAL: '#5b6b7a', PAPER: '#8a5fb0', PLASTIC: '#c2412d',
};
export const colorOf = (c: string) => COLORS[c.toUpperCase()] ?? '#16201a';

export function Shell({ kicker, title, accent, children }: { kicker: string; title: string; accent: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-4 border-ink pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-moss">{kicker}</p>
          <h1 className="font-display text-4xl font-black uppercase leading-none sm:text-6xl">{title} <span className="text-rust">{accent}</span></h1>
        </div>
        <Nav />
      </header>
      {children}
    </main>
  );
}

export function Box({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border-2 border-ink bg-sheet p-4 shadow-[6px_6px_0_#16201a] ${className}`} aria-label={title}>
      {title && <h2 className="mb-3 font-display text-2xl font-black uppercase">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-2 border-ink bg-sheet p-3 shadow-[4px_4px_0_#16201a]">
      <dt className="text-[11px] font-bold uppercase tracking-widest">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-black leading-none">{value}</dd>
    </div>
  );
}

export function Chips({ counts }: { counts: Record<string, number> }) {
  const e = Object.entries(counts).filter(([, n]) => n > 0);
  if (!e.length) return <p className="text-xs text-ink/60">no waste detected</p>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Detected waste">
      {e.map(([c, n]) => <li key={c} className="px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: colorOf(c) }}>{c} {n}</li>)}
    </ul>
  );
}

export function Alert({ children, ok = false }: { children: React.ReactNode; ok?: boolean }) {
  return <p role={ok ? 'status' : 'alert'} className={`border-l-4 p-2 text-sm ${ok ? 'border-moss bg-lime/40' : 'border-rust bg-rust/10 text-rust'}`}>{children}</p>;
}

export const btn = 'border-2 border-ink bg-ink px-4 py-2 font-bold uppercase tracking-wider text-lime transition hover:bg-moss disabled:cursor-not-allowed disabled:opacity-40';
export const btnAlt = 'border-2 border-ink bg-sheet px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-lime disabled:opacity-40';
export const field = 'w-full border-2 border-ink bg-white px-2 py-2 text-sm';
export const labelCls = 'block text-xs font-bold uppercase tracking-widest';

/** Camera-first photo input with preview. */
export function PhotoField({ file, onFile, label = 'Photo' }: { file: File | null; onFile: (f: File | null) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setSrc(null); return; }
    const u = URL.createObjectURL(file); setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <button type="button" onClick={() => ref.current?.click()}
        className="mt-1 flex min-h-[160px] w-full items-center justify-center border-2 border-dashed border-ink bg-white p-2 text-sm hover:bg-lime/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="Selected photo" className="max-h-64 w-auto max-w-full object-contain" /> : 'Take or choose a photo'}
      </button>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" tabIndex={-1}
        onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
    </div>
  );
}
