import Link from 'next/link';
import Nav from '@/app/_components/Nav';

const STEPS = [
  { n: '01', href: '/scan', cta: 'Scan a photo', title: 'Scan', who: 'Anyone',
    body: 'Upload a photo or point a camera. A YOLOv8 model boxes plastic, metal, glass, paper, cardboard and organics, then says which bin each goes in.' },
  { n: '02', href: '/report', cta: 'Report a spot', title: 'Report', who: 'Citizens',
    body: 'Snap a garbage pile with GPS. The AI tags what is in it and the spot joins the cleanup queue. Untouched for 48 h, it escalates.' },
  { n: '03', href: '/cleanup', cta: 'Open the queue', title: 'Clean', who: 'Cleanup crews',
    body: 'Crews upload an after photo. The report only closes if the model finds no waste left, so "done" means done.' },
  { n: '04', href: '/pickup', cta: 'Sell recyclables', title: 'Sell', who: 'Households',
    body: 'Photograph a bag of sorted recyclables and get a price estimate from its detected composition. Collectors accept and pick it up.' },
  { n: '05', href: '/dashboard', cta: 'See the numbers', title: 'Count', who: 'Cities & recyclers',
    body: 'Every scan feeds a dashboard: kilograms by class, stream purity, spots cleaned and CO₂e avoided versus landfill.' },
] as const;

const FACTS = [
  ['6', 'waste classes'],
  ['<200 ms', 'per photo on CPU'],
  ['5-8 fps', 'live camera'],
  ['0', 'items left to close a report'],
] as const;

export default function Landing() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b-4 border-ink pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-moss">Material recovery / vision unit</p>
          <p className="font-display text-5xl font-black uppercase leading-none sm:text-7xl">Sort<span className="text-rust">line</span></p>
        </div>
        <Nav />
      </header>

      <section className="grid items-end gap-8 lg:grid-cols-[1.1fr_1fr]" aria-labelledby="hero">
        <div>
          <h1 id="hero" className="font-display text-[2.6rem] font-black uppercase leading-[0.95] sm:text-7xl">
            One photo in.<br /><span className="text-rust">Sorted, cleaned,</span><br />paid, counted.
          </h1>
        </div>
        <div className="flex flex-col gap-5">
          <p className="text-base leading-relaxed">
            Sortline turns a phone camera into a waste sorter. The same AI that tells you which bin a bottle belongs in also
            verifies that a reported garbage spot was really cleaned, prices a bag of recyclables, and adds it all up for the city.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/scan" className="border-2 border-ink bg-ink px-6 py-3 font-display text-2xl font-bold uppercase tracking-wider text-lime transition hover:bg-moss">Try a scan</Link>
            <Link href="/live" className="flex items-center border-2 border-ink bg-sheet px-5 text-sm font-bold uppercase tracking-wider hover:bg-lime">Live camera</Link>
          </div>
        </div>
      </section>

      <figure className="mt-12 border-2 border-ink bg-sheet p-2 shadow-[8px_8px_0_#16201a]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo.svg" width={1200} height={700} className="h-auto w-full"
          alt="Animated walkthrough: a photo is scanned and waste is boxed by class, a citizen pins a garbage spot on a map, a crew's after photo is AI-verified clean, a collector picks up a bag of recyclables, and a dashboard totals CO2e avoided." />
        <figcaption className="px-1 pt-2 text-xs uppercase tracking-widest text-moss">The whole loop, in 16 seconds</figcaption>
      </figure>

      <dl className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-4">
        {FACTS.map(([v, l]) => (
          <div key={l} className="flex flex-col-reverse gap-1 border-2 border-ink bg-sheet p-3 shadow-[4px_4px_0_#16201a]">
            <dt className="text-[11px] font-bold uppercase tracking-widest">{l}</dt>
            <dd className="font-display text-4xl font-black leading-none">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-16" aria-labelledby="how">
        <h2 id="how" className="mb-6 border-b-4 border-ink pb-2 font-display text-4xl font-black uppercase">How it works</h2>
        <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-col border-2 border-ink bg-sheet">
              <div className="flex items-center justify-between bg-ink px-3 py-2 text-lime">
                <span className="font-display text-2xl font-black uppercase">{s.n} {s.title}</span>
                <span className="text-[11px] font-bold uppercase tracking-widest">{s.who}</span>
              </div>
              <p className="flex-1 p-3 text-sm leading-relaxed">{s.body}</p>
              <Link href={s.href} className="border-t-2 border-ink px-3 py-2 text-xs font-bold uppercase tracking-widest hover:bg-lime">
                {s.cta} &rarr;
              </Link>
            </li>
          ))}
          <li className="flex flex-col justify-between gap-4 border-2 border-ink bg-lime p-4 shadow-[6px_6px_0_#16201a]">
            <p className="font-display text-3xl font-black uppercase leading-none">Why it matters</p>
            <p className="text-sm leading-relaxed">
              Mixed waste is worth little and ends up in landfill. Sorted at the source, the same material becomes new cans,
              boxes and compost, and a cleanup that is photo-verified cannot be marked done on paper alone.
            </p>
          </li>
        </ol>
      </section>

      <section className="mt-16 grid gap-6 border-2 border-ink bg-sheet p-5 md:grid-cols-[1fr_2fr]" aria-labelledby="stack">
        <h2 id="stack" className="font-display text-3xl font-black uppercase">Under the hood</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          <li><strong>Model:</strong> YOLOv8 fine-tuned on 6 waste classes, CPU inference</li>
          <li><strong>API:</strong> FastAPI, one container on EC2</li>
          <li><strong>Storage:</strong> S3 for photos, DynamoDB for scans, reports and pickups</li>
          <li><strong>Edge:</strong> Caddy with automatic HTTPS serving a static Next.js site</li>
        </ul>
      </section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t-4 border-ink pt-4 text-xs uppercase tracking-widest">
        <span>Sort<span className="text-rust">line</span> / built for a cleaner street</span>
        <Link href="/scan" className="font-bold text-rust underline">Start scanning</Link>
      </footer>
    </main>
  );
}
