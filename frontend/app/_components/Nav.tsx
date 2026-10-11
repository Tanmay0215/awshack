'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/', 'Home'], ['/scan', 'Scan'], ['/live', 'Live'], ['/report', 'Report'], ['/cleanup', 'Cleanup'],
  ['/pickup', 'Sell'], ['/collect', 'Collect'], ['/dashboard', 'Dashboard'],
] as const;

export default function Nav() {
  const path = (usePathname() ?? '/').replace(/(.)\/$/, '$1');
  return (
    <nav aria-label="Primary" className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-widest">
      {LINKS.map(([href, label]) => {
        const on = path === href;
        return (
          <Link key={href} href={href} aria-current={on ? 'page' : undefined}
            className={`border-2 border-ink px-3 py-1 ${on ? 'bg-ink text-lime' : 'bg-sheet hover:bg-lime'}`}>{label}</Link>
        );
      })}
    </nav>
  );
}
