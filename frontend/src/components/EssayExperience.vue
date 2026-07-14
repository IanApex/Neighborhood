<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { fixtureFor } from '../fixtures/index.js';
import { decadesFrom } from '../lib/stock.js';
import { useReducedMotion, observeReveals } from '../lib/motion.js';
import MapStage from './MapStage.vue';
import StockField from './StockField.vue';
import TheRecord from './TheRecord.vue';

const props = defineProps({
  geoid: { type: String, required: true },
  addressText: { type: String, required: true },
  fromRect: { type: Object, default: null },
});
const emit = defineEmits(['close']);

const { dossier, essay } = fixtureFor(props.geoid);
const reducedMotion = useReducedMotion();

const movement = (id) => essay.movements.find((m) => m.id === id) ?? null;
const arrival = movement('arrival');
const built = movement('built');
const home = movement('home');
const walking = movement('walking');

// ——— resolution ritual state ———
const root = ref(null);
const dedicationEl = ref(null);
const flipDone = ref(!props.fromRect);
const ritualStep = ref(0); // 1: tract line, 2: "Reading the record."
const mapSettled = ref(false);
const receded = ref(false);
const scrollArmed = ref(false); // reader has passed the closing sentinel
const dotHome = ref(false); // the walk's final leg has returned to the anchor
// The chrome recedes only when BOTH are true: the reader is at the page's
// end AND the walk has closed its loop.
const closing = computed(() => scrollArmed.value && dotHome.value);
const mapStage = ref(null);

const tractLine = computed(() => {
  const name = dossier.tractCore.layers.core?.tractName ?? dossier.tractCore.tract.name;
  return name.split(/;\s*/).join(' · ');
});

const beat = () =>
  new Promise((r) =>
    setTimeout(r, reducedMotion.value ? 120 : parseInt(getComputedStyle(document.documentElement).getPropertyValue('--beat')) || 900),
  );

// The typed address migrates to become the dedication line — a FLIP from
// the input's rect to the title position. Under reduced motion it simply
// appears.
async function flipDedication() {
  if (!props.fromRect || reducedMotion.value) {
    flipDone.value = true;
    return;
  }
  await nextTick();
  const target = dedicationEl.value.getBoundingClientRect();
  const clone = document.createElement('div');
  clone.className = 'dedication-clone';
  clone.textContent = props.addressText;
  Object.assign(clone.style, {
    position: 'fixed',
    top: `${props.fromRect.top}px`,
    left: `${props.fromRect.left}px`,
    fontSize: '1.125rem',
    zIndex: 30,
  });
  document.body.appendChild(clone);
  clone.getBoundingClientRect(); // settle initial frame
  Object.assign(clone.style, {
    transition: 'all 750ms cubic-bezier(0.22, 1, 0.36, 1)',
    top: `${target.top}px`,
    left: `${target.left}px`,
    fontSize: getComputedStyle(dedicationEl.value).fontSize,
  });
  await new Promise((r) => setTimeout(r, 780));
  flipDone.value = true;
  clone.remove();
}

// Title page composing itself: address, then tract, then the reading line —
// quiet, typographic, no spinners.
async function runRitual() {
  await flipDedication();
  await beat();
  ritualStep.value = 1;
  await beat();
  ritualStep.value = 2;
  await beat();
  await mapStage.value.beginArrival(); // the map draws in the order of knowing
  mapSettled.value = true;
  await nextTick();
  observeReveals(root.value);
  window.__arrivalSettled = true; // smoke-test hook
}

// ——— movement transitions (IntersectionObserver only) ———
const stockEl = ref(null);
const walkingEl = ref(null);
const walkPrepSentinel = ref(null);
const closingSentinel = ref(null);
const walkingReady = ref(false); // beginWalking's promise has resolved
let sectionIO = null;
let pinIO = null;
let walkingStarted = false;
let pendingPinParas = []; // paragraphs seen before the map was back

const walkingParagraphs = computed(() => {
  if (walking?.paragraphs?.length) return walking.paragraphs;
  const paras = (walking?.text ?? '').split(/\n\n+/).map((text) => ({ text, pins: null }));
  // Fallback: chunk plotted examples evenly across paragraphs.
  const plottable = dossier.addressContext.amenities?.namedExamples.filter((e) => e.lat != null) ?? [];
  const per = Math.ceil(plottable.length / Math.max(1, paras.length));
  return paras.map((p, i) => ({
    text: p.text,
    pins: plottable.slice(i * per, (i + 1) * per).map((e) => e.name),
  }));
});

function resolvePins(names) {
  const pool = [...(dossier.addressContext.amenities?.namedExamples ?? [])];
  return (names ?? [])
    .map((n) => {
      const i = pool.findIndex((e) => e.name === n);
      return i === -1 ? null : pool.splice(i, 1)[0];
    })
    .filter(Boolean);
}

// Strict Walking sequence: map fully back → radius drawn → paragraph and
// its pins → the you-dot sets off toward them. Nothing lands early.
// Pins are visited nearest-next from wherever the dot stands, so the walk
// never zigzags; after the LAST paragraph the dot walks home and only
// then may the chrome recede — the loop always closes.
function dropPinsFor(idx) {
  const pins = resolvePins(walkingParagraphs.value[idx]?.pins).filter((p) => p.lat != null);
  const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180));
  if (pins.length) {
    let from = mapStage.value.youPosition() ?? dossier.addressContext.anchor;
    const remaining = [...pins];
    const ordered = [];
    while (remaining.length) {
      remaining.sort((a, b) => dist(from, a) - dist(from, b));
      from = remaining.shift();
      ordered.push(from);
    }
    mapStage.value.addPins(ordered);
    for (const pin of ordered) mapStage.value.walkTo(pin); // the reader accompanies themselves
  }
  if (idx === walkingParagraphs.value.length - 1) {
    mapStage.value.walkTo(dossier.addressContext.anchor).then(() => {
      dotHome.value = true; // the walk ends at home
    });
  }
}

async function startWalking() {
  if (walkingStarted) return;
  walkingStarted = true;
  receded.value = false;
  await mapStage.value.beginWalking();
  walkingReady.value = true;
  for (const idx of pendingPinParas) dropPinsFor(idx);
  pendingPinParas = [];
}

function setupSectionObservers() {
  sectionIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        // Armed when the reader has scrolled a full quiet screen past the
        // final line — and STAYS armed below it (the colophon lives past
        // the sentinel); disarms only on scrolling back above.
        if (e.target === closingSentinel.value) {
          scrollArmed.value = e.isIntersecting || e.boundingClientRect.top < 0;
          continue;
        }
        if (!e.isIntersecting) continue;
        if (e.target === stockEl.value) receded.value = true;
        if (e.target === walkingEl.value) startWalking(); // safety net
      }
    },
    { threshold: 0.05 },
  );
  if (stockEl.value) sectionIO.observe(stockEl.value);
  if (walkingEl.value) sectionIO.observe(walkingEl.value);
  if (closingSentinel.value) sectionIO.observe(closingSentinel.value);

  // The map's return is armed as the field's exit fade begins — the radius
  // finishes drawing as the field clears, and both are done before any
  // Walking prose arrives.
  const prepIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          startWalking();
          prepIO.disconnect();
        }
      }
    },
    { rootMargin: '0px 0px 60% 0px' },
  );
  if (walkPrepSentinel.value) prepIO.observe(walkPrepSentinel.value);

  // Pins appear in sync with the sentence that names them — and never
  // before the map has fully returned. Only named, coordinate-bearing
  // examples are ever plotted.
  pinIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const idx = Number(e.target.dataset.para);
        if (walkingReady.value) dropPinsFor(idx);
        else pendingPinParas.push(idx);
        pinIO.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -18% 0px' },
  );
  for (const el of walkingEl.value?.querySelectorAll('[data-para]') ?? []) pinIO.observe(el);
}

const recordEl = ref(null);
function scrollToRecord() {
  recordEl.value?.$el?.scrollIntoView({
    behavior: reducedMotion.value ? 'auto' : 'smooth',
  });
}

function savePortrait() {
  const yearBuilt = dossier.tractCore.layers.yearBuilt;
  const tenure = dossier.tractCore.layers.core?.tenure;
  const totalUnits = yearBuilt?.totalUnits ?? 0;
  mapStage.value.exportPortrait({
    dedication: props.addressText,
    tractLine: tractLine.value,
    decades: decadesFrom(yearBuilt),
    totalUnits,
    vacancy: tenure?.totalOccupied != null ? Math.max(0, totalUnits - tenure.totalOccupied) : 0,
  });
}

onMounted(() => {
  window.scrollTo(0, 0);
  runRitual(); // the essay always composes, whatever else fails
  try {
    setupSectionObservers();
  } catch (err) {
    console.error('section observers failed', err);
  }
});

onUnmounted(() => {
  sectionIO?.disconnect();
  pinIO?.disconnect();
});
</script>

<template>
  <div ref="root" class="experience" :class="{ 'experience--closing': closing }">
    <MapStage ref="mapStage" :dossier="dossier" :receded="receded" :reduced-motion="reducedMotion" />

    <article class="essay">
      <h1 class="sr-only">{{ essay.title }}</h1>

      <!-- Dedication + resolution ritual: a title page composing itself. -->
      <header class="frontispiece">
        <p ref="dedicationEl" class="dedication" :class="{ 'dedication--in': flipDone }" aria-live="polite">
          {{ addressText }}
        </p>
        <div class="ritual" aria-live="polite">
          <p class="ritual-line" :class="{ 'ritual-line--in': ritualStep >= 1 }">{{ tractLine }}</p>
          <p class="ritual-line label" :class="{ 'ritual-line--in': ritualStep >= 2 }">Reading the record.</p>
        </div>
      </header>

      <!-- ARRIVAL — second person, after the map settles. -->
      <section v-if="arrival" class="movement movement--arrival" aria-label="Arrival">
        <div class="prose-card" :class="{ 'prose-card--held': !mapSettled }">
          <p v-for="(para, i) in arrival.text.split(/\n\n+/)" :key="i" class="reveal">{{ para }}</p>
        </div>
      </section>

      <!-- BUILT + HOME — the stock field owns this whole block. -->
      <div v-if="built && home" ref="stockEl">
        <StockField
          :dossier="dossier"
          :essay-built="built"
          :essay-home="home"
          :reduced-motion="reducedMotion"
        />
      </div>

      <!-- WALKING — second person; the map returns to their point. Nothing
           reveals, no pin drops, until that return has fully completed. -->
      <div ref="walkPrepSentinel" aria-hidden="true"></div>
      <section v-if="walking" ref="walkingEl" class="movement movement--walking" aria-label="Walking">
        <div
          v-for="(para, i) in walkingParagraphs"
          :key="i"
          class="prose-card prose-card--walking"
          :class="{ 'prose-card--held': !walkingReady }"
          :data-para="i"
        >
          <p class="reveal">{{ para.text }}</p>
        </div>
      </section>

      <!-- CLOSING — a quiet run-out after the final line; only when the
           reader reaches its end does the chrome recede. -->
      <div class="closing-space" aria-hidden="true">
        <div ref="closingSentinel" class="closing-sentinel"></div>
      </div>
    </article>

    <!-- Back matter: below the closing sentinel, on its own paper. -->
    <TheRecord ref="recordEl" :dossier="dossier" />

    <!-- The shareable portrait: dedication over accumulated evidence. -->
    <div class="closing-overlay" :class="{ 'closing-overlay--in': closing }">
      <p class="closing-dedication">{{ addressText }}</p>
      <p class="label">{{ tractLine }}</p>
      <button v-if="closing" class="save-button label" type="button" @click="savePortrait">
        Save this page
      </button>
      <p class="closing-attribution">© OpenStreetMap contributors · U.S. Census Bureau</p>
      <button class="record-affordance label" type="button" @click="scrollToRecord">
        The Record ↓
      </button>
    </div>

    <button class="dev-back label" type="button" @click="emit('close')">fixtures</button>
  </div>
</template>

<style scoped>
.experience {
  position: relative;
}

.essay {
  position: relative;
  z-index: 1;
  transition: opacity 1600ms var(--ease-settle);
}

.experience--closing .essay {
  opacity: 0;
  pointer-events: none;
}

/* ——— frontispiece ——— */
.frontispiece {
  min-height: 46dvh;
  padding: var(--space-4) var(--space-3) 0;
}

/* Once the grid arrives beneath them, the title lines keep a paper edge. */
.dedication,
.ritual-line {
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  width: fit-content;
  max-width: 100%;
  padding: 0.1rem 0.35rem;
  margin-left: -0.35rem;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.dedication {
  font-size: var(--text-dedication);
  margin: 0 0 var(--space-3);
  opacity: 0;
}

.dedication--in {
  opacity: 1;
  transition: opacity 300ms ease;
}

.ritual-line {
  margin: 0 0 var(--space-1);
  opacity: 0;
  transform: translateY(0.3rem);
  transition: opacity var(--reveal-duration) var(--ease-settle),
    transform var(--reveal-duration) var(--ease-settle);
}

.ritual-line--in {
  opacity: 1;
  transform: none;
}

/* ——— movements ——— */
.movement {
  padding: var(--space-5) var(--space-3);
  /* positioned so movement prose always paints above the (positioned)
     sticky stock canvas that precedes it in the document */
  position: relative;
}

.movement--arrival {
  min-height: 100dvh;
  display: flex;
  align-items: flex-end;
}

.prose-card {
  background: color-mix(in srgb, var(--paper) 90%, transparent);
  padding: var(--space-2);
  max-width: var(--measure);
  transition: opacity 600ms var(--ease-settle);
}

.prose-card--held {
  opacity: 0;
}

.movement--walking {
  min-height: 220dvh;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 38dvh;
}

.prose-card--walking {
  max-width: 22rem;
}

.closing-space {
  height: 130dvh;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.closing-sentinel {
  height: 1px;
}

/* ——— closing portrait ——— */
.closing-overlay {
  position: fixed;
  inset: 0;
  z-index: 2;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  opacity: 0;
  pointer-events: none;
  transition: opacity 1600ms var(--ease-settle);
}

.closing-overlay--in {
  opacity: 1;
  pointer-events: auto;
}

.closing-dedication {
  font-size: var(--text-dedication);
  margin: 0 0 var(--space-1);
}

.closing-dedication,
.closing-overlay .label,
.save-button {
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  width: fit-content;
  padding: 0.1rem 0.35rem;
  margin-left: -0.35rem;
}

.save-button {
  margin-top: auto;
  align-self: flex-start;
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--hairline);
  color: var(--ink);
}

/* ODbL requires this on the shared state; quiet, not invisible. */
.closing-attribution {
  font-family: var(--sans);
  font-size: 0.6875rem;
  color: var(--ink-soft);
  margin: var(--space-2) 0 0;
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  width: fit-content;
  padding: 0.1rem 0.35rem;
  margin-left: -0.35rem;
}

/* The back matter's one discoverable affordance — present, never shouting. */
.record-affordance {
  align-self: flex-start;
  margin-top: var(--space-1);
  color: var(--ink-faint);
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  padding: 0.1rem 0.35rem;
  margin-left: -0.35rem;
}

.record-affordance:hover,
.record-affordance:focus-visible {
  color: var(--ink);
}

/* dev-only escape hatch back to the fixture list */
.dev-back {
  position: fixed;
  bottom: var(--space-2);
  left: var(--space-3);
  z-index: 3;
  opacity: 0.35;
}

.dev-back:hover,
.dev-back:focus-visible {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .essay,
  .closing-overlay,
  .ritual-line,
  .prose-card {
    transition-duration: 300ms;
  }
}
</style>

<style>
.dedication-clone {
  font-family: var(--serif);
  color: var(--ink);
  white-space: nowrap;
}
</style>
