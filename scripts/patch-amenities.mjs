// One-off: refetch ONLY the amenities layer for existing dossiers so
// namedExamples pick up coordinates, without re-querying ACS or geography.
// Usage: node --env-file=.env scripts/patch-amenities.mjs <dossier.json> [...]
import { readFile, writeFile } from 'node:fs/promises';
import { fetchAmenities } from '../src/overpass.js';

for (const path of process.argv.slice(2)) {
  const dossier = JSON.parse(await readFile(path, 'utf8'));
  const anchor = dossier.addressContext.anchor;
  const amenities = await fetchAmenities(anchor);
  dossier.addressContext.amenities = amenities;
  dossier.generatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(dossier, null, 2));
  const withCoords = amenities.namedExamples.filter((e) => e.lat != null).length;
  console.log(`${path}: ${amenities.totalFeatures} features, ${withCoords}/${amenities.namedExamples.length} examples with coords`);
}
