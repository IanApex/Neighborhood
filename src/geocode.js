// Census Geocoder: resolve an address or lat/lon to a census tract.
// Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
// NOTE: This API does not support CORS — server/CLI only, never call from the browser.

const BASE = 'https://geocoding.geo.census.gov/geocoder/geographies';
const COMMON = 'benchmark=Public_AR_Current&vintage=Current_Current&format=json';

function extractTract(json) {
  const tracts = json?.result?.geographies?.['Census Tracts'];
  if (!tracts?.length) return null;
  const t = tracts[0];
  return {
    geoid: t.GEOID,          // 11-digit: state(2) + county(3) + tract(6)
    state: t.STATE,
    county: t.COUNTY,
    tract: t.TRACT,
    name: t.NAME,
    centroid: {
      lat: parseFloat(t.CENTLAT),
      lon: parseFloat(t.CENTLON),
    },
    areaLand: t.AREALAND,    // square meters
    areaWater: t.AREAWATER,
  };
}

export async function tractFromAddress(address) {
  const url = `${BASE}/onelineaddress?address=${encodeURIComponent(address)}&${COMMON}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const json = await res.json();

  const match = json?.result?.addressMatches?.[0];
  if (!match) return null;

  const tracts = match.geographies?.['Census Tracts'];
  if (!tracts?.length) return null;
  const t = tracts[0];
  return {
    matchedAddress: match.matchedAddress,
    location: { lat: match.coordinates?.y, lon: match.coordinates?.x },
    tract: {
      geoid: t.GEOID,
      state: t.STATE,
      county: t.COUNTY,
      tract: t.TRACT,
      name: t.NAME,
      centroid: { lat: parseFloat(t.CENTLAT), lon: parseFloat(t.CENTLON) },
      areaLand: t.AREALAND,
      areaWater: t.AREAWATER,
    },
  };
}

export async function tractFromCoordinates(lat, lon) {
  // Note: x = longitude, y = latitude per Census API convention.
  const url = `${BASE}/coordinates?x=${lon}&y=${lat}&${COMMON}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const json = await res.json();
  const tract = extractTract(json);
  return tract ? { location: { lat, lon }, tract } : null;
}
