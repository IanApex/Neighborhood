<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import maplibregl from 'maplibre-gl';
import { circlePolygon, tractBounds, boundsAround } from '../lib/geo.js';

// The persistent map stage. It never flies, never zooms from orbit — it
// draws itself in the dossier's order of knowing: named geography inks in
// first (when the record has any), then the street grid fades up around it.
// Basemap: OpenFreeMap vector tiles (keyless), recolored to the token
// palette; everything not water or street is hidden — labels, buildings,
// POI icons are chrome the essay doesn't need.

const props = defineProps({
  dossier: { type: Object, required: true },
  receded: { type: Boolean, default: false },
  reducedMotion: { type: Boolean, default: false },
});

const container = ref(null);
const failed = ref(false);
let map = null;
let markers = [];
let styleReady = null; // promise

const tokens = {};
function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  for (const t of ['paper', 'ink', 'water', 'park', 'place', 'hairline']) {
    tokens[t] = cs.getPropertyValue(`--${t}`).trim();
  }
}

const hasGeography = () => {
  const g = props.dossier.tractCore.layers.geography;
  return !!g && (g.namedWaterways.length || g.namedWater.length || g.namedLandforms.length);
};

const WATER_LAYERS = ['water', 'waterway'];
const ROAD_LAYERS = ['transportation'];

function classify(layer) {
  const sl = layer['source-layer'];
  if (layer.type === 'background') return 'background';
  if (layer.type === 'symbol') return 'hide';
  if (WATER_LAYERS.includes(sl)) return 'water';
  if (ROAD_LAYERS.includes(sl)) {
    // Casings are white halos in the source style; inked they'd double
    // every road's weight. The grid should be one quiet line per street.
    if (/casing|bridge|tunnel/.test(layer.id)) return 'hide';
    return layer.type === 'line' ? 'road' : 'hide';
  }
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

// Rewrite the style BEFORE the first frame paints: the page must open as
// blank paper, never flash the source basemap. (Recoloring after `load`
// leaves a beat where positron's own colors are visible.)
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
    }
    return copy;
  });
  return { ...next, layers };
}

const wait = (ms) => new Promise((r) => setTimeout(r, props.reducedMotion ? Math.min(ms, 350) : ms));

// ——— Choreography API (used by EssayExperience) ———

// Arrival: geography inks first when the record names any; otherwise the
// grid draws alone on the same white page, same timing. The data decides.
async function beginArrival() {
  try {
    await styleReady;
  } catch {
    return; // tiles unreachable: the essay proceeds on paper
  }
  if (hasGeography()) {
    setGroup('water', 0.85, 2200);
    await wait(2400);
  } else {
    await wait(2400); // the same beat, visibly quiet — silence is choreography
  }
  setGroup('road', 0.32, 2200);
  await wait(2200);
}

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

  // The 15-minute radius breathes out as a simple drawn line.
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

// The shareable portrait: nothing but accumulated evidence — the map as it
// stands (geography, grid, radius — all in the GL canvas), the named marks,
// and the dedication line.
function exportPortrait({ dedication, tractLine }) {
  const gl = map.getCanvas();
  const scale = window.devicePixelRatio || 1;
  const out = document.createElement('canvas');
  out.width = gl.width;
  out.height = gl.height;
  const ctx = out.getContext('2d');
  const cs = getComputedStyle(document.documentElement);

  ctx.fillStyle = tokens.paper;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(gl, 0, 0);

  // Named marks, projected from the live map.
  const serif = cs.getPropertyValue('--serif').trim();
  const sans = cs.getPropertyValue('--sans').trim();
  for (const marker of markers) {
    const pos = map.project(marker.getLngLat());
    const isPark = marker.getElement().classList.contains('map-pin--park');
    ctx.fillStyle = isPark ? tokens.park : tokens.place;
    ctx.beginPath();
    ctx.arc(pos.x * scale, pos.y * scale, 3.5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = tokens.ink;
    ctx.font = `${10 * scale}px ${sans}`;
    ctx.fillText(marker.getElement().textContent, pos.x * scale + 7 * scale, pos.y * scale + 3.5 * scale);
  }

  // Dedication at top — the page's title, set in the essay serif.
  ctx.fillStyle = tokens.ink;
  ctx.font = `${18 * scale}px ${serif}`;
  ctx.fillText(dedication, 20 * scale, 34 * scale);
  ctx.font = `${11 * scale}px ${sans}`;
  ctx.fillStyle = tokens.ink + 'aa';
  ctx.fillText(tractLine, 20 * scale, 52 * scale);

  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = `neighborhood-${props.dossier.tractCore.tract.geoid}.png`;
  a.click();
}

defineExpose({ beginArrival, beginWalking, addPins, exportPortrait, failed });

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
      bounds: tractBounds(props.dossier.tractCore.tract),
      fitBoundsOptions: { padding: 24 },
      interactive: false,
      attributionControl: { compact: true },
      preserveDrawingBuffer: true,
      fadeDuration: 0,
    });
    map.on('idle', () => (window.__mapIdle = true)); // smoke-test hook
    map.on('load', resolveStyle);
    map.on('error', (e) => {
      failed.value = true;
      rejectStyle(e);
    });
  })();
});

onUnmounted(() => {
  markers.forEach((m) => m.remove());
  map?.remove();
});
</script>

<template>
  <div class="map-stage" :class="{ 'map-stage--receded': receded }" aria-hidden="true">
    <div ref="container" class="map-canvas"></div>
  </div>
</template>

<style scoped>
.map-stage {
  position: fixed;
  inset: 0;
  z-index: 0;
  transition: opacity 1500ms var(--ease-settle);
}

.map-stage--receded {
  opacity: 0.14;
}

.map-canvas {
  width: 100%;
  height: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .map-stage {
    transition: opacity 300ms ease;
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
