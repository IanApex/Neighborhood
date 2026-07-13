// OpenStreetMap via Overpass API: what's within walking distance.
// Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
//
// Etiquette: the public instance is shared and rate-limited. One query per
// tract, cache the result, and never loop this in a hot path. For heavier
// use later, self-host or use a commercial Overpass provider.

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const WALK_RADIUS_M = 1200; // ~15-minute walk

// Shared fetch for every Overpass-backed layer (amenities, geography).
export async function overpassQuery(query) {
  const doFetch = () => fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // overpass-api.de returns 406 for requests with no User-Agent (Node's
      // fetch sends none by default), and identifying yourself is etiquette.
      'User-Agent': 'neighborhood-essay-spike/0.1',
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  let res = await doFetch();
  if ([429, 502, 504].includes(res.status)) {
    // Shared instance is busy; one polite retry after a pause.
    await new Promise((r) => setTimeout(r, 15_000));
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchAmenities({ lat, lon }) {
  const query = `
[out:json][timeout:90];
(
  nwr["amenity"](around:${WALK_RADIUS_M},${lat},${lon});
  nwr["leisure"~"^(park|playground|garden|pitch|sports_centre)$"](around:${WALK_RADIUS_M},${lat},${lon});
  nwr["shop"](around:${WALK_RADIUS_M},${lat},${lon});
);
out center tags;`;

  const json = await overpassQuery(query);

  // Raw Overpass counts are mapped features, not institutions: every dock of
  // a ferry terminal, every landscaped bed tagged garden, every building of a
  // library gets its own feature. Normalize before the narrative sees them.

  // "Infrastructure texture": kept in the counts but flagged so the narrative
  // layer treats them as texture ("a shoreline furnished for lingering"),
  // never as an inventory ("25 ferry terminals"). Also excluded from named
  // examples — dense tracts fill all 40 slots with named bus shelters and
  // parking garages before a single restaurant or library shows up.
  const TEXTURE_TYPES = new Set([
    'bench', 'garden', 'fountain', 'ferry_terminal', 'parking',
    'parking_entrance', 'parking_space', 'waste_basket', 'post_box',
    'bicycle_parking', 'toilets', 'shelter', 'drinking_water', 'loading_dock',
    'vending_machine', 'atm', 'telephone', 'charging_station', 'picnic_table',
  ]);

  // Institution-like types get deduped by name (a campus maps one university
  // as many features). Residual overcounting is still possible — unnamed
  // features each count once, and one institution can carry several distinct
  // names — so the synthesis prompt additionally hedges institution counts.
  const INSTITUTION_TYPES = new Set([
    'library', 'university', 'college', 'hospital', 'townhall',
    'fire_station', 'post_office', 'police', 'school',
  ]);

  const raw = { amenity: {}, leisure: {}, shop: {} };
  const namesSeen = new Map(); // "kind/type" -> Set of names
  const unnamed = new Map();   // "kind/type" -> count of unnamed features
  const named = [];
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    for (const kind of ['amenity', 'leisure', 'shop']) {
      const v = tags[kind];
      if (!v) continue;
      raw[kind][v] = (raw[kind][v] || 0) + 1;
      const key = `${kind}/${v}`;
      if (tags.name) {
        if (!namesSeen.has(key)) namesSeen.set(key, new Set());
        namesSeen.get(key).add(tags.name);
      } else {
        unnamed.set(key, (unnamed.get(key) || 0) + 1);
      }
      if (tags.name && !TEXTURE_TYPES.has(v) && named.length < 40) {
        // Nodes carry lat/lon directly; ways/relations get a center point
        // from `out center`. Phase 3 plots these on the map.
        const lat = el.lat ?? el.center?.lat ?? null;
        const lon = el.lon ?? el.center?.lon ?? null;
        named.push({ kind, type: v, name: tags.name, lat, lon });
      }
    }
  }

  const counts = { amenity: {}, leisure: {}, shop: {} };
  for (const kind of ['amenity', 'leisure', 'shop']) {
    for (const [v, rawCount] of Object.entries(raw[kind])) {
      const key = `${kind}/${v}`;
      const count = INSTITUTION_TYPES.has(v)
        ? (namesSeen.get(key)?.size || 0) + (unnamed.get(key) || 0)
        : rawCount;
      counts[kind][v] = TEXTURE_TYPES.has(v) ? { count, texture: true } : { count };
    }
  }

  return {
    walkRadiusMeters: WALK_RADIUS_M,
    totalFeatures: (json.elements || []).length,
    counts,
    // Raw per-feature counts, for debugging the normalization only.
    raw,
    // A few real names make the narrative concrete ("the library on Main St")
    // without shipping the whole POI dump into the prompt.
    namedExamples: named,
  };
}
