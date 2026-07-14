// Synthesis view of a dossier: what actually goes into the narrative prompt.
//
// The full dossier on disk keeps everything (raw counts, plotting
// coordinates); the synthesis step doesn't need debug material or map
// geometry, and prompt payload is worth trimming. Removed here:
//   - addressContext.amenities.raw   (per-feature debug counts)
//   - namedExamples lat/lon          (phase-3 map geometry, not narrative)
//   - yearBuilt bucket `variable`    (ACS variable codes; label+count suffice)
//
// Usage:
//   npm run synthesis-view data/dossier-<GEOID>.json
//   node src/dossier-view.js data/dossier-<GEOID>.json

import { readFile } from 'node:fs/promises';

export function synthesisView(dossier) {
  const view = structuredClone(dossier);

  const amenities = view.addressContext?.amenities;
  if (amenities) {
    delete amenities.raw;
    if (amenities.namedExamples) {
      amenities.namedExamples = amenities.namedExamples.map(({ lat, lon, ...rest }) => rest);
    }
  }

  const yearBuilt = view.tractCore?.layers?.yearBuilt;
  if (yearBuilt?.buckets) {
    yearBuilt.buckets = yearBuilt.buckets.map(({ variable, ...rest }) => rest);
  }

  return view;
}

// CLI: print the trimmed JSON for a dossier file. (argv[1] is absent when
// bundled into the Cloudflare Worker — this block is CLI-only.)
if (process.argv?.[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node src/dossier-view.js <dossier.json>');
    process.exit(1);
  }
  const dossier = JSON.parse(await readFile(path, 'utf8'));
  console.log(JSON.stringify(synthesisView(dossier), null, 2));
}
