<script setup>
// BUILT + HOME. Built is the ONLY scroll-scrubbed movement in the essay:
// scroll sets a TARGET year and a rAF loop eases the visualization toward
// it — marks are never bound raw to scrollY, so a fast scroll reads as a
// graceful time-lapse, not a strobe.
//
// Equal scroll distance per decade is structural: the track height is
// (number of decade units) × one unit height, whether a decade holds 1,404
// units or zero. In the hard tract the reader scrolls the whole 1970s and
// only the year moves. That is the thesis in physics.
//
// Home reuses the SAME marks: they release from the chronological sediment
// and resettle into a plain ordered field; vacancy hollows a seeded, stable
// subset to outlines. Aggregate truth only — never on the map.

import { computed, onMounted, onUnmounted, ref } from 'vue';
import { decadesFrom, marksFrom, progressToYear } from '../lib/stock.js';
import { seedFromGeoid, seededShuffle } from '../lib/seeded.js';

const props = defineProps({
  dossier: { type: Object, required: true },
  essayBuilt: { type: Object, required: true }, // movement {text, checkpoints?}
  essayHome: { type: Object, required: true },
  reducedMotion: { type: Boolean, default: false },
});

const geoid = props.dossier.tractCore.tract.geoid;
const yearBuilt = props.dossier.tractCore.layers.yearBuilt;
const tenure = props.dossier.tractCore.layers.core?.tenure ?? null;

const decades = decadesFrom(yearBuilt);
const marks = marksFrom(decades, geoid);
const totalUnits = yearBuilt?.totalUnits ?? marks.length;

const occupied = tenure?.totalOccupied ?? null;
const vacancyCount = occupied != null ? Math.max(0, totalUnits - occupied) : 0;
const ownerCount = tenure?.ownerOccupied ?? 0;

// Seeded, stable-across-visits assignment of which marks hollow (vacant)
// and which take each tenure tone. Aggregate counts only.
const assignment = (() => {
  const order = seededShuffle(marks.length, seedFromGeoid(geoid, 13));
  const roles = new Array(marks.length).fill('renter');
  order.slice(0, vacancyCount).forEach((i) => (roles[i] = 'vacant'));
  order.slice(vacancyCount, vacancyCount + ownerCount).forEach((i) => (roles[i] = 'owner'));
  return roles;
})();

// Checkpoints: prose lands only after its decade range COMPLETES.
const checkpoints = computed(() => {
  if (props.essayBuilt.checkpoints?.length) return props.essayBuilt.checkpoints;
  // Fallback for plain-text essays: distribute evenly across the timeline.
  const paras = props.essayBuilt.text.split(/\n\n+/);
  const lastYear = decades[decades.length - 1]?.end ?? 2024;
  const firstYear = decades[0]?.end ?? 1939;
  return paras.map((text, i) => ({
    afterYear: firstYear + ((i + 1) / paras.length) * (lastYear - firstYear),
    text,
  }));
});

// Fraction of the built track at which a checkpoint's decade completes.
// The paragraph sits at that offset so the reader scrolls the data first
// and meets the language after.
function checkpointOffset(cp) {
  const idx = decades.findIndex((d) => cp.afterYear <= d.end + 0.001);
  const unit = idx === -1 ? decades.length - 1 : idx;
  return (unit + 1) / decades.length;
}

const homeParagraphs = computed(() => props.essayHome.text.split(/\n\n+/));

// ——— canvas ———
const blockEl = ref(null);
const builtTrackEl = ref(null);
const canvasEl = ref(null);
const counterText = ref(decades[0]?.display ?? '');
const railProgress = ref(0);
const settleUi = ref(0); // mirrors `settle` for template bindings

let ctx = null;
let dpr = 1;
let w = 0;
let h = 0;
let raf = 0;
let currentYear = 1899;
let targetYear = 1899;
let settle = 0; // 0 = chronological sediment, 1 = ordered home field
let settleTarget = 0;
let colors = null;
let builtTrackH = 1;
let cell = 6;
let cols = 10;

const FIRST_YEAR = 1899;
const LAST_YEAR = decades[decades.length - 1]?.end ?? 2024;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  colors = {
    eras: Array.from({ length: 10 }, (_, i) => v(`--era-${i}`)),
    owner: v('--owner'),
    renter: v('--renter'),
    ink: v('--ink'),
    inkFaint: v('--ink-faint'),
    paper: v('--paper'),
  };
}

function layout() {
  const rect = canvasEl.value.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  w = rect.width;
  h = rect.height;
  canvasEl.value.width = Math.round(w * dpr);
  canvasEl.value.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Grid that fits every unit: cell size from available area, small floor.
  const usable = w * h * 0.6;
  cell = Math.max(3, Math.floor(Math.sqrt(usable / Math.max(1, marks.length))));
  cols = Math.max(4, Math.floor((w - 32) / cell));
  builtTrackH = builtTrackEl.value?.offsetHeight ?? 1;
}

function slotPos(i) {
  return { x: 16 + (i % cols) * cell, row: Math.floor(i / cols) };
}

// Built: sediment fills bottom-up in chronological order.
// Home: the same grid read top-down — a plain ordered field.
function markPositions(i) {
  const p = slotPos(i);
  return {
    bx: p.x,
    by: h - 96 - (p.row + 1) * cell,
    hx: p.x,
    hy: 112 + p.row * cell,
  };
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function draw() {
  ctx.clearRect(0, 0, w, h);
  const s = easeInOut(settle);
  const size = Math.max(2, cell - 1.5);
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const appear = Math.min(1, Math.max(0, (currentYear - m.year) / 1.25));
    if (appear <= 0) continue;
    const { bx, by, hx, hy } = markPositions(i);
    const x = bx + (hx - bx) * s;
    const y = by + (hy - by) * s;
    if (y < -cell || y > h + cell) continue;

    const role = assignment[i];
    const era = colors.eras[m.eraIndex];
    if (role === 'vacant') {
      // Fill drains as the field settles; what remains is an outline —
      // absence of ink, not an alarm color.
      if (s < 1) {
        ctx.globalAlpha = appear * (1 - s);
        ctx.fillStyle = era;
        ctx.fillRect(x, y, size, size);
      }
      if (s > 0.5) {
        ctx.globalAlpha = (s - 0.5) * 2 * appear;
        ctx.strokeStyle = colors.inkFaint;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }
    } else {
      const tone = role === 'owner' ? colors.owner : colors.renter;
      ctx.globalAlpha = appear;
      // era tint crossfades to tenure tone across the resettle
      if (s < 0.5) {
        ctx.fillStyle = era;
        ctx.fillRect(x, y, size, size);
      } else {
        ctx.fillStyle = era;
        ctx.fillRect(x, y, size, size);
        ctx.globalAlpha = appear * ((s - 0.5) * 2);
        ctx.fillStyle = tone;
        ctx.fillRect(x, y, size, size);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function tick() {
  raf = 0;
  const dy = targetYear - currentYear;
  const ds = settleTarget - settle;
  currentYear += dy * 0.13; // inertia: time-lapse, never strobe
  settle += ds * 0.07;
  draw();

  const d = decades.find((u) => currentYear <= u.end + 0.001) ?? decades[decades.length - 1];
  counterText.value =
    d && d.start === null && currentYear <= 1939.2
      ? d.display
      : String(Math.floor(Math.min(currentYear, LAST_YEAR)));
  railProgress.value = Math.min(1, Math.max(0, (currentYear - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)));
  settleUi.value = settle;

  if (Math.abs(dy) > 0.02 || Math.abs(ds) > 0.002) raf = requestAnimationFrame(tick);
}

const kick = () => {
  if (!raf) raf = requestAnimationFrame(tick);
};

function onScroll() {
  if (!blockEl.value) return;
  const rect = blockEl.value.getBoundingClientRect();
  const intoBlock = -rect.top;
  const vh = window.innerHeight;

  // Scroll → target year. The counter/marks lead; a checkpoint paragraph at
  // offset f enters the lower viewport slightly after p passes f, so the
  // reader always experiences the data before the language confirms it.
  const p = (intoBlock + vh * 0.55) / Math.max(1, builtTrackH);
  targetYear = p <= 0 ? FIRST_YEAR : (progressToYear(p, decades) ?? FIRST_YEAR);

  // Past the built track, the marks release and resettle. Scroll-armed but
  // time-eased — Built alone owns true scrubbing.
  settleTarget = intoBlock > builtTrackH - vh * 0.25 ? 1 : 0;
  kick();
}

let ro = null;
onMounted(() => {
  if (props.reducedMotion) return; // print form is fully static markup
  readColors();
  ctx = canvasEl.value.getContext('2d');
  layout();
  window.addEventListener('scroll', onScroll, { passive: true });
  ro = new ResizeObserver(() => {
    layout();
    draw();
  });
  ro.observe(canvasEl.value);
  onScroll();
});

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  ro?.disconnect();
  if (raf) cancelAnimationFrame(raf);
});

// ——— reduced-motion small multiples ———
// One panel per decade, empty decades visibly empty. Same truth, print form.
function multiplePanel(d) {
  const colsM = 18;
  const rows = Math.max(1, Math.ceil(Math.min(d.count, 400) / colsM));
  return { colsM, height: Math.max(rows * 4, 10) };
}

const fmt = (n) => n.toLocaleString('en-US');
</script>

<template>
  <!-- Reduced motion: static small multiples, one per decade. -->
  <section v-if="reducedMotion" class="stock stock--static" aria-labelledby="built-h">
    <h2 id="built-h" class="sr-only">What was built, decade by decade</h2>
    <div class="multiples">
      <figure v-for="d in decades" :key="d.label" class="multiple">
        <figcaption>
          <span class="label">{{ d.display }}</span>
          <span class="multiple-count">{{ fmt(d.count) }}</span>
        </figcaption>
        <svg
          :viewBox="`0 0 76 ${multiplePanel(d).height}`"
          class="multiple-panel"
          :style="{ height: multiplePanel(d).height + 'px' }"
          role="img"
          :aria-label="`${fmt(d.count)} units built ${d.display}`"
        >
          <rect
            v-for="i in Math.min(d.count, 400)"
            :key="i"
            :x="((i - 1) % multiplePanel(d).colsM) * 4"
            :y="Math.floor((i - 1) / multiplePanel(d).colsM) * 4"
            width="3"
            height="3"
            :fill="`var(--era-${d.eraIndex})`"
          />
        </svg>
      </figure>
    </div>
    <div class="prose">
      <p v-for="cp in checkpoints" :key="cp.afterYear">{{ cp.text }}</p>
    </div>
    <h2 class="sr-only">Who is home</h2>
    <div class="prose">
      <p v-for="(para, i) in homeParagraphs" :key="i">{{ para }}</p>
    </div>
  </section>

  <!-- Full experience: one sticky canvas spans Built (scrubbed) and Home. -->
  <section v-else ref="blockEl" class="stock" aria-labelledby="built-h">
    <h2 id="built-h" class="sr-only">What was built, decade by decade</h2>

    <!-- The full prose exists in-flow for screen readers; the floating
         choreographed copies below are presentation. -->
    <div class="sr-only">
      <p v-for="cp in checkpoints" :key="'sr' + cp.afterYear">{{ cp.text }}</p>
      <h2>Who is home</h2>
      <p v-for="(para, i) in homeParagraphs" :key="'srh' + i">{{ para }}</p>
    </div>

    <div class="stock-sticky" aria-hidden="true">
      <canvas ref="canvasEl" class="stock-canvas"></canvas>
      <!-- Built's clock recedes as the marks resettle into the home field. -->
      <div class="stock-counter" :style="{ opacity: Math.max(0, 1 - settleUi * 1.6) }">
        {{ counterText }}
      </div>
      <div class="stock-rail" :style="{ opacity: Math.max(0, 1 - settleUi * 1.6) }">
        <div class="stock-rail-fill" :style="{ height: railProgress * 100 + '%' }"></div>
      </div>
    </div>

    <div
      ref="builtTrackEl"
      class="built-track"
      :style="{ height: decades.length * 60 + 'vh' }"
      aria-hidden="true"
    >
      <div
        v-for="cp in checkpoints"
        :key="cp.afterYear"
        class="built-paragraph"
        :style="{ top: `calc(${checkpointOffset(cp) * 100}% - 26vh)` }"
      >
        <p class="reveal">{{ cp.text }}</p>
      </div>
    </div>

    <div class="home-track" aria-hidden="true">
      <div class="home-prose">
        <p v-for="(para, i) in homeParagraphs" :key="i" class="reveal">{{ para }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stock {
  position: relative;
  background: var(--paper);
}

/* The stage pins for the whole block; the negative margin lets the tracks
   below start at the block's top and slide across the pinned stage. */
.stock-sticky {
  position: sticky;
  top: 0;
  height: 100dvh;
  margin-bottom: -100dvh;
  overflow: hidden;
  /* the stage carries its own paper so the map never reads through the
     field's hollow marks, whatever the scroll geometry */
  background: var(--paper);
}

.stock-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* The counter is the proof time passes: large but quiet. */
.stock-counter {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  font-family: var(--serif);
  font-size: var(--text-counter);
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
}

.stock-rail {
  position: absolute;
  top: 12dvh;
  bottom: 12dvh;
  right: var(--space-2);
  width: 1px;
  background: var(--hairline);
}

.stock-rail-fill {
  width: 100%;
  background: var(--ink-soft);
}

.built-track {
  position: relative;
}

.built-paragraph {
  position: absolute;
  left: 0;
  right: 0;
  padding: 0 var(--space-3);
}

.built-paragraph p {
  background: color-mix(in srgb, var(--paper) 90%, transparent);
  padding: var(--space-2);
  margin: 0;
  max-width: 24rem;
}

.home-track {
  position: relative;
  min-height: 175vh;
  display: flex;
  align-items: flex-end;
  padding: 0 var(--space-3) var(--space-5);
}

.home-prose p {
  background: color-mix(in srgb, var(--paper) 90%, transparent);
  padding: var(--space-2);
  max-width: 24rem;
}

/* Reduced-motion print form */
.stock--static {
  padding: var(--space-4) var(--space-3);
}

.multiples {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
  gap: var(--space-2);
  max-width: var(--measure);
  margin-bottom: var(--space-4);
}

.multiple {
  margin: 0;
}

.multiple figcaption {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.multiple-count {
  font-family: var(--sans);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
}

.multiple-panel {
  width: 100%;
  display: block;
  border-top: 1px solid var(--hairline);
  padding-top: 3px;
}

.prose {
  max-width: var(--measure);
}

@media (min-width: 700px) {
  .built-paragraph,
  .home-track {
    padding-left: var(--space-5);
  }
}
</style>
