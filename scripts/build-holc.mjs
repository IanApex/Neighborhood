// Build the HOLC partition set from Mapping Inequality's national GeoJSON.
//
//   node scripts/build-holc.mjs
//
// Downloads once (cached in data/holc-src.json), keeps graded areas only,
// simplifies geometry aggressively (worker payloads must stay small), files
// each polygon under every geohash-4 cell its bbox touches, and writes:
//   data/holc/<cell>.json        — local partitions (CLI assembler reads these)
//   data/kv/holc-bulk-<n>.json   — `wrangler kv bulk put` payloads
// Upload (from worker/, against the ESSAYS namespace):
//   npx wrangler kv bulk put ../data/kv/holc-bulk-0.json --namespace-id=<ESSAYS id> --remote
//
// LICENSE: Mapping Inequality, Digital Scholarship Lab, University of
// Richmond — CC BY-NC 4.0. Attribution required wherever the layer appears;
// noncommercial forever. Area-description documents are NEVER fetched.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { geohash4Covering } from '../src/geohash.js';

const SOURCE = 'https://dsl.richmond.edu/panorama/redlining/static/mappinginequality.json';
const SIMPLIFY_TOLERANCE_DEG = 0.0004; // ~40 m — plenty for a neighborhood overlay
const KV_PAIRS_PER_FILE = 5000;

// Douglas-Peucker on an open path, degree-space perpendicular distance.
function simplifyPath(points, tolerance) {
  if (points.length <= 4) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxDist = 0;
    let maxIdx = -1;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const dist = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = true;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function simplifyRing(ring, tolerance) {
  // Rings close on themselves; simplify the open path and re-close.
  const open = ring.slice(0, -1);
  const simplified = simplifyPath(open, tolerance);
  if (simplified.length < 3) return null; // collapsed — drop the ring
  const rounded = simplified.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);
  rounded.push(rounded[0]);
  return rounded;
}

async function main() {
  await mkdir('data/holc', { recursive: true });
  await mkdir('data/kv', { recursive: true });

  let raw;
  try {
    raw = await readFile('data/holc-src.json', 'utf8');
    console.log('Using cached data/holc-src.json');
  } catch {
    console.log(`Downloading ${SOURCE} …`);
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.text();
    await writeFile('data/holc-src.json', raw);
  }
  const collection = JSON.parse(raw);
  console.log(`${collection.features.length} features in source`);

  const partitions = new Map(); // cell → [record]
  let kept = 0;
  for (const feature of collection.features) {
    const p = feature.properties ?? {};
    if (!/^[ABCD]$/.test(p.grade ?? '')) continue; // graded areas only
    const geom = feature.geometry;
    if (!geom) continue;
    const sourcePolygons =
      geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : [];
    const polygons = sourcePolygons
      .map((rings) => rings.map((r) => simplifyRing(r, SIMPLIFY_TOLERANCE_DEG)).filter(Boolean))
      .filter((rings) => rings.length);
    if (!polygons.length) continue;

    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    for (const rings of polygons)
      for (const ring of rings)
        for (const [x, y] of ring) {
          if (y < minLat) minLat = y;
          if (y > maxLat) maxLat = y;
          if (x < minLon) minLon = x;
          if (x > maxLon) maxLon = x;
        }

    const record = {
      grade: p.grade,
      category: p.category ?? null,
      city: p.city ?? null,
      state: p.state ?? null,
      year: p.year ?? null, // absent from the current national file; kept if it appears
      polygons,
    };
    kept++;
    for (const cell of geohash4Covering(minLat, minLon, maxLat, maxLon)) {
      if (!partitions.has(cell)) partitions.set(cell, []);
      partitions.get(cell).push(record);
    }
  }
  console.log(`${kept} graded areas → ${partitions.size} geohash-4 partitions`);

  const pairs = [];
  let maxBytes = 0;
  for (const [cell, records] of partitions) {
    const value = JSON.stringify(records);
    maxBytes = Math.max(maxBytes, value.length);
    await writeFile(`data/holc/${cell}.json`, value);
    pairs.push({ key: `holc:${cell}`, value });
  }
  for (let i = 0; i * KV_PAIRS_PER_FILE < pairs.length; i++) {
    const chunk = pairs.slice(i * KV_PAIRS_PER_FILE, (i + 1) * KV_PAIRS_PER_FILE);
    await writeFile(`data/kv/holc-bulk-${i}.json`, JSON.stringify(chunk));
  }
  console.log(
    `Wrote data/holc/*.json and ${Math.ceil(pairs.length / KV_PAIRS_PER_FILE)} bulk file(s); largest partition ${(maxBytes / 1024).toFixed(0)} KB`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
