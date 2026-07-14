<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import maplibregl from 'maplibre-gl';
import { circlePolygon, tractBounds, boundsAround } from '../lib/geo.js';
import { drawColumnsFigure } from '../lib/columnsFigure.js';

// The persistent map stage. It never flies, never zooms from orbit — it
// draws itself in the dossier's order of knowing: named geography inks in
// first (when the record has any), then the street grid fades up around it.
// Basemap: OpenFreeMap vector tiles (keyless), recolored to the token
// palette before first paint. The tiles already hold building and park
// geometry — we show it (faint ink fabric, token green) instead of hiding
// it; buildings are never era-colored because we don't know their ages.
//
// THE YOU-DOT: the essay's protagonist. A small breathing ink dot at the
// input anchor — no label, no marker chrome. It appears as the LAST thing
// arrival draws and never leaves: full opacity through the recede, walking
// with the reader in Walking, present in the portrait. Never removed.

const props = defineProps({
  dossier: { type: Object, required: true },
  receded: { type: Boolean, default: false },
  reducedMotion: { type: Boolean, default: false },
});

const container = ref(null);
const failed = ref(false);
const youVisible = ref(false);
const youPx = ref({ x: -100, y: -100 });
let map = null;
let markers = [];
let styleReady = null; // promise
let arrivalDone = false;
let youLngLat = null;
let trailCoords = [];
let dashTimer = 0;

const tokens = {};
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  for (const t of ['paper', 'ink', 'water', 'park', 'place', 'hairline', 'owner', 'renter']) {
    tokens[t] = cs.getPropertyValue(`--${t}`).trim();
  }
  tokens.serif = cs.getPropertyValue('--serif').trim();
  tokens.sans = cs.getPropertyValue('--sans').trim();
  tokens.eras = Array.from({ length: 10 }, (_, i) => cs.getPropertyValue(`--era-${i}`).trim());
}

const hasGeography = () => {
  const g = props.dossier.tractCore.layers.geography;
  return !!g && (g.namedWaterways.length || g.namedWater.length || g.namedLandforms.length);
};

// ——— layer groups & opacity targets ———

const OPACITY = {
  arrival: { water: 0.85, road: 0.32, building: 0, park: 0 },
  receded: { water: 0.4, road: 0.16, building: 0.07, park: 0 },
  walking: { water: 0.85, road: 0.32, building: 0.07, park: 0.35 },
};

function classify(layer) {
  const sl = layer['source-layer'];
  if (layer.type === 'background') return 'background';
  if (layer.type === 'symbol') return 'hide';
  if (['water', 'waterway'].includes(sl)) return 'water';
  if (sl === 'transportation') {
    // Casings are white halos in the source style; inked they'd double
    // every road's weight. The grid should be one quiet line per street.
    if (/casing|bridge|tunnel/.test(layer.id)) return 'hide';
    return layer.type === 'line' ? 'road' : 'hide';
  }
  if (sl === 'building' && layer.type === 'fill') return 'building';
  if (layer.type === 'fill' && (sl === 'park' || (sl === 'landcover' && /park|grass|wood/.test(layer.id))))
    return 'park';
  return 'hide';
}

const opacityProp = { fill: 'fill-opacity', line: 'line-opacity' };

function setGroup(group, opacity, durationMs) {
  if (!map) return;
  for (const layer of map.getStyle().layers) {
    if (classify(layer) !== group) continue;
    const prop = opacityProp[layer.type];
    if (!prop) continue;
    map.setPaintProperty(layer.id, `${prop}-transition`, {
      duration: props.reducedMotion ? 300 : durationMs,
    });
    map.setPaintProperty(layer.id, prop, opacity);
  }
}

function applyState(state, durationMs = 1500) {
  for (const [group, value] of Object.entries(OPACITY[state])) {
    // Once the built fabric has surfaced it stays; never re-hide it.
    if (group === 'building' && value === 0 && arrivalDone) continue;
    if (group === 'park' && value === 0 && state !== 'arrival') continue;
    setGroup(group, value, durationMs);
  }
}

// Rewrite the style BEFORE the first frame paints: the page must open as
// blank paper, never flash the source basemap.
function transformStyle(next) {
  const layers = next.layers.map((layer) => {
    const group = classify(layer);
    const copy = { ...layer, paint: { ...(layer.paint ?? {}) }, layout: { ...(layer.layout ?? {}) } };
    if (group === 'background') {
      copy.paint['background-color'] = tokens.paper;
    } else if (group === 'hide') {
      copy.layout.visibility = 'none';
    } else if (group === 'water') {
      copy.paint[`${layer.type}-color`] = tokens.water;
      copy.paint[opacityProp[layer.type]] = 0;
    } else if (group === 'road') {
      copy.paint['line-color'] = tokens.ink;
      copy.paint['line-opacity'] = 0;
    } else if (group === 'building') {
      copy.paint['fill-color'] = tokens.ink;
      copy.paint['fill-opacity'] = 0;
      delete copy.paint['fill-outline-color'];
    } else if (group === 'park') {
      copy.paint['fill-color'] = tokens.park;
      copy.paint['fill-opacity'] = 0;
    }
    return copy;
  });
  // Self-hosted Literata Italic glyphs: the only text the map ever sets is
  // the dossier's named water, in the essay's own serif. Every source
  // symbol layer is hidden, so no other glyph stack is ever requested.
  return { ...next, layers, glyphs: `${location.origin}/glyphs/{fontstack}/{range}.pbf` };
}

// The map says the river's name — and nothing else. Labels exist only for
// names present in the dossier's geography layer; an empty layer means an
// unlabeled map. They ink in WITH the water, same timing.
function addWaterLabels() {
  const g = props.dossier.tractCore.layers.geography;
  const waterwayNames = (g?.namedWaterways ?? []).map((x) => x.name);
  const waterNames = (g?.namedWater ?? []).map((x) => x.name);
  if (!waterwayNames.length && !waterNames.length) return;

  const sourceId = Object.entries(map.getStyle().sources).find(([, s]) => s.type === 'vector')?.[0];
  if (!sourceId) return;

  const common = {
    type: 'symbol',
    source: sourceId,
    paint: { 'text-color': tokens.ink, 'text-opacity': 0 },
  };
  if (waterwayNames.length) {
    map.addLayer({
      ...common,
      id: 'named-waterway-labels',
      'source-layer': 'waterway',
      filter: ['in', ['get', 'name'], ['literal', waterwayNames]],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-font': ['Literata Italic'],
        'text-size': 11.5,
        'text-letter-spacing': 0.06,
      },
    });
  }
  if (waterNames.length) {
    map.addLayer({
      ...common,
      id: 'named-water-labels',
      'source-layer': 'water_name',
      filter: ['in', ['get', 'name'], ['literal', waterNames]],
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['get', 'name'],
        'text-font': ['Literata Italic'],
        'text-size': 12.5,
        'text-letter-spacing': 0.08,
      },
    });
  }
}

function fadeWaterLabels(durationMs) {
  for (const id of ['named-waterway-labels', 'named-water-labels']) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'text-opacity-transition', {
      duration: props.reducedMotion ? 300 : durationMs,
    });
    map.setPaintProperty(id, 'text-opacity', 0.65);
  }
}

// Rivers move; showing that is true, not editorial. A slow dash-flow on
// waterway line layers, phase-cycled since dasharray has no offset.
const DASH_PHASES = [
  [0, 2.5, 2.5],
  [0.8, 2.5, 1.7],
  [1.7, 2.5, 0.8],
  [2.5, 2.5, 0.001],
];
function startDashFlow() {
  if (props.reducedMotion || dashTimer) return;
  const ids = map
    .getStyle()
    .layers.filter((l) => l['source-layer'] === 'waterway' && l.type === 'line')
    .map((l) => l.id);
  if (!ids.length) return;
  let phase = 0;
  dashTimer = setInterval(() => {
    phase = (phase + 1) % DASH_PHASES.length;
    for (const id of ids) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-dasharray', DASH_PHASES[phase]);
    }
  }, 400);
}

// ——— the you-dot ———

function reprojectYou() {
  if (!map || !youLngLat) return;
  const p = map.project(youLngLat);
  youPx.value = { x: p.x, y: p.y };
}

function showYou() {
  const { anchor } = props.dossier.addressContext;
  youLngLat = new maplibregl.LngLat(anchor.lon, anchor.lat);
  trailCoords = [[anchor.lon, anchor.lat]];
  reprojectYou();
  youVisible.value = true;
}

function ensureTrailLayer() {
  if (map.getSource('you-trail')) return;
  map.addSource('you-trail', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: trailCoords } },
  });
  map.addLayer({
    id: 'you-trail-line',
    type: 'line',
    source: 'you-trail',
    paint: {
      'line-color': tokens.ink,
      'line-width': 1.4,
      'line-opacity': 0.35,
      'line-dasharray': [0.1, 2],
    },
  });
}

// Ease the dot from where it is toward a target — a walking-pace straight
// line, leaving a faint dotted trail of where it's been.
let walkQueue = Promise.resolve();
function walkTo(lngLatLike) {
  walkQueue = walkQueue.then(
    () =>
      new Promise((resolve) => {
        if (!map || !youLngLat) return resolve();
        ensureTrailLayer();
        const from = youLngLat;
        const to = new maplibregl.LngLat(lngLatLike.lon, lngLatLike.lat);
        if (props.reducedMotion) {
          youLngLat = to;
          trailCoords.push([to.lng, to.lat]);
          map.getSource('you-trail').setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: trailCoords },
          });
          reprojectYou();
          return resolve();
        }
        // Walking-pace feel, scaled to the leg: short hops stay brisk, the
        // longest leg tops out at 2s so a many-pin walk still completes
        // within the closing run-out.
        const meters =
          Math.hypot(
            (to.lat - from.lat) * 111_320,
            (to.lng - from.lng) * 111_320 * Math.cos((from.lat * Math.PI) / 180),
          ) || 0;
        const dur = Math.min(2000, Math.max(700, meters * 1.6));
        const t0 = performance.now();
        const step = (now) => {
          const t = Math.min(1, (now - t0) / dur);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          youLngLat = new maplibregl.LngLat(
            from.lng + (to.lng - from.lng) * e,
            from.lat + (to.lat - from.lat) * e,
          );
          trailCoords.push([youLngLat.lng, youLngLat.lat]);
          map.getSource('you-trail').setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: trailCoords },
          });
          reprojectYou();
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
  );
  return walkQueue;
}

const wait = (ms) => new Promise((r) => setTimeout(r, props.reducedMotion ? Math.min(ms, 350) : ms));

// ——— Choreography API (used by EssayExperience) ———

// Arrival: geography inks first when the record names any; otherwise the
// grid draws alone on the same white page, same timing. The data decides.
// The LAST thing arrival draws is you, standing in it.
async function beginArrival() {
  try {
    await styleReady;
  } catch {
    showYou(); // even without tiles, the essay has its protagonist
    arrivalDone = true;
    return;
  }
  if (hasGeography()) {
    addWaterLabels();
    setGroup('water', OPACITY.arrival.water, 2200);
    fadeWaterLabels(2200);
    await wait(2400);
  } else {
    await wait(2400); // the same beat, visibly quiet — silence is choreography
  }
  setGroup('road', OPACITY.arrival.road, 2200);
  startDashFlow();
  await wait(2200);
  showYou();
  arrivalDone = true;
  await wait(600);
}

// The recede is layered, not a blanket fade: water and roads drop to half,
// the undated building fabric surfaces, and the you-dot never dims (it
// lives outside the fading canvas).
watch(
  () => props.receded,
  (r) => {
    if (!arrivalDone || failed.value) return;
    applyState(r ? 'receded' : 'walking', 1500);
  },
);

// Walking: return to their point — a pan at street level, never a fly-to.
async function beginWalking() {
  try {
    await styleReady;
  } catch {
    return;
  }
  const { anchor, amenities } = props.dossier.addressContext;
  const radius = amenities?.walkRadiusMeters ?? 1200;
  map.fitBounds(boundsAround(anchor, radius * 1.25), {
    duration: props.reducedMotion ? 0 : 1600,
    essential: true,
  });
  await wait(1700);

  // The 15-minute radius breathes out as a simple drawn line; the greens
  // the tiles already hold arrive with it.
  setGroup('park', OPACITY.walking.park, 1600);
  if (!map.getSource('walk-radius')) {
    map.addSource('walk-radius', { type: 'geojson', data: circlePolygon(anchor, 1) });
    map.addLayer({
      id: 'walk-radius-line',
      type: 'line',
      source: 'walk-radius',
      paint: { 'line-color': tokens.ink, 'line-width': 1.2, 'line-opacity': 0.55 },
    });
  }
  if (props.reducedMotion) {
    map.getSource('walk-radius').setData(circlePolygon(anchor, radius));
    window.__walkingReady = true;
    return;
  }
  const t0 = performance.now();
  const grow = (now) => {
    const t = Math.min(1, (now - t0) / 1300);
    const eased = 1 - Math.pow(1 - t, 3);
    map.getSource('walk-radius').setData(circlePolygon(anchor, Math.max(1, radius * eased)));
    if (t < 1) requestAnimationFrame(grow);
  };
  requestAnimationFrame(grow);
  await wait(1300);
  window.__walkingReady = true; // smoke-test hook
}

// Only named examples with coordinates are ever plotted. Anonymous counts
// remain prose — never pin what isn't named.
function addPins(examples) {
  for (const ex of examples) {
    if (ex.lat == null || ex.lon == null) continue;
    const el = document.createElement('div');
    el.className = `map-pin ${ex.kind === 'leisure' ? 'map-pin--park' : 'map-pin--place'}`;
    el.innerHTML = `<span class="map-pin__dot"></span><span class="map-pin__label">${ex.name}</span>`;
    const marker = new maplibregl.Marker({ element: el, anchor: 'left' })
      .setLngLat([ex.lon, ex.lat])
      .addTo(map);
    markers.push(marker);
    requestAnimationFrame(() => el.classList.add('map-pin--in'));
  }
}

// ——— the portrait: a composed page of accumulated evidence ———
// Dedication on the top paper margin, the map as the central plate (with
// you-dot, trail, radius, pins, greens), a miniature of the decade columns
// as a footer band, and plain counts. Nothing else.
// The GL buffer is only guaranteed readable during a render frame — copy
// it inside a 'render' callback after forcing a repaint.
function snapshotMap() {
  return new Promise((resolve) => {
    if (!map || failed.value) return resolve(null);
    map.once('render', () => {
      const gl = map.getCanvas();
      const copy = document.createElement('canvas');
      copy.width = gl.width;
      copy.height = gl.height;
      copy.getContext('2d').drawImage(gl, 0, 0);
      resolve(copy);
    });
    map.triggerRepaint();
  });
}

async function exportPortrait({ dedication, tractLine, decades, totalUnits, vacancy }) {
  const W = 1080;
  const H = 1440;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  const snapshot = await snapshotMap();

  ctx.fillStyle = tokens.paper;
  ctx.fillRect(0, 0, W, H);

  const margin = 72;
  ctx.fillStyle = tokens.ink;
  ctx.font = `34px ${tokens.serif}`;
  ctx.fillText(dedication, margin, 96, W - margin * 2);
  ctx.font = `15px ${tokens.sans}`;
  ctx.globalAlpha = 0.62;
  ctx.fillText(tractLine.toUpperCase(), margin, 128, W - margin * 2);
  ctx.globalAlpha = 1;

  // Central plate: the map snapshot, center-crop COVER into the frame.
  const plate = { x: margin, y: 168, w: W - margin * 2, h: 880 };
  if (snapshot) {
    const scale = Math.max(plate.w / snapshot.width, plate.h / snapshot.height);
    const sw = plate.w / scale;
    const sh = plate.h / scale;
    const sx = (snapshot.width - sw) / 2;
    const sy = (snapshot.height - sh) / 2;
    ctx.drawImage(snapshot, sx, sy, sw, sh, plate.x, plate.y, plate.w, plate.h);

    // Project map-anchored things (pins, you-dot) into plate coordinates.
    const dpr = snapshot.width / map.getContainer().clientWidth;
    const toPlate = (lngLat) => {
      const p = map.project(lngLat);
      return {
        x: plate.x + (p.x * dpr - sx) * scale,
        y: plate.y + (p.y * dpr - sy) * scale,
        inside: p.x * dpr >= sx && p.x * dpr <= sx + sw && p.y * dpr >= sy && p.y * dpr <= sy + sh,
      };
    };
    ctx.font = `13px ${tokens.sans}`;
    for (const marker of markers) {
      const pos = toPlate(marker.getLngLat());
      if (!pos.inside) continue;
      const isPark = marker.getElement().classList.contains('map-pin--park');
      ctx.fillStyle = isPark ? tokens.park : tokens.place;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = tokens.ink;
      ctx.fillText(marker.getElement().textContent, pos.x + 9, pos.y + 4);
    }
    if (youLngLat) {
      const pos = toPlate(youLngLat);
      if (pos.inside) {
        ctx.fillStyle = tokens.ink;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = tokens.ink;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.strokeStyle = tokens.hairline;
  ctx.strokeRect(plate.x + 0.5, plate.y + 0.5, plate.w - 1, plate.h - 1);

  // Footer band: the decade columns in miniature — the built story at a
  // glance, empty decades visibly empty. Shared renderer with the colophon.
  if (decades?.length) {
    const band = { x: margin, y: plate.y + plate.h + 56, w: W - margin * 2, h: 130 };
    drawColumnsFigure(ctx, { x: band.x, y: band.y, w: band.w, h: band.h, decades, tokens });

    ctx.font = `15px ${tokens.sans}`;
    ctx.fillStyle = tokens.ink;
    const counts =
      vacancy > 0
        ? `${totalUnits.toLocaleString('en-US')} homes · ${vacancy.toLocaleString('en-US')} standing empty`
        : `${totalUnits.toLocaleString('en-US')} homes`;
    ctx.fillText(counts, margin, band.y + band.h + 44);
  }

  // Required attribution: the map is ODbL-derived, the figures are Census.
  ctx.font = `12px ${tokens.sans}`;
  ctx.fillStyle = tokens.ink;
  ctx.globalAlpha = 0.55;
  ctx.fillText('© OpenStreetMap contributors · U.S. Census Bureau', margin, H - 40);
  ctx.globalAlpha = 1;

  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = `neighborhood-${props.dossier.tractCore.tract.geoid}.png`;
  a.click();
}

const youPosition = () => (youLngLat ? { lat: youLngLat.lat, lon: youLngLat.lng } : null);

defineExpose({ beginArrival, beginWalking, addPins, walkTo, youPosition, exportPortrait, failed });

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

onMounted(() => {
  readTokens();
  let resolveStyle;
  let rejectStyle;
  styleReady = new Promise((resolve, reject) => {
    resolveStyle = resolve;
    rejectStyle = reject;
  });
  styleReady.catch(() => {}); // handled at call sites

  (async () => {
    let style;
    try {
      const resp = await fetch(STYLE_URL);
      if (!resp.ok) throw new Error(`style HTTP ${resp.status}`);
      style = transformStyle(await resp.json());
    } catch (err) {
      failed.value = true; // tiles unreachable: the essay proceeds on paper
      rejectStyle(err);
      return;
    }
    map = new maplibregl.Map({
      container: container.value,
      style,
      bounds: tractBounds(props.dossier.tractCore.tract, props.dossier.addressContext.anchor),
      fitBoundsOptions: { padding: 24 },
      interactive: false,
      attributionControl: { compact: true },
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });
    map.on('idle', () => (window.__mapIdle = true)); // smoke-test hook
    map.on('move', reprojectYou);
    map.on('resize', reprojectYou);
    map.on('load', resolveStyle);
    map.on('error', (e) => {
      failed.value = true;
      rejectStyle(e);
    });
  })();
});

onUnmounted(() => {
  if (dashTimer) clearInterval(dashTimer);
  markers.forEach((m) => m.remove());
  map?.remove();
});
</script>

<template>
  <div class="map-stage" aria-hidden="true">
    <div ref="container" class="map-canvas" :class="{ 'map-canvas--receded': receded }"></div>
  </div>
  <!-- The you-dot lives OUTSIDE the map stage's stacking context entirely:
       it never dims — not through the recede, not under the field's wash. -->
  <div
    v-if="youVisible"
    class="you-dot"
    aria-hidden="true"
    :style="{ transform: `translate(${youPx.x}px, ${youPx.y}px)` }"
  >
    <span class="you-dot__core"></span>
  </div>
</template>

<style scoped>
.map-stage {
  position: fixed;
  inset: 0;
  z-index: 0;
}

.map-canvas {
  width: 100%;
  height: 100%;
  transition: opacity 1500ms var(--ease-settle);
}

/* Recede is layered: this stage dim plus per-group opacity drops set in
   script. The built fabric surfaces underneath the stock field. */
.map-canvas--receded {
  opacity: 0.45;
}

.you-dot {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2;
  pointer-events: none;
}

.you-dot__core {
  display: block;
  width: 11px;
  height: 11px;
  margin: -5.5px 0 0 -5.5px;
  border-radius: 50%;
  background: var(--ink);
  /* paper halo: the dot survives dense grids */
  box-shadow: 0 0 0 1.5px var(--paper);
  animation: you-breathe 3s ease-in-out infinite;
}

@keyframes you-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .map-canvas {
    transition: opacity 300ms ease;
  }

  /* Static ring instead of breathing. */
  .you-dot__core {
    animation: none;
    background: transparent;
    border: 2px solid var(--ink);
    opacity: 0.9;
  }
}
</style>

<style>
/* Pins are unscoped: MapLibre mounts them outside the component tree. */
.map-pin {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  opacity: 0;
  transition: opacity 700ms var(--ease-settle);
}

.map-pin--in {
  opacity: 1;
}

.map-pin__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.map-pin--place .map-pin__dot { background: var(--place); }
.map-pin--park .map-pin__dot { background: var(--park); }

.map-pin__label {
  font-family: var(--sans);
  font-size: 0.6875rem;
  color: var(--ink);
  background: color-mix(in srgb, var(--paper) 82%, transparent);
  padding: 0 0.3rem;
  border-radius: 2px;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .map-pin {
    transition: opacity 300ms ease;
  }
}
</style>
