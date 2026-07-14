<script setup>
import { ref } from 'vue';
import { fixtures } from '../fixtures/index.js';

// Opening state: blank paper, one address input, one instruction line.
// With a worker configured (VITE_WORKER_URL) the input is real: submit
// geocodes the address and hands off to the live ritual. The three
// reference fixtures remain beneath it as instant demo entries — they
// never hit the worker.
const emit = defineEmits(['pick']);

const workerUrl = (import.meta.env.VITE_WORKER_URL ?? '').replace(/\/$/, '');
const live = !!workerUrl;
const address = ref('');
const state = ref('idle'); // idle | checking | notfound | error
const inputEl = ref(null);

async function submit() {
  const text = address.value.trim();
  if (!live || !text || state.value === 'checking') return;
  state.value = 'checking';
  try {
    const resp = await fetch(`${workerUrl}/geocode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: text }),
    });
    if (resp.status === 404) {
      state.value = 'notfound'; // inline, quiet, no alarm styling
      return;
    }
    if (!resp.ok) throw new Error(String(resp.status));
    const { tractName } = await resp.json();
    const rect = inputEl.value.getBoundingClientRect();
    state.value = 'idle';
    emit('pick', {
      live: {
        addressText: text,
        tractName,
        requestBody: { address: text },
        workerUrl,
        fromRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      },
    });
  } catch {
    state.value = 'error';
  }
}

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
    <div class="picker-field">
      <input
        ref="inputEl"
        v-model="address"
        class="picker-input"
        type="text"
        placeholder=""
        aria-label="Address"
        :readonly="!live"
        :disabled="state === 'checking'"
        @keydown.enter="submit"
        @input="state = 'idle'"
      />
      <span v-if="state === 'notfound'" class="picker-instruction picker-quiet">
        The record has no entry for that address.
      </span>
      <span v-else-if="state === 'error'" class="picker-instruction picker-quiet">
        The record couldn't be reached just now.
      </span>
      <span v-else-if="state === 'checking'" class="picker-instruction">Looking.</span>
      <span v-else class="picker-instruction">Type an address.</span>
    </div>

    <!-- The three reference fixtures: instant demo entries. -->
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

/* not-found / error: same register, slightly present — never alarm styling */
.picker-quiet {
  color: var(--ink-soft);
  text-transform: none;
  letter-spacing: 0.04em;
  font-family: var(--serif);
  font-style: italic;
  font-size: 0.875rem;
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
