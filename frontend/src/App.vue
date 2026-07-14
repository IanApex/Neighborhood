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

function onPick(payload) {
  picked.value = payload;
}

function onLiveReady(json) {
  picked.value = {
    data: json,
    addressText: picked.value.live.addressText,
  };
}

function reset() {
  picked.value = null;
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
    :key="picked.geoid ?? 'live'"
    :geoid="picked.geoid ?? null"
    :data="picked.data ?? null"
    :ritual-done="!!picked.data"
    :address-text="picked.addressText"
    :from-rect="picked.fromRect ?? null"
    @close="reset"
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
  <TractPicker v-else @pick="onPick" />
</template>
