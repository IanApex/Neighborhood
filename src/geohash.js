// Minimal geohash encoding — just enough to partition national datasets
// into KV-sized cells. A 4-character geohash cell is ~0.35° lon × 0.18° lat
// (roughly 28 × 20 km at US latitudes): coarse enough that a metro's HOLC
// polygons or historic places land in a handful of cells, fine enough that
// no partition value approaches KV's 25 MB limit.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(lat, lon, precision = 4) {
  let minLat = -90;
  let maxLat = 90;
  let minLon = -180;
  let maxLon = 180;
  let hash = '';
  let bits = 0;
  let bit = 0;
  let evenBit = true; // start with longitude
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (minLon + maxLon) / 2;
      if (lon >= mid) {
        bits = (bits << 1) | 1;
        minLon = mid;
      } else {
        bits = bits << 1;
        maxLon = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        minLat = mid;
      } else {
        bits = bits << 1;
        maxLat = mid;
      }
    }
    evenBit = !evenBit;
    if (++bit === 5) {
      hash += BASE32[bits];
      bits = 0;
      bit = 0;
    }
  }
  return hash;
}

// Cell dimensions at precision 4 (20 bits: 10 lon, 10 lat).
export const GH4_DLAT = 180 / 1024;
export const GH4_DLON = 360 / 1024;

// Every geohash-4 cell a bbox touches. Used at build time to file a polygon
// under each cell it crosses, and at query time to cover a walk radius.
export function geohash4Covering(minLat, minLon, maxLat, maxLon) {
  const cells = new Set();
  for (let lat = minLat; ; lat += GH4_DLAT) {
    const la = Math.min(lat, maxLat);
    for (let lon = minLon; ; lon += GH4_DLON) {
      const lo = Math.min(lon, maxLon);
      cells.add(geohashEncode(la, lo, 4));
      if (lo >= maxLon) break;
    }
    if (la >= maxLat) break;
  }
  return [...cells];
}
