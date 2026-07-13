// Census Geocoder: resolve an address or lat/lon to a census tract.
// Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
// NOTE: This API does not support CORS — server/CLI only, never call from the browser.

const BASE = 'https://geocoding.geo.census.gov/geocoder/geographies';
const COMMON = 'benchmark=Public_AR_Current&vintage=Current_Current&format=json';

// The geocoder returns every numeric field as a string; parse at ingest so
// nothing downstream has to guess.
function shapeTract(t) {
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
    areaLand: Number(t.AREALAND),    // square meters
    areaWater: Number(t.AREAWATER),
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
  return {
    matchedAddress: match.matchedAddress,
    location: { lat: match.coordinates?.y, lon: match.coordinates?.x },
    tract: shapeTract(tracts[0]),
  };
}

export async function tractFromCoordinates(lat, lon) {
  // Note: x = longitude, y = latitude per Census API convention.
  const url = `${BASE}/coordinates?x=${lon}&y=${lat}&${COMMON}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
  const json = await res.json();
  const tracts = json?.result?.geographies?.['Census Tracts'];
  if (!tracts?.length) return null;
  return { location: { lat, lon }, tract: shapeTract(tracts[0]) };
}
