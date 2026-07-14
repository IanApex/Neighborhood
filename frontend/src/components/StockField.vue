<script setup>
// BUILT + HOME. Built is the ONLY scroll-scrubbed movement in the essay:
// scroll sets a TARGET year and a rAF loop eases the visualization toward
// it — marks are never bound raw to scrollY, so a fast scroll reads as a
// graceful time-lapse, not a strobe.
//
// The field is DECADE COLUMNS, one per unit, each filling bottom-up as its
// decade passes. Equal scroll distance per decade is structural, and the
// void has a shape: the hard tract's 1970s is an empty, labeled column the
// reader watches stay empty while the year ticks.
//
// THE MARKS NEVER MOVE. Home happens in place: vacancy marks drain their
// fill to an outline (seeded, stable), the rest crossfade era tint →
// tenure tone. The homes didn't go anywhere; neither do the marks.

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
const homeCount = ref(0); // marks standing so far — "N homes"

let ctx = null;
let dpr = 1;
let w = 0;
let h = 0;
let raf = 0;
let currentYear = 1899;
let targetYear = 1899;
let settle = 0; // 0 = era tints, 1 = tenure fills (drain complete)
let settleTarget = 0;
let colors = null;
let builtTrackH = 1;
let cell = 4;
let posX = null;
let posY = null;
let columns = []; // {x, baseY, w, label} for hairlines + base labels
let washRect = null; // paper wash behind the column field only
let sortedYears = null;

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
    inkSoft: 'rgba(33, 29, 24, 0.62)',
    inkFaint: v('--ink-faint'),
    hairline: v('--hairline'),
    paper: v('--paper'),
    sans: v('--sans'),
  };
}

const columnLabel = (d) => (d.start === null ? 'pre-1940' : `’${String(d.start).slice(2)}s`);

// One column per decade unit; on narrow screens two rows of five. Cell size
// is uniform across columns — one mark is one home, everywhere — sized so
// the fullest decade fits its column.
function layout() {
  const rect = canvasEl.value.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  w = rect.width;
  h = rect.height;
  canvasEl.value.width = Math.round(w * dpr);
  canvasEl.value.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const n = decades.length;
  const top = 76;
  const captionH = 92;
  const areaX = 16;
  const areaW = w - areaX - 52; // rail keeps the right edge
  const rows = w < 640 && n > 6 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const gap = 10;
  const labelH = 20;
  const rowH = (h - top - captionH) / rows;
  const colW = (areaW - (perRow - 1) * gap) / perRow;
  const colInnerH = rowH - labelH - 12;

  const maxCount = Math.max(1, ...decades.map((d) => d.count));
  cell = Math.max(2, Math.min(9, Math.floor(Math.sqrt((colW * colInnerH) / maxCount))));
  while (cell > 2 && Math.ceil(maxCount / Math.max(1, Math.floor(colW / cell))) * cell > colInnerH) cell--;
  const cellCols = Math.max(1, Math.floor(colW / cell));

  columns = decades.map((d) => {
    const r = Math.floor(d.unitIndex / perRow);
    const k = d.unitIndex % perRow;
    return {
      x: areaX + k * (colW + gap),
      baseY: top + (r + 1) * rowH - labelH - 6,
      w: colW,
      label: columnLabel(d),
    };
  });

  washRect = { x: areaX - 10, y: top - 14, w: areaW + 20, h: rows * rowH + 22 };

  posX = new Float32Array(marks.length);
  posY = new Float32Array(marks.length);
  const perDecade = new Array(decades.length).fill(0);
  for (let i = 0; i < marks.length; i++) {
    const u = marks[i].unitIndex;
    const j = perDecade[u]++;
    const col = columns[u];
    posX[i] = col.x + (j % cellCols) * cell;
    posY[i] = col.baseY - (Math.floor(j / cellCols) + 1) * cell;
  }
  sortedYears = marks.map((m) => m.year); // marks are already year-sorted

  builtTrackH = builtTrackEl.value?.offsetHeight ?? 1;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function visibleCount(year) {
  let lo = 0;
  let hi = sortedYears.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedYears[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function draw() {
  ctx.clearRect(0, 0, w, h);
  const s = easeInOut(settle);
  const size = Math.max(1.5, cell - 1);

  // A quiet paper wash behind the column field only — the receded map
  // stays legible around it, never blanked stage-wide.
  if (washRect) {
    ctx.fillStyle = colors.paper;
    ctx.globalAlpha = 0.78;
    ctx.fillRect(washRect.x, washRect.y, washRect.w, washRect.h);
    ctx.globalAlpha = 1;
  }

  // Column bases + labels: every decade has a shape, especially the empty
  // ones — the void is a labeled column the reader watches stay empty.
  ctx.strokeStyle = colors.hairline;
  ctx.fillStyle = colors.inkSoft;
  ctx.font = `10px ${colors.sans}`;
  for (const col of columns) {
    ctx.beginPath();
    ctx.moveTo(col.x, col.baseY + 1.5);
    ctx.lineTo(col.x + col.w, col.baseY + 1.5);
    ctx.stroke();
    ctx.fillText(col.label, col.x, col.baseY + 15);
  }

  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const appear = Math.min(1, Math.max(0, (currentYear - m.year) / 1.25));
    if (appear <= 0) continue;
    const x = posX[i];
    const y = posY[i];
    const role = assignment[i];
    const era = colors.eras[m.eraIndex];
    if (role === 'vacant') {
      // Fill drains away in place; what remains is an outline — absence of
      // ink, not an alarm color.
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
      ctx.globalAlpha = appear;
      ctx.fillStyle = era;
      ctx.fillRect(x, y, size, size);
      if (s > 0.5) {
        // era tint crossfades to tenure tone, in place
        ctx.globalAlpha = appear * ((s - 0.5) * 2);
        ctx.fillStyle = role === 'owner' ? colors.owner : colors.renter;
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
  homeCount.value = visibleCount(currentYear);

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

  // Past the built track, the fills change in place. Scroll-armed but
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
    <p class="label">Each mark is one home. {{ fmt(totalUnits) }} homes.</p>
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

  <!-- Full experience: one sticky stage spans Built (scrubbed) and Home. -->
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

      <!-- Permanent caption: what a mark means, and how many stand so far.
           A second line arrives as the fills drain. -->
      <div class="stock-caption">
        <p class="label">Each mark is one home. <span class="stock-caption-count">{{ fmt(homeCount) }} homes</span></p>
        <p v-show="settleUi > 0.04" class="label stock-caption-home">
          Outlined: no household lives here.
          <span class="key"><i class="key-swatch key-swatch--owner"></i>owner</span>
          <span class="key"><i class="key-swatch key-swatch--renter"></i>renter</span>
        </p>
      </div>

      <!-- The rail: a fixed hairline with a playhead; the year counter is
           anchored to the playhead. Scrolling drags the playhead. -->
      <div class="stock-rail" :style="{ opacity: Math.max(0, 1 - settleUi * 1.6) }">
        <div class="stock-rail-line"></div>
        <div class="stock-playhead" :style="{ top: `calc(${railProgress.valueOf() * 100}% - 0px)` }">
          <span class="stock-playhead-year">{{ counterText }}</span>
          <span class="stock-playhead-tick"></span>
        </div>
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
}

/* The stage pins for the whole block; the negative margin lets the tracks
   below start at the block's top and slide across the pinned stage. The
   stage itself is transparent — the receded map shows around the field's
   paper wash (drawn inside the canvas). */
.stock-sticky {
  position: sticky;
  top: 0;
  height: 100dvh;
  margin-bottom: -100dvh;
  overflow: hidden;
}

.stock-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.stock-caption {
  position: absolute;
  left: var(--space-2);
  top: var(--space-2);
  right: 64px;
}

.stock-caption p {
  margin: 0 0 0.3rem;
  text-transform: none;
  letter-spacing: 0.04em;
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  width: fit-content;
  padding: 0.1rem 0.3rem;
  margin-left: -0.3rem;
}

.stock-caption-count {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.key {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.7rem;
}

.key-swatch {
  display: inline-block;
  width: 9px;
  height: 9px;
}

.key-swatch--owner { background: var(--owner); }
.key-swatch--renter { background: var(--renter); }

/* The rail: hairline + playhead + anchored year. */
.stock-rail {
  position: absolute;
  top: 8dvh;
  bottom: 14dvh;
  right: 18px;
  width: 1px;
}

.stock-rail-line {
  position: absolute;
  inset: 0;
  background: var(--hairline);
}

.stock-playhead {
  position: absolute;
  right: -5px;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  transform: translateY(-50%);
}

.stock-playhead-tick {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--ink);
  flex: none;
}

.stock-playhead-year {
  font-family: var(--serif);
  font-size: 2.1rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
  white-space: nowrap;
  background: color-mix(in srgb, var(--paper) 78%, transparent);
  padding: 0 0.3rem;
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
  background: var(--paper);
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
