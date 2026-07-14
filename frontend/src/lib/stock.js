// Shared parsing of the yearBuilt layer into decade units and marks.
// EQUAL SCROLL DISTANCE PER DECADE is enforced by structure here: every
// decade is one unit regardless of count — empty decades are never
// compressed. The void is scrolled at full length.

import { rng, seedFromGeoid } from './seeded.js';

const VINTAGE_END = 2024; // ACS 5-year vintage; the counter never passes it

export function decadesFrom(yearBuilt) {
  const units = [];
  for (const bucket of yearBuilt?.buckets ?? []) {
    const label = bucket.label;
    let start;
    let end;
    let display;
    const range = label.match(/(\d{4})\s+to\s+(\d{4})/);
    if (/earlier/.test(label)) {
      // One unit, same scroll length as any decade. The counter holds its
      // label rather than ticking years we don't have.
      start = null;
      end = 1939;
      display = 'before 1940';
    } else if (/or later/.test(label)) {
      start = 2020;
      end = VINTAGE_END;
      display = '2020 or later';
    } else if (range) {
      start = Number(range[1]);
      end = Number(range[2]);
      display = `${start}s`;
    } else {
      continue;
    }
    units.push({ label, display, start, end, count: bucket.count });
  }
  units.sort((a, b) => (a.end ?? 0) - (b.end ?? 0));
  return units.map((u, i) => ({ ...u, eraIndex: Math.min(i, 9), unitIndex: i }));
}

// One mark per housing unit, each with a build year seeded inside its
// decade so the field fills gradually as the counter passes through.
export function marksFrom(decades, geoid) {
  const rand = rng(seedFromGeoid(geoid, 7));
  const marks = [];
  for (const d of decades) {
    const lo = d.start ?? 1900; // pre-1940 unit fills across its whole beat
    const hi = d.end;
    for (let i = 0; i < d.count; i++) {
      marks.push({
        year: lo + rand() * (hi - lo),
        eraIndex: d.eraIndex,
        unitIndex: d.unitIndex,
      });
    }
  }
  marks.sort((a, b) => a.year - b.year);
  return marks;
}

// Map a scroll progress p in [0,1] to a "timeline position": each decade
// unit owns an equal share. Returns a fractional year for the counter and
// mark visibility. Inside the pre-1940 unit the position eases from the
// unit's floor to 1939.
export function progressToYear(p, decades) {
  if (!decades.length) return null;
  const n = decades.length;
  const clamped = Math.min(1, Math.max(0, p));
  const slot = Math.min(n - 1, Math.floor(clamped * n));
  const within = clamped * n - slot;
  const d = decades[slot];
  const lo = d.start ?? 1900;
  return lo + within * (d.end - lo);
}

export const eraColorVar = (i) => `--era-${Math.min(9, Math.max(0, i))}`;
