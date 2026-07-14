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

export async function synthesizeEssay(env, trimmedDossier) {
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
      max_tokens: 1500,
      system,
      messages: [
        {
          role: 'user',
          content: `DOSSIER:\n${JSON.stringify(trimmedDossier)}${extra}`,
        },
      ],
    });

  let usage = null;
  let lastErrors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await ask(
      attempt === 0
        ? ''
        : `\n\nYour previous reply was invalid (${lastErrors.join('; ')}). Return ONLY the JSON object, matching the schema exactly: 4-6 movements, arrival first, walking last, each {id, layerRef, text}.`,
    );
    usage = response.usage;
    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    try {
      const essay = parseEssayJson(text);
      const errors = validateEssay(essay);
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
// validation; clearly flagged so it can never be mistaken for the real thing.
function mockEssay(view) {
  const tract = view.tractCore.tract;
  const core = view.tractCore.layers.core;
  const p = (s) => s.padEnd(60, ' … placeholder essay, dev mode, no ANTHROPIC_API_KEY set.');
  return {
    placeholder: true,
    note: 'MOCK essay from worker dev mode (no ANTHROPIC_API_KEY).',
    title: `${tract.name} (dev placeholder)`,
    movements: [
      { id: 'arrival', layerRef: 'geography', text: p(`You are standing in ${tract.name}.`) },
      { id: 'built', layerRef: 'yearBuilt', text: p('The housing record, decade by decade.') },
      { id: 'home', layerRef: 'core', text: p(`The record finds ${core?.tenure?.totalOccupied ?? 'some'} households here.`) },
      { id: 'walking', layerRef: 'amenities', text: p('Within a fifteen-minute walk, the record holds features.') },
    ],
  };
}
