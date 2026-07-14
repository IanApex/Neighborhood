<script setup>
import { fixtures } from '../fixtures/index.js';

// Opening state: blank paper, one address input, one instruction line.
// Fixtures phase: picking a tract simulates the commit; the picked text
// FLIPs into the essay's dedication line.
const emit = defineEmits(['pick']);

function addressOf(fixture) {
  const input = fixture.dossier.input;
  if (input.matchedAddress) return titleCase(input.matchedAddress);
  const { lat, lon } = input.coordinates;
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Wi|Il|Mi)\b/g, (m) => m.toUpperCase());
}

function pick(fixture, event) {
  const rect = event.currentTarget
    .querySelector('.picker-address')
    .getBoundingClientRect();
  emit('pick', {
    geoid: fixture.geoid,
    addressText: addressOf(fixture),
    fromRect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
  });
}
</script>

<template>
  <main class="picker">
    <label class="picker-field">
      <input
        class="picker-input"
        type="text"
        placeholder=""
        aria-label="Address"
        readonly
      />
      <span class="picker-instruction">Type an address.</span>
    </label>

    <!-- Dev screen: the three reference fixtures stand in for geocoding. -->
    <ul class="picker-fixtures" aria-label="Reference tracts (fixtures)">
      <li v-for="f in fixtures" :key="f.geoid">
        <button class="picker-choice" type="button" @click="pick(f, $event)">
          <span class="picker-address">{{ addressOf(f) }}</span>
          <span class="label">{{ f.geoid }}</span>
        </button>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.picker {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-3);
  max-width: 28rem;
  margin: 0 auto;
}

.picker-field {
  display: block;
}

.picker-input {
  width: 100%;
  font-family: var(--serif);
  font-size: var(--text-dedication);
  color: var(--ink);
  background: none;
  border: none;
  border-bottom: 1px solid var(--hairline);
  padding: var(--space-1) 0;
  outline: none;
}

.picker-instruction {
  display: block;
  margin-top: var(--space-1);
  font-family: var(--sans);
  font-size: var(--text-label);
  letter-spacing: 0.08em;
  color: var(--ink-faint);
}

.picker-fixtures {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.picker-choice {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: left;
  padding: var(--space-1) 0;
}

.picker-address {
  font-family: var(--serif);
  font-size: 1.125rem;
}

.picker-choice:hover .picker-address,
.picker-choice:focus-visible .picker-address {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
</style>
