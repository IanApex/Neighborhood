<script setup>
// THE RECORD — the essay's back matter. A colophon, set like a book's:
// small-caps section labels, hairline rules, sans figures. The essay
// rounds; the record is precise. Figures only — zero adjectives, zero
// comparisons, zero judgments. A ledger, not a scorecard. Sections whose
// layers are null are omitted entirely, never shown empty.

import { computed, onMounted, ref } from 'vue';
import { decadesFrom } from '../lib/stock.js';
import { drawColumnsFigure } from '../lib/columnsFigure.js';

const props = defineProps({
  dossier: { type: Object, required: true },
});

const tract = props.dossier.tractCore.tract;
const core = props.dossier.tractCore.layers.core;
const yearBuilt = props.dossier.tractCore.layers.yearBuilt;
const geography = props.dossier.tractCore.layers.geography;
const holc = props.dossier.tractCore.layers.holc;
const amenities = props.dossier.addressContext.amenities;
const historicPlaces = props.dossier.addressContext.historicPlaces ?? [];

const fmt = (n) => n.toLocaleString('en-US');
const km2 = (m2) => (m2 / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });

const countyState = computed(() => {
  const parts = (core?.tractName ?? '').split(/;\s*/);
  return parts.slice(1).join(', ');
});

const tenure = core?.tenure ?? null;
const totalUnits = yearBuilt?.totalUnits ?? null;
const vacancy = computed(() =>
  tenure?.totalOccupied != null && totalUnits != null
    ? Math.max(0, totalUnits - tenure.totalOccupied)
    : null,
);

const decades = yearBuilt ? decadesFrom(yearBuilt) : [];

const geographyItems = computed(() => {
  if (!geography) return [];
  return [
    ...geography.namedWaterways.map((x) => `${x.name} (${x.type})`),
    ...geography.namedWater.map((x) => `${x.name} (${x.type})`),
    ...geography.namedLandforms.map((x) => `${x.name} (${x.type})`),
  ];
});

// Normalized non-texture counts, as a run-in list.
const walkCounts = computed(() => {
  if (!amenities) return [];
  const items = [];
  for (const kind of ['amenity', 'leisure', 'shop']) {
    for (const [type, entry] of Object.entries(amenities.counts?.[kind] ?? {})) {
      if (entry.texture) continue;
      items.push({ type: type.replaceAll('_', ' '), count: entry.count });
    }
  }
  return items.sort((a, b) => b.count - a.count);
});

const walkMinutes = computed(() => Math.round((amenities?.walkRadiusMeters ?? 1200) / 80));

const generatedAt = computed(() => {
  const d = new Date(props.dossier.generatedAt);
  return isNaN(d) ? props.dossier.generatedAt : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
});

// The BUILT figure — shared renderer with the portrait export.
const figureEl = ref(null);
onMounted(() => {
  if (!figureEl.value || !decades.length) return;
  const cs = getComputedStyle(document.documentElement);
  const tokens = {
    eras: Array.from({ length: 10 }, (_, i) => cs.getPropertyValue(`--era-${i}`).trim()),
    hairline: cs.getPropertyValue('--hairline').trim(),
    ink: cs.getPropertyValue('--ink').trim(),
    sans: cs.getPropertyValue('--sans').trim(),
  };
  const rect = figureEl.value.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  figureEl.value.width = Math.round(rect.width * dpr);
  figureEl.value.height = Math.round(rect.height * dpr);
  const ctx = figureEl.value.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawColumnsFigure(ctx, { x: 0, y: 6, w: rect.width, h: rect.height - 6, decades, tokens });
});
</script>

<template>
  <section class="record" aria-label="The Record">
    <h2 class="record-title">The Record</h2>

    <section class="record-section">
      <h3 class="record-label">Place</h3>
      <dl class="record-list">
        <div><dt>Tract</dt><dd>{{ tract.name }}</dd></div>
        <div><dt>GEOID</dt><dd>{{ tract.geoid }}</dd></div>
        <div v-if="countyState"><dt>Where</dt><dd>{{ countyState }}</dd></div>
        <div><dt>Land</dt><dd>{{ km2(tract.areaLandSqM) }} km²</dd></div>
        <div><dt>Water</dt><dd>{{ km2(tract.areaWaterSqM) }} km²</dd></div>
      </dl>
    </section>

    <section v-if="core" class="record-section">
      <h3 class="record-label">People &amp; Homes</h3>
      <dl class="record-list">
        <div><dt>Population</dt><dd>{{ fmt(core.population) }}</dd></div>
        <div v-if="totalUnits != null"><dt>Housing units</dt><dd>{{ fmt(totalUnits) }}</dd></div>
        <div v-if="tenure"><dt>Households</dt><dd>{{ fmt(tenure.totalOccupied) }}</dd></div>
        <div v-if="tenure"><dt>Owner-occupied</dt><dd>{{ fmt(tenure.ownerOccupied) }}</dd></div>
        <div v-if="tenure"><dt>Renter-occupied</dt><dd>{{ fmt(tenure.renterOccupied) }}</dd></div>
      </dl>
      <p v-if="vacancy != null" class="record-arithmetic">
        {{ fmt(totalUnits) }} − {{ fmt(tenure.totalOccupied) }} =
        {{ fmt(vacancy) }} units without a household
      </p>
    </section>

    <section v-if="decades.length" class="record-section">
      <h3 class="record-label">Built</h3>
      <canvas ref="figureEl" class="record-figure" aria-hidden="true"></canvas>
      <dl class="record-list record-list--columns">
        <div v-for="d in decades" :key="d.label"><dt>{{ d.display }}</dt><dd>{{ fmt(d.count) }}</dd></div>
      </dl>
      <p v-if="core?.medianYearBuilt" class="record-arithmetic">
        median year built {{ core.medianYearBuilt }}
      </p>
    </section>

    <section v-if="holc || historicPlaces.length" class="record-section">
      <h3 class="record-label">History</h3>
      <dl v-if="holc" class="record-list">
        <div><dt>HOLC grade</dt><dd>{{ holc.grade }}</dd></div>
        <div><dt>Category</dt><dd>{{ holc.category }}</dd></div>
        <div><dt>City surveyed</dt><dd>{{ holc.city }}</dd></div>
        <div v-if="holc.year"><dt>Map year</dt><dd>{{ holc.year }}</dd></div>
      </dl>
      <p v-if="holc" class="record-arithmetic">{{ holc.definition }}</p>
      <dl v-if="historicPlaces.length" class="record-list" :class="{ 'record-history-places': holc }">
        <div v-for="p in historicPlaces" :key="p.name">
          <dt>{{ p.name }}</dt>
          <dd>{{ p.listedYear ?? '—' }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="geographyItems.length" class="record-section">
      <h3 class="record-label">Named Geography</h3>
      <p class="record-runin">{{ geographyItems.join(' · ') }}</p>
    </section>

    <section v-if="amenities" class="record-section">
      <h3 class="record-label">Within a 15-Minute Walk</h3>
      <p class="record-runin">
        <span v-for="(item, i) in walkCounts" :key="item.type"
          >{{ item.type }}&nbsp;{{ item.count }}<template v-if="i < walkCounts.length - 1"> · </template></span
        >
      </p>
      <p class="record-arithmetic">radius {{ fmt(amenities.walkRadiusMeters) }} m · about {{ walkMinutes }} minutes on foot</p>
    </section>

    <section class="record-section">
      <h3 class="record-label">Sources</h3>
      <dl class="record-list">
        <div><dt>Demographics</dt><dd>{{ dossier.sources.demographics }}</dd></div>
        <div><dt>Geocoding</dt><dd>{{ dossier.sources.geocoding }}</dd></div>
        <div><dt>Amenities</dt><dd>{{ dossier.sources.amenities }}</dd></div>
        <div v-if="dossier.sources.geography"><dt>Geography</dt><dd>{{ dossier.sources.geography }}</dd></div>
        <div v-if="dossier.sources.holc"><dt>HOLC grades</dt><dd>{{ dossier.sources.holc }}</dd></div>
        <div v-if="dossier.sources.historicPlaces"><dt>Historic places</dt><dd>{{ dossier.sources.historicPlaces }}</dd></div>
        <div><dt>Generated</dt><dd>{{ generatedAt }}</dd></div>
      </dl>
      <p class="record-closing">Every statement in this essay derives from the records above.</p>
    </section>
  </section>
</template>

<style scoped>
.record {
  position: relative;
  z-index: 3; /* above the fixed closing overlay: back matter on its own page */
  background: var(--paper);
  padding: var(--space-5) var(--space-3) var(--space-5);
  border-top: 1px solid var(--hairline);
}

/* Desktop: the record is a right-third column; the closing portrait (map +
   dedication) keeps the left two-thirds beside it. */
@media (min-width: 1024px) {
  .record {
    margin-left: 66.667vw;
    min-height: 100dvh;
    border-left: 1px solid var(--hairline);
  }
}

.record-title {
  font-family: var(--serif);
  font-weight: 500;
  font-size: 1.5rem;
  margin: 0 0 var(--space-4);
  max-width: var(--measure);
}

.record-section {
  max-width: var(--measure);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--hairline);
}

.record-label {
  font-family: var(--sans);
  font-size: var(--text-label);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-soft);
  margin: 0 0 var(--space-2);
}

.record-list {
  margin: 0;
  font-family: var(--sans);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}

.record-list > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 0.25rem 0;
}

.record-list dt {
  color: var(--ink-soft);
}

.record-list dd {
  margin: 0;
  text-align: right;
}

.record-list--columns {
  columns: 2;
  column-gap: var(--space-3);
  margin-top: var(--space-2);
}

.record-list--columns > div {
  break-inside: avoid;
}

.record-figure {
  width: 100%;
  height: 110px;
  display: block;
}

.record-arithmetic {
  font-family: var(--sans);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-soft);
  margin: var(--space-2) 0 0;
}

.record-runin {
  font-family: var(--sans);
  font-size: 0.875rem;
  line-height: 1.9;
  margin: 0;
}

.record-history-places {
  margin-top: var(--space-2);
}

.record-closing {
  font-family: var(--serif);
  font-style: italic;
  margin: var(--space-3) 0 0;
}
</style>
