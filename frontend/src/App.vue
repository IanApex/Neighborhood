<script setup>
import { onMounted, ref } from 'vue';
import TractPicker from './components/TractPicker.vue';
import EssayExperience from './components/EssayExperience.vue';
import { fixtureFor } from './fixtures/index.js';

// Picker (dev screen) → essay. The picked address text FLIPs into the
// dedication line, so the picker hands the essay the source rect.
const picked = ref(null); // { geoid, addressText, fromRect }

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

function onPick(payload) {
  picked.value = payload;
}

function reset() {
  picked.value = null;
  window.scrollTo(0, 0);
}
</script>

<template>
  <EssayExperience
    v-if="picked"
    :key="picked.geoid"
    :geoid="picked.geoid"
    :address-text="picked.addressText"
    :from-rect="picked.fromRect"
    @close="reset"
  />
  <TractPicker v-else @pick="onPick" />
</template>
