// Small geographic helpers — no dependencies.

const M_PER_DEG_LAT = 111320;

// Circle polygon around a point, radius in meters. Used for the walk radius —
// a simple drawn line, not an isochrone.
export function circlePolygon({ lat, lon }, radiusM, steps = 96) {
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const dLat = (Math.sin(theta) * radiusM) / M_PER_DEG_LAT;
    const dLon =
      (Math.cos(theta) * radiusM) /
      (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    coords.push([lon + dLon, lat + dLat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {},
  };
}

// Bounds that roughly frame the tract: centroid ± half of sqrt(land area),
// with a floor so tiny tracts don't over-zoom and a cap so a huge rural
// tract can't degenerate into a county-scale establishing shot.
//
// The establishing shot must contain the protagonist: when `include` (the
// input anchor) falls outside the centroid box, the bounds extend to hold
// it plus ~12% padding so the you-dot is never edge-pinned. (De Pere's
// anchor sits 3.41 km north of the centroid; the fitted half-height was
// 3.29 km — the dot rendered just offscreen on desktop.)
export function tractBounds(tract, include = null) {
  const half = Math.min(9000, Math.max(900, Math.sqrt(tract.areaLandSqM || 0) * 0.75));
  const { lat, lon } = tract.centroid;
  const dLat = half / M_PER_DEG_LAT;
  const dLon = half / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  let west = lon - dLon;
  let south = lat - dLat;
  let east = lon + dLon;
  let north = lat + dLat;

  if (include && Number.isFinite(include.lat) && Number.isFinite(include.lon)) {
    const padLat = (north - south) * 0.12;
    const padLon = (east - west) * 0.12;
    if (include.lat > north - padLat) north = include.lat + padLat;
    if (include.lat < south + padLat) south = include.lat - padLat;
    if (include.lon > east - padLon) east = include.lon + padLon;
    if (include.lon < west + padLon) west = include.lon - padLon;
  }

  return [
    [west, south],
    [east, north],
  ];
}

export function boundsAround({ lat, lon }, radiusM) {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLon = radiusM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
  ];
}
