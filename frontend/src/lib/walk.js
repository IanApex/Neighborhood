// Walk-order logic for the you-dot: visit pins nearest-next from wherever
// the dot stands, so the walk never zigzags. Pure and unit-tested.

const dist = (a, b) =>
  Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180));

export function orderPinsGreedy(from, pins) {
  const remaining = pins.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const ordered = [];
  let here = from;
  while (remaining.length) {
    remaining.sort((a, b) => dist(here, a) - dist(here, b));
    here = remaining.shift();
    ordered.push(here);
  }
  return ordered;
}
