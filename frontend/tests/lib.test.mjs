// Live-mode edge cases with pure-logic surface (B6). Component-level
// behaviors (prose-only walking, missing home movement) are guarded in the
// components and exercised by the smoke suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tractBounds } from '../src/lib/geo.js';
import { orderPinsGreedy } from '../src/lib/walk.js';

test('tractBounds contains an outlying anchor with padding', () => {
  const tract = { centroid: { lat: 44.4155, lon: -88.0375 }, areaLandSqM: 19_256_092 };
  const anchor = { lat: 44.4462, lon: -88.0605 }; // De Pere: 3.41km north of centroid
  const [[, south], [, north]] = tractBounds(tract, anchor);
  assert.ok(anchor.lat < north && anchor.lat > south, 'anchor inside bounds');
  assert.ok(north - anchor.lat > 0.0005, 'padding above the anchor, not edge-pinned');
});

test('tractBounds caps degenerate huge rural tracts', () => {
  const tract = { centroid: { lat: 44, lon: -110 }, areaLandSqM: 10_000_000_000 }; // 10,000 km²
  const [[west, south], [east, north]] = tractBounds(tract);
  const heightKm = (north - south) * 111.32;
  assert.ok(heightKm < 20, `fitted box stays street-scale-ish, got ${heightKm.toFixed(1)}km`);
  assert.ok(east > west);
});

test('orderPinsGreedy visits nearest-next, never zigzags', () => {
  const from = { lat: 0, lon: 0 };
  const pins = [
    { name: 'far', lat: 0.03, lon: 0 },
    { name: 'near', lat: 0.01, lon: 0 },
    { name: 'mid', lat: 0.02, lon: 0 },
  ];
  assert.deepEqual(orderPinsGreedy(from, pins).map((p) => p.name), ['near', 'mid', 'far']);
});

test('orderPinsGreedy drops coordinate-less pins (prose-only walking)', () => {
  const from = { lat: 0, lon: 0 };
  const pins = [
    { name: 'no-coords', lat: null, lon: null },
    { name: 'ok', lat: 0.01, lon: 0.01 },
  ];
  const ordered = orderPinsGreedy(from, pins);
  assert.deepEqual(ordered.map((p) => p.name), ['ok']);
  assert.deepEqual(orderPinsGreedy(from, [{ name: 'none', lat: null, lon: null }]), []);
});
