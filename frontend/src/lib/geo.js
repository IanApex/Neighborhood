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
// with a floor so tiny tracts don't over-zoom.
export function tractBounds(tract) {
  const half = Math.max(900, Math.sqrt(tract.areaLandSqM || 0) * 0.75);
  const { lat, lon } = tract.centroid;
  const dLat = half / M_PER_DEG_LAT;
  const dLon = half / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat + dLat],
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
