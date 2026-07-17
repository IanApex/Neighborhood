// Build the National Register partition set from the NPS map service.
//
//   node scripts/build-nrhp.mjs
//
// Pages through the public NRHP points layer (federal work, public domain),
// keeps (name, listed year, category, lat, lon), files each point under its
// geohash-4 cell, and writes:
//   data/nrhp/<cell>.json        — local partitions (CLI assembler reads these)
//   data/kv/nrhp-bulk-<n>.json   — `wrangler kv bulk put` payloads
// Upload (from worker/, against the ESSAYS namespace):
//   npx wrangler kv bulk put ../data/kv/nrhp-bulk-0.json --namespace-id=<ESSAYS id> --remote

import { mkdir, writeFile } from 'node:fs/promises';
import { geohashEncode } from '../src/geohash.js';

const LAYER =
  'https://mapservices.nps.gov/arcgis/rest/services/cultural_resources/nrhp_locations/MapServer/0/query';
const PAGE = 2000; // the layer's maxRecordCount
const KV_PAIRS_PER_FILE = 5000;

// CertDate strings are MM/DD/YY; the Register began in 1966.
function listedYearFrom(certDate) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(certDate ?? '');
  if (!m) return null;
  const yy = Number(m[3]);
  return yy >= 66 ? 1900 + yy : 2000 + yy;
}

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'RESNAME,CertDate,ResType',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    f: 'geojson',
  });
  const res = await fetch(`${LAYER}?${params}`);
  if (!res.ok) throw new Error(`NRHP HTTP ${res.status} at offset ${offset}`);
  return res.json();
}

async function main() {
  await mkdir('data/nrhp', { recursive: true });
  await mkdir('data/kv', { recursive: true });

  const partitions = new Map();
  let total = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    const features = page.features ?? [];
    for (const f of features) {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = f.properties ?? {};
      const name = (p.RESNAME ?? '').trim();
      if (!name) continue;
      const record = {
        name,
        listedYear: listedYearFrom(p.CertDate),
        category: (p.ResType ?? '').trim().toLowerCase() || null,
        lat: Number(lat.toFixed(5)),
        lon: Number(lon.toFixed(5)),
      };
      const cell = geohashEncode(record.lat, record.lon, 4);
      if (!partitions.has(cell)) partitions.set(cell, []);
      partitions.get(cell).push(record);
      total++;
    }
    process.stdout.write(`\r${total} places…`);
    if (!features.length || !(page.exceededTransferLimit || page.properties?.exceededTransferLimit))
      break;
  }
  console.log(`\n${total} places → ${partitions.size} geohash-4 partitions`);

  const pairs = [];
  for (const [cell, records] of partitions) {
    const value = JSON.stringify(records);
    await writeFile(`data/nrhp/${cell}.json`, value);
    pairs.push({ key: `nrhp:${cell}`, value });
  }
  for (let i = 0; i * KV_PAIRS_PER_FILE < pairs.length; i++) {
    const chunk = pairs.slice(i * KV_PAIRS_PER_FILE, (i + 1) * KV_PAIRS_PER_FILE);
    await writeFile(`data/kv/nrhp-bulk-${i}.json`, JSON.stringify(chunk));
  }
  console.log(`Wrote data/nrhp/*.json and ${Math.ceil(pairs.length / KV_PAIRS_PER_FILE)} bulk file(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
