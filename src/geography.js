// Named geography via Overpass: the waterways, shorelines, and landforms a
// tract sits among. The ACS knows this tract has water area; only OSM knows
// it's called the Fox River — and named geography is some of the strongest
// material the narrative gets.
//
// This layer is a pure function of the tract (centroid + area), so it lives
// in tractCore and is cacheable by GEOID. It may legitimately be empty.
//
// Etiquette: one query per tract, generous server-side timeout, results
// cached with the tract.

import { overpassQuery } from './overpass.js';

// Search radius scales with tract size: a dense urban tract only needs to
// look ~1.5km out, a sprawling one needs to reach its own edges.
function searchRadius(areaLandSqM) {
  const r = Math.sqrt(areaLandSqM || 0);
  return Math.round(Math.min(8000, Math.max(1500, r)));
}

export async function fetchGeography({ centroid, areaLand }) {
  const radius = searchRadius(areaLand);
  const { lat, lon } = centroid;
  const query = `
[out:json][timeout:120];
(
  nwr["waterway"~"^(river|stream|canal)$"]["name"](around:${radius},${lat},${lon});
  nwr["natural"~"^(water|coastline|beach)$"]["name"](around:${radius},${lat},${lon});
  nwr["natural"~"^(peak|ridge)$"]["name"](around:${radius},${lat},${lon});
);
out tags;`;

  const json = await overpassQuery(query);

  // Artificial basins tagged natural=water (reflecting pools, marina pools)
  // are not the geography an essay should reach for. They show up two ways:
  // a water=* subtag, or a doubled amenity/leisure tag (Chicago's "Pool 1-5"
  // are amenity=fountain + natural=water park features).
  const ARTIFICIAL_WATER = /^(pool|reflecting_pool|swimming_pool|basin|wastewater|fountain|moat)$/;
  const isBuiltWater = (tags) =>
    (tags.water && ARTIFICIAL_WATER.test(tags.water)) ||
    tags.amenity === 'fountain' || tags.leisure === 'swimming_pool';

  // Dedupe by name — a river is mapped as many way segments, all named alike —
  // and globally across buckets ("Ogden Slip" is both waterway=canal and a
  // natural=water polygon); waterway identity wins over water polygon.
  const waterways = new Map();
  const water = new Map();
  const landforms = new Map();
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const name = tags.name;
    if (!name) continue;
    if (/^(river|stream|canal)$/.test(tags.waterway)) {
      waterways.set(name, tags.waterway);
    } else if (/^(water|coastline|beach)$/.test(tags.natural)) {
      if (isBuiltWater(tags)) continue;
      water.set(name, tags.natural);
    } else if (/^(peak|ridge)$/.test(tags.natural)) {
      landforms.set(name, tags.natural);
    }
  }
  for (const name of waterways.keys()) { water.delete(name); landforms.delete(name); }
  for (const name of water.keys()) landforms.delete(name);
  const toList = (m) => [...m].slice(0, 15).map(([name, type]) => ({ name, type }));

  return {
    searchRadiusMeters: radius,
    namedWaterways: toList(waterways),
    namedWater: toList(water),
    namedLandforms: toList(landforms),
  };
}
