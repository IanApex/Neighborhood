<script setup>
// The live resolution ritual: the same title page the fixtures compose, but
// each line is HONEST — the tract line appears because geocoding actually
// returned; "Reading the record." holds while the pipeline and synthesis
// actually run. This is the loading state the ritual was designed to be.

import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps({
  addressText: { type: String, required: true },
  tractName: { type: String, required: true },
  fromRect: { type: Object, default: null },
  requestBody: { type: Object, required: true }, // { address } or { lat, lon }
  workerUrl: { type: String, required: true },
});
const emit = defineEmits(['ready', 'close']);

const dedicationEl = ref(null);
const flipDone = ref(!props.fromRect);
const ritualStep = ref(0); // 1: tract line, 2: reading, 3: still reading
const failed = ref(false);
let slowTimer = 0;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const beat = () => new Promise((r) => setTimeout(r, reduced ? 120 : 900));

async function flipDedication() {
  if (!props.fromRect || reduced) {
    flipDone.value = true;
    return;
  }
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
  clone.getBoundingClientRect();
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

async function run() {
  failed.value = false;
  // Synthesis can be slow; the ritual holds. One more patient line past 8s.
  slowTimer = setTimeout(() => {
    if (ritualStep.value === 2) ritualStep.value = 3;
  }, 8000);
  try {
    const resp = await fetch(`${props.workerUrl}/essay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(props.requestBody),
    });
    const json = await resp.json();
    if (!resp.ok || json.error || !json.dossier || !json.essay) throw new Error(json.error?.type ?? 'bad response');
    clearTimeout(slowTimer);
    emit('ready', json);
  } catch {
    clearTimeout(slowTimer);
    failed.value = true;
  }
}

async function retry() {
  ritualStep.value = 2;
  run();
}

onMounted(async () => {
  await flipDedication();
  await beat();
  ritualStep.value = 1; // geocoding has genuinely returned — say the tract
  await beat();
  ritualStep.value = 2; // and now the record is genuinely being read
  run();
});

onUnmounted(() => clearTimeout(slowTimer));
</script>

<template>
  <main class="live-ritual">
    <header class="frontispiece">
      <p ref="dedicationEl" class="dedication" :class="{ 'dedication--in': flipDone }">
        {{ addressText }}
      </p>
      <div class="ritual" aria-live="polite">
        <p class="ritual-line" :class="{ 'ritual-line--in': ritualStep >= 1 }">{{ tractName }}</p>
        <template v-if="!failed">
          <p class="ritual-line label" :class="{ 'ritual-line--in': ritualStep >= 2 }">
            Reading the record.
          </p>
          <p v-if="ritualStep >= 3" class="ritual-line label ritual-line--in">Still reading.</p>
        </template>
        <template v-else>
          <!-- Quiet failure, in the essay's own voice. -->
          <p class="ritual-line ritual-line--in ritual-failure">
            This place's record couldn't be read just now.
          </p>
          <button class="label ritual-retry" type="button" @click="retry">Read it again</button>
          <button class="label ritual-retry" type="button" @click="emit('close')">Back</button>
        </template>
      </div>
    </header>
  </main>
</template>

<style scoped>
.live-ritual {
  min-height: 100dvh;
}

.frontispiece {
  padding: var(--space-4) var(--space-3) 0;
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

.ritual-failure {
  font-style: italic;
}

.ritual-retry {
  display: block;
  margin-top: var(--space-2);
  padding: 0.2rem 0;
  border-bottom: 1px solid var(--hairline);
  color: var(--ink);
}
</style>
