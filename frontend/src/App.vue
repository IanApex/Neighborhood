<script setup>
import { onMounted, ref } from 'vue';
import TractPicker from './components/TractPicker.vue';
import EssayExperience from './components/EssayExperience.vue';
import LiveRitual from './components/LiveRitual.vue';
import { fixtureFor } from './fixtures/index.js';

// Picker → (fixture) essay, or (live) ritual-while-the-pipeline-runs → essay.
// Live responses arrive in EXACTLY the fixture shape, so EssayExperience
// never knows the difference.
const picked = ref(null); // {geoid,...} | {live:{...}} | {data, addressText}

// Diptych ("then & now"), v1 sequential: address one runs a full essay;
// its closing offers address two, whose essay is synthesized WITH dossier
// one as comparison context. Both portraits close the pair.
const compareStage = ref(null); // null | 'first' | 'second'
const diptychFirst = ref(null); // {image, addressText, holcShown, geoid, grid}

// Same rounding as the worker's gridCell — the comparison cache key must
// name the exact walkshed cell essay one cached under.
const gridOf = ({ lat, lon }) =>
  `${(Math.round(lat * 500) / 500).toFixed(3)},${(Math.round(lon * 500) / 500).toFixed(3)}`;

function onPick(payload) {
  // Stage two rides with the request: the worker loads dossier one from its
  // cache and appends it as COMPARISON CONTEXT.
  if (payload.live && compareStage.value === 'second' && diptychFirst.value) {
    payload.live.requestBody = {
      ...payload.live.requestBody,
      compareGeoid: diptychFirst.value.geoid,
      compareGrid: diptychFirst.value.grid,
    };
  }
  picked.value = payload;
}

function onLiveReady(json) {
  picked.value = {
    data: json,
    addressText: picked.value.live.addressText,
  };
}

// Essay one's closing handed over its composed portrait — remember it (plus
// the cache coordinates the worker needs) and return to the input for
// address two.
function onDiptychNext(first) {
  const dossier = picked.value?.data?.dossier;
  if (!dossier) return;
  diptychFirst.value = {
    ...first,
    addressText: picked.value.addressText,
    geoid: dossier.tractCore.tract.geoid,
    grid: gridOf(dossier.addressContext.anchor),
  };
  compareStage.value = 'second';
  picked.value = null;
  window.scrollTo(0, 0);
}

function reset() {
  picked.value = null;
  compareStage.value = null;
  diptychFirst.value = null;
  window.scrollTo(0, 0);
}

// Dev affordance: /?geoid=<GEOID> deep-links a fixture (no FLIP source),
// and &at=<px> jumps the scroll — used by headless smoke tests.
onMounted(() => {
  const params = new URLSearchParams(location.search);
  const geoid = params.get('geoid');
  const fixture = geoid && fixtureFor(geoid);
  if (!fixture) return;
  const input = fixture.dossier.input;
  picked.value = {
    geoid,
    addressText: input.matchedAddress
      ? input.matchedAddress
          .toLowerCase()
          .replace(/\b([a-z])/g, (m) => m.toUpperCase())
          .replace(/\b(Wi|Il|Mi)\b/g, (m) => m.toUpperCase())
      : `${input.coordinates.lat.toFixed(4)}, ${input.coordinates.lon.toFixed(4)}`,
    fromRect: null,
  };
  const at = Number(params.get('at'));
  if (at > 0) setTimeout(() => window.scrollTo(0, at), 1200);
});
</script>

<template>
  <EssayExperience
    v-if="picked && (picked.geoid || picked.data)"
    :key="picked.geoid ?? (compareStage ?? 'live')"
    :geoid="picked.geoid ?? null"
    :data="picked.data ?? null"
    :ritual-done="!!picked.data"
    :address-text="picked.addressText"
    :from-rect="picked.fromRect ?? null"
    :diptych-stage="picked.data ? compareStage : null"
    :diptych-first="compareStage === 'second' ? diptychFirst : null"
    @close="reset"
    @diptych-next="onDiptychNext"
  />
  <LiveRitual
    v-else-if="picked?.live"
    :address-text="picked.live.addressText"
    :tract-name="picked.live.tractName"
    :from-rect="picked.live.fromRect"
    :request-body="picked.live.requestBody"
    :worker-url="picked.live.workerUrl"
    @ready="onLiveReady"
    @close="reset"
  />
  <TractPicker v-else :compare-stage="compareStage" @pick="onPick" @compare="compareStage = 'first'" />
</template>
