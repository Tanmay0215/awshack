'use client';

/// <reference types="google.maps" />
import { useEffect, useRef, useState } from 'react';
import { KEY, loadMaps } from './MapView';
import { field } from './ui';

export type PickedPlace = { lat: number; lng: number; address: string };
type Suggestion = { text: string; prediction: google.maps.places.PlacePrediction };

/** Address search on Places API (New). Typing still works as plain text if Places is unavailable. */
export default function PlaceSearch({ id, value, onChange, onPick, near, placeholder }: {
  id: string; value: string; onChange: (v: string) => void; onPick: (p: PickedPlace) => void;
  near?: { lat: number; lng: number } | null; placeholder?: string;
}) {
  const places = useRef<google.maps.PlacesLibrary | null>(null);
  const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const seq = useRef(0);
  const skip = useRef(false);
  const [list, setList] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [off, setOff] = useState(!KEY);

  useEffect(() => {
    if (!KEY) return;
    loadMaps()
      .then(() => google.maps.importLibrary('places') as Promise<google.maps.PlacesLibrary>)
      .then((lib) => { places.current = lib; })
      .catch(() => setOff(true));
  }, []);

  useEffect(() => {
    if (skip.current) { skip.current = false; return; }
    const lib = places.current;
    if (!lib || value.trim().length < 3) { setList([]); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        token.current ??= new lib.AutocompleteSessionToken();
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value, sessionToken: token.current,
          ...(near ? { origin: near, locationBias: { center: near, radius: 20000 } } : {}),
        });
        if (n !== seq.current) return;
        setList(suggestions.flatMap((s) => (s.placePrediction ? [{ text: s.placePrediction.text.toString(), prediction: s.placePrediction }] : [])));
        setActive(-1);
      } catch { if (n === seq.current) setList([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [value, near]);

  async function choose(s: Suggestion) {
    setList([]);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ['location', 'formattedAddress'] });
      token.current = null; // a session ends with the details request
      if (!place.location) return;
      const address = place.formattedAddress ?? s.text;
      skip.current = true;
      onChange(address);
      onPick({ lat: place.location.lat(), lng: place.location.lng(), address });
    } catch { /* keep the typed text */ }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!list.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % list.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? list.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(list[active]); }
    else if (e.key === 'Escape') setList([]);
  }

  const listId = `${id}-list`;
  return (
    <div className="relative">
      <input id={id} value={value} maxLength={300} autoComplete="off" placeholder={placeholder ?? (off ? '' : 'Start typing an address or place')}
        role="combobox" aria-expanded={list.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} onBlur={() => setTimeout(() => setList([]), 150)}
        className={`mt-1 ${field}`} />
      {list.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto border-2 border-ink bg-white shadow-[4px_4px_0_#16201a]">
          {list.map((s, i) => (
            <li key={`${s.text}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              className={`cursor-pointer px-2 py-2 text-sm ${i === active ? 'bg-lime' : 'hover:bg-lime/50'}`}>{s.text}</li>
          ))}
          <li aria-hidden className="px-2 py-1 text-right text-[10px] text-ink/50">powered by Google</li>
        </ul>
      )}
    </div>
  );
}
