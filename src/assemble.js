// Dossier assembler: address in, place dossier JSON out.
//
// Usage:
//   node src/assemble.js "335 S Broadway, De Pere, WI"
//   node src/assemble.js --coords 44.4489 -88.0604
//
// Output: data/dossier-<GEOID>.json
//
// The dossier is the contract for the whole project: the narrative layer is
// only ever allowed to state facts that exist in this file.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tractFromAddress, tractFromCoordinates } from './geocode.js';
import { fetchCoreStats, fetchYearBuiltDistribution } from './acs.js';
import { fetchAmenities } from './overpass.js';

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node src/assemble.js "<address>"  |  --coords <lat> <lon>');
    process.exit(1);
  }

  let geo;
  if (args[0] === '--coords') {
    geo = await tractFromCoordinates(parseFloat(args[1]), parseFloat(args[2]));
  } else {
    geo = await tractFromAddress(args.join(' '));
  }
  if (!geo?.tract) {
    console.error('No census tract found for that input.');
    process.exit(1);
  }
  const { tract } = geo;
  console.log(`Tract: ${tract.name} (GEOID ${tract.geoid})`);

  // Anchor the walk-radius query on the input point, not the tract centroid:
  // large suburban tracts can put the centroid kilometers from anywhere
  // people live (De Pere tract 103: 7 features at centroid vs 216 at the
  // address). Falls back to centroid if no input point survived geocoding.
  const anchor = Number.isFinite(geo.location?.lat)
    ? { ...geo.location, source: 'input-point' }
    : { ...tract.centroid, source: 'tract-centroid' };

  // Fetch layers; each is allowed to fail independently — a dossier with
  // gaps is valid, and the narrative layer is designed to handle gaps.
  const results = await Promise.allSettled([
    fetchCoreStats(tract),
    fetchYearBuiltDistribution(tract),
    fetchAmenities(anchor),
  ]);
  let [core, yearBuilt, amenities] = results.map((r) => {
    if (r.status === 'rejected') console.warn('Layer failed:', r.reason?.message);
    return r.status === 'fulfilled' ? r.value : null;
  });

  // A rerun where one flaky layer fails must not clobber a good value already
  // on disk (Overpass 504s make this common). Keep the previous layer instead.
  const outPath = `data/dossier-${tract.geoid}.json`;
  try {
    const prev = JSON.parse(await readFile(outPath, 'utf8')).layers;
    if (!core && prev.core) { core = prev.core; console.warn('  kept core layer from previous dossier'); }
    if (!yearBuilt && prev.yearBuilt) { yearBuilt = prev.yearBuilt; console.warn('  kept yearBuilt layer from previous dossier'); }
    if (!amenities && prev.amenities) { amenities = prev.amenities; console.warn('  kept amenities layer from previous dossier'); }
  } catch { /* no previous dossier — nothing to preserve */ }

  const dossier = {
    schemaVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    sources: {
      geography: 'US Census Bureau Geocoder (Public_AR_Current)',
      demographics: `US Census Bureau ACS 5-year (${process.env.ACS_YEAR || '2024'})`,
      amenities: 'OpenStreetMap contributors, via Overpass API',
    },
    input: geo.matchedAddress ? { matchedAddress: geo.matchedAddress } : { coordinates: geo.location },
    tract: {
      geoid: tract.geoid,
      name: tract.name,
      centroid: tract.centroid,
      areaLandSqM: tract.areaLand,
      areaWaterSqM: tract.areaWater,
    },
    layers: {
      core,        // population, median year built, tenure
      yearBuilt,   // decade-bucket distribution
      amenities: amenities && { anchor, ...amenities }, // walking-distance POI counts + named examples
      // Coming in later spikes:
      canopy: null,       // NLCD tree canopy % (raster work)
      historicalMaps: null, // Sanborn / USGS topo availability + refs
      holc: null,           // Mapping Inequality redlining polygons, where they exist
    },
  };

  await mkdir('data', { recursive: true });
  await writeFile(outPath, JSON.stringify(dossier, null, 2));
  console.log(`Wrote ${outPath}`);

  // Quick readability check in the terminal:
  if (core) {
    console.log(`\n  Population: ${core.population}`);
    console.log(`  Median year built: ${core.medianYearBuilt}`);
    if (core.tenure.totalOccupied) {
      const pct = Math.round((core.tenure.ownerOccupied / core.tenure.totalOccupied) * 100);
      console.log(`  Owner-occupied: ${pct}%`);
    }
  }
  if (amenities) {
    console.log(`  Features within a 15-min walk: ${amenities.totalFeatures}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
