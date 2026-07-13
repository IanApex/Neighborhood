// OpenStreetMap via Overpass API: what's within walking distance.
// Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
//
// Etiquette: the public instance is shared and rate-limited. One query per
// tract, cache the result, and never loop this in a hot path. For heavier
// use later, self-host or use a commercial Overpass provider.

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const WALK_RADIUS_M = 1200; // ~15-minute walk

export async function fetchAmenities({ lat, lon }) {
  const query = `
[out:json][timeout:90];
(
  nwr["amenity"](around:${WALK_RADIUS_M},${lat},${lon});
  nwr["leisure"~"^(park|playground|garden|pitch|sports_centre)$"](around:${WALK_RADIUS_M},${lat},${lon});
  nwr["shop"](around:${WALK_RADIUS_M},${lat},${lon});
);
out center tags;`;

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
  const json = await res.json();

  const counts = { amenity: {}, leisure: {}, shop: {} };
  // Street furniture and infrastructure stay in the counts but make poor
  // named examples — dense tracts fill all 40 slots with named bus shelters
  // and parking garages before a single restaurant or library shows up.
  const LOW_SIGNAL = new Set([
    'bench', 'waste_basket', 'shelter', 'toilets', 'parking',
    'parking_entrance', 'parking_space', 'bicycle_parking', 'vending_machine',
    'atm', 'telephone', 'drinking_water', 'charging_station', 'car_wash',
  ]);
  const named = [];
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    for (const kind of ['amenity', 'leisure', 'shop']) {
      const v = tags[kind];
      if (!v) continue;
      counts[kind][v] = (counts[kind][v] || 0) + 1;
      if (tags.name && !LOW_SIGNAL.has(v) && named.length < 40) {
        named.push({ kind, type: v, name: tags.name });
      }
    }
  }

  return {
    walkRadiusMeters: WALK_RADIUS_M,
    totalFeatures: (json.elements || []).length,
    counts,
    // A few real names make the narrative concrete ("the library on Main St")
    // without shipping the whole POI dump into the prompt.
    namedExamples: named,
  };
}
