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
//
// v0.2.0 splits the dossier in two:
//   tractCore      — everything that is purely a function of the tract.
//                    Cacheable by GEOID: two requests in the same tract get
//                    byte-identical tractCore.
//   addressContext — the walking-distance amenities layer, anchored at the
//                    input point and regenerated per request. Kept out of
//                    tractCore so the GEOID cache key stays honest (same
//                    tract, different address = different walkshed).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tractFromAddress, tractFromCoordinates } from './geocode.js';
import { fetchCoreStats, fetchYearBuiltDistribution } from './acs.js';
import { fetchAmenities } from './overpass.js';
import { fetchGeography } from './geography.js';
import { fetchHolc, fetchHistoricPlaces } from './history.js';

// Historical layers read the local partition sets built by
// scripts/build-holc.mjs and scripts/build-nrhp.mjs (the worker reads the
// same partitions from KV). Missing partition dirs → layers null/empty.
const localPartition = async (prefix, cell) => {
  try {
    return JSON.parse(await readFile(`data/${prefix}/${cell}.json`, 'utf8'));
  } catch {
    return null;
  }
};

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
  const settle = (r) => {
    if (r.status === 'rejected') console.warn('Layer failed:', r.reason?.message);
    return r.status === 'fulfilled' ? r.value : null;
  };
  // ACS layers run concurrently; the two Overpass layers run one at a time —
  // the public instance allots few slots per IP and parallel queries invite 429s.
  let [core, yearBuilt] = (await Promise.allSettled([
    fetchCoreStats(tract),
    fetchYearBuiltDistribution(tract),
  ])).map(settle);
  let [amenities] = (await Promise.allSettled([fetchAmenities(anchor)])).map(settle);
  let [geography] = (await Promise.allSettled([fetchGeography(tract)])).map(settle);
  const [holc, historicPlaces] = (
    await Promise.allSettled([
      fetchHolc(localPartition, anchor, tract.centroid),
      fetchHistoricPlaces(localPartition, anchor),
    ])
  ).map(settle);

  // A rerun where one flaky layer fails must not clobber a good value already
  // on disk (Overpass 504s make this common). Keep the previous layer instead.
  const outPath = `data/dossier-${tract.geoid}.json`;
  try {
    const prev = JSON.parse(await readFile(outPath, 'utf8'));
    const prevCore = prev.tractCore?.layers ?? prev.layers ?? {};
    const prevAmenities = prev.addressContext?.amenities ?? prev.layers?.amenities ?? null;
    if (!core && prevCore.core) { core = prevCore.core; console.warn('  kept core layer from previous dossier'); }
    if (!yearBuilt && prevCore.yearBuilt) { yearBuilt = prevCore.yearBuilt; console.warn('  kept yearBuilt layer from previous dossier'); }
    if (!geography && prevCore.geography) { geography = prevCore.geography; console.warn('  kept geography layer from previous dossier'); }
    if (!amenities && prevAmenities) { amenities = prevAmenities; console.warn('  kept amenities layer from previous dossier'); }
  } catch { /* no previous dossier — nothing to preserve */ }

  const dossier = {
    schemaVersion: '0.3.0',
    generatedAt: new Date().toISOString(),
    sources: {
      geocoding: 'US Census Bureau Geocoder (Public_AR_Current)',
      demographics: `US Census Bureau ACS 5-year (${process.env.ACS_YEAR || '2024'})`,
      amenities: 'OpenStreetMap contributors, via Overpass API',
      geography: 'OpenStreetMap contributors, via Overpass API',
      // Attribution REQUIRED wherever the HOLC layer appears (CC BY-NC 4.0,
      // noncommercial forever); included only when the layer is present.
      ...(holc && {
        holc: 'Mapping Inequality, Digital Scholarship Lab, University of Richmond (CC BY-NC 4.0)',
      }),
      ...(historicPlaces?.length && {
        historicPlaces: 'National Register of Historic Places, National Park Service',
      }),
    },
    input: geo.matchedAddress ? { matchedAddress: geo.matchedAddress } : { coordinates: geo.location },
    tractCore: {
      tract: {
        geoid: tract.geoid,
        name: tract.name,
        centroid: tract.centroid,
        areaLandSqM: tract.areaLand,
        areaWaterSqM: tract.areaWater,
      },
      layers: {
        core,        // population, median year built, tenure, median age, commute
        yearBuilt,   // decade-bucket distribution
        geography,   // named waterways/water/landforms near the tract
        holc,        // HOLC grade at the anchor (Mapping Inequality); null = no coverage
        // Coming in later spikes:
        canopy: null,       // NLCD tree canopy % (raster work)
        historicalMaps: null, // Sanborn / USGS topo availability + refs
      },
    },
    addressContext: {
      anchor,
      amenities,   // walking-distance POI counts + named examples
      historicPlaces: historicPlaces ?? [], // National Register entries in the walkshed
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
  if (geography) {
    const names = [...geography.namedWaterways, ...geography.namedWater, ...geography.namedLandforms]
      .map((g) => g.name);
    console.log(`  Named geography: ${names.length ? names.join(', ') : '(none)'}`);
  }
  console.log(`  HOLC: ${holc ? `${holc.grade} (${holc.category}), ${holc.city}` : '(no coverage)'}`);
  console.log(`  Historic places in walkshed: ${historicPlaces?.length ?? 0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
