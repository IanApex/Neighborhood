// Historical layers: HOLC grades (Mapping Inequality) and National Register
// historic places (NPS). Both are national datasets partitioned by geohash-4
// at build time (scripts/build-holc.mjs, scripts/build-nrhp.mjs); lookup is
// parameterized by a partition getter so the same logic runs against KV in
// the worker and against local files in the CLI assembler.
//
// getPartition(prefix, cell) → parsed partition JSON or null, e.g.
//   worker: (p, c) => env.ESSAYS.get(`${p}:${c}`, 'json')
//   CLI:    (p, c) => readFile(`data/${p}/${c}.json`) …
//
// LICENSE NOTE (binding): the HOLC layer derives from Mapping Inequality,
// Digital Scholarship Lab, University of Richmond — CC BY-NC 4.0.
// Attribution is REQUIRED wherever the layer appears, and the layer is
// noncommercial forever. The original HOLC area descriptions contain the
// era's racist language; they are never fetched, stored, or quoted — the
// layer carries grade, category, city, year, and this fixed definition only.

import { geohashEncode, geohash4Covering } from './geohash.js';

export const HOLC_DEFINITION =
  "In the late 1930s the federal Home Owners' Loan Corporation graded urban " +
  "neighborhoods for mortgage 'security'; grades shaped decades of lending.";

const M_PER_DEG_LAT = 111_320;

function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * M_PER_DEG_LAT;
  const dLon = (b.lon - a.lon) * M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

// Even-odd ray casting over one polygon's rings (outer + holes).
function inPolygon(lat, lon, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; // [lon, lat]
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function inMultiPolygon(lat, lon, polygons) {
  return polygons.some((rings) => inPolygon(lat, lon, rings));
}

// Point-in-polygon against the anchor's partition; tract centroid as a
// fallback probe. null when no coverage — most of the country, and normal.
export async function fetchHolc(getPartition, anchor, centroid = null) {
  for (const point of [anchor, centroid]) {
    if (!point || !Number.isFinite(point.lat)) continue;
    const cell = geohashEncode(point.lat, point.lon, 4);
    const partition = await getPartition('holc', cell);
    if (!partition) continue;
    const hit = partition.find((f) => inMultiPolygon(point.lat, point.lon, f.polygons));
    if (hit) {
      return {
        grade: hit.grade,
        category: hit.category,
        city: hit.city,
        year: hit.year ?? null,
        definition: HOLC_DEFINITION,
        // Simplified MultiPolygon coordinates, for the frontend overlay only
        // — synthesisView strips it before anything reaches the prompt.
        polygon: hit.polygons,
      };
    }
  }
  return null;
}

// National Register places within the walk radius of the anchor, nearest
// first, capped. Empty array is normal (and most of the country).
export async function fetchHistoricPlaces(getPartition, anchor, radiusM = 1200, cap = 8) {
  if (!anchor || !Number.isFinite(anchor.lat)) return [];
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LAT * Math.cos((anchor.lat * Math.PI) / 180));
  const cells = geohash4Covering(
    anchor.lat - dLat,
    anchor.lon - dLon,
    anchor.lat + dLat,
    anchor.lon + dLon,
  );
  const partitions = await Promise.all(cells.map((c) => getPartition('nrhp', c)));
  const near = [];
  for (const partition of partitions) {
    for (const place of partition ?? []) {
      const d = distanceM(anchor, place);
      if (d <= radiusM) near.push({ ...place, distanceM: Math.round(d) });
    }
  }
  near.sort((a, b) => a.distanceM - b.distanceM);
  return near.slice(0, cap).map(({ name, listedYear, category, lat, lon, distanceM: d }) => ({
    name,
    listedYear,
    category,
    lat,
    lon,
    distanceM: d,
  }));
}
