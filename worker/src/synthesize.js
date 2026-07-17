// Synthesis call (B2): Claude Sonnet on the Messages API, official SDK.
// The system prompt is built from prompts/synthesis-prompt.md (bundled as
// text at build time — single source of truth). The static rules block is
// marked cacheable; only the dossier varies per call.

import Anthropic from '@anthropic-ai/sdk';
import { validateEssay, parseEssayJson } from './validate.js';
import promptFile from '../../prompts/synthesis-prompt.md';

const MODEL = 'claude-sonnet-4-6';

// The prompt file is: preamble --- rules --- DOSSIER template. The rules
// block between the separators is the system prompt; the dossier goes in
// the user turn.
export function systemFromPromptFile(text = promptFile) {
  const parts = text.split(/^---$/m);
  if (parts.length < 3) throw new Error('synthesis-prompt.md shape changed: expected --- separators');
  return parts[1].trim();
}

// `compare` (optional) is a second trimmed dossier appended as COMPARISON
// CONTEXT — the prompt has supported it since phase 2; the schema is
// unchanged and every movement is still about the primary place.
export async function synthesizeEssay(env, trimmedDossier, compare = null) {
  const started = Date.now();

  // Dev affordance: without an ANTHROPIC_API_KEY (e.g. `wrangler dev` before
  // secrets exist) return a clearly-marked placeholder so the pipeline can
  // be exercised end-to-end. Never the case in a deployed environment.
  if (!env.ANTHROPIC_API_KEY) {
    return { essay: mockEssay(trimmedDossier), usage: null, ms: Date.now() - started, mock: true };
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const system = [
    {
      type: 'text',
      text: systemFromPromptFile(),
      // Static rules cache across calls; only the dossier varies. (Sonnet
      // 4.6's minimum cacheable prefix is ~2048 tokens — if the rules block
      // is under that, this marker is a harmless no-op.)
      cache_control: { type: 'ephemeral' },
    },
  ];

  const ask = (extra = '') =>
    client.messages.create({
      model: MODEL,
      // Sized for the full phase-5 shape: up to 6 movements, with built and
      // walking text carried twice (checkpoints/paragraphs + joined text).
      // 1500 truncated real essays mid-string once history arrived.
      max_tokens: 3000,
      system,
      messages: [
        {
          role: 'user',
          content:
            `DOSSIER:\n${JSON.stringify(trimmedDossier)}` +
            (compare ? `\n\nCOMPARISON CONTEXT:\n${JSON.stringify(compare)}` : '') +
            extra,
        },
      ],
    });

  let usage = null;
  let lastErrors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await ask(
      attempt === 0
        ? ''
        : `\n\nYour previous reply was invalid (${lastErrors.join('; ')}). Return ONLY the JSON object, matching the schema exactly: 4-6 movements, arrival first, walking last, each {id, layerRef, text}. The built movement must carry "checkpoints": 3-5 {afterYear, text} entries with strictly ascending afterYears at the dossier's bucket boundaries, each text describing only construction up to its afterYear, joined texts = the movement text. The walking movement must carry "paragraphs": 2-4 {text, pins} entries where every pin is a name copied VERBATIM from the dossier's namedExamples ([] when a paragraph names nothing), joined texts = the movement text. When the dossier's holc layer is non-null a "history" movement is REQUIRED (documentary register, after home, before walking): state the grade, year, and the layer's definition plainly per rule 11 — never quote survey language, never draw the causal arrow to the present.`,
    );
    usage = response.usage;
    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    try {
      const essay = parseEssayJson(text);
      const errors = validateEssay(essay, trimmedDossier);
      if (!errors.length) return { essay, usage, ms: Date.now() - started };
      lastErrors = errors;
    } catch (err) {
      lastErrors = [`JSON parse failed: ${err.message}`];
    }
  }

  return {
    error: { type: 'synthesis_invalid', detail: lastErrors.join('; ') },
    usage,
    ms: Date.now() - started,
  };
}

// Deterministic dossier-derived placeholder for keyless local dev. Passes
// validation (including the checkpoint/paragraph requirements, so keyless
// dev exercises the same frontend paths as live synthesis); clearly flagged
// so it can never be mistaken for the real thing.
function mockEssay(view) {
  const tract = view.tractCore.tract;
  const core = view.tractCore.layers.core;
  const p = (s) => s.padEnd(60, ' … placeholder essay, dev mode, no ANTHROPIC_API_KEY set.');

  // Checkpoint years from the dossier's actual bucket boundaries (first,
  // middle, last), the same rule live synthesis follows.
  const bucketYears = (view.tractCore.layers.yearBuilt?.buckets ?? [])
    .map((b) => Number((String(b.label).match(/\d{4}/g) ?? []).pop()))
    .filter(Number.isFinite);
  const picked = [...new Set([bucketYears[0], bucketYears[Math.floor(bucketYears.length / 2)], bucketYears[bucketYears.length - 1]])]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const years = picked.length >= 3 ? picked : [1939, 1979, 2024];
  const checkpoints = years.map((afterYear, i) => ({
    afterYear,
    text: p(`The housing record through ${afterYear}, part ${i + 1}.`),
  }));

  const names = (view.addressContext?.amenities?.namedExamples ?? [])
    .map((e) => e?.name)
    .filter(Boolean);
  const paragraphs = [
    {
      text: p(
        names[0]
          ? `Within a fifteen-minute walk, the record holds features, among them ${names[0]}.`
          : 'Within a fifteen-minute walk, the record holds features.',
      ),
      pins: names.slice(0, 1),
    },
    { text: p('The rest of the walkshed stays in the prose, unnamed.'), pins: [] },
  ];

  // History movement whenever the validator would require or allow one, so
  // keyless dev exercises the same frontend paths as live synthesis.
  const holc = view.tractCore.layers.holc;
  const places = view.addressContext?.historicPlaces ?? [];
  const history =
    holc || places.length
      ? [
          {
            id: 'history',
            layerRef: holc ? 'holc' : 'historicPlaces',
            text: p(
              holc
                ? `The federal record grades this area ${holc.grade}, "${holc.category}".`
                : `The register lists ${places[0]?.name ?? 'a place'} (${places[0]?.listedYear ?? 'year unknown'}).`,
            ),
          },
        ]
      : [];

  return {
    placeholder: true,
    note: 'MOCK essay from worker dev mode (no ANTHROPIC_API_KEY).',
    title: `${tract.name} (dev placeholder)`,
    movements: [
      { id: 'arrival', layerRef: 'geography', text: p(`You are standing in ${tract.name}.`) },
      {
        id: 'built',
        layerRef: 'yearBuilt',
        text: checkpoints.map((c) => c.text).join(' '),
        checkpoints,
      },
      { id: 'home', layerRef: 'core', text: p(`The record finds ${core?.tenure?.totalOccupied ?? 'some'} households here.`) },
      ...history,
      {
        id: 'walking',
        layerRef: 'amenities',
        text: paragraphs.map((q) => q.text).join(' '),
        paragraphs,
      },
    ],
  };
}
