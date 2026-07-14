// Essay validation (B3): never render unvalidated output. The movement
// schema the frontend depends on, enforced at the edge.

const KNOWN_IDS = new Set(['arrival', 'built', 'home', 'history', 'canopy', 'walking']);

export function validateEssay(essay) {
  const errors = [];
  if (!essay || typeof essay !== 'object') return ['essay is not an object'];
  if (typeof essay.title !== 'string' || !essay.title.trim()) errors.push('title missing');
  if (!Array.isArray(essay.movements)) return [...errors, 'movements is not an array'];

  const movements = essay.movements;
  if (movements.length < 4 || movements.length > 6)
    errors.push(`expected 4-6 movements, got ${movements.length}`);

  const ids = [];
  for (const [i, m] of movements.entries()) {
    if (!m || typeof m !== 'object') {
      errors.push(`movement ${i} is not an object`);
      continue;
    }
    if (!KNOWN_IDS.has(m.id)) errors.push(`movement ${i} has unknown id "${m.id}"`);
    if (typeof m.layerRef !== 'string' || !m.layerRef) errors.push(`movement ${i} missing layerRef`);
    if (typeof m.text !== 'string' || m.text.trim().length < 40 || m.text.length > 2400)
      errors.push(`movement ${i} text length not sane`);
    ids.push(m.id);
  }
  if (new Set(ids).size !== ids.length) errors.push('duplicate movement ids');
  if (ids.includes('arrival') && ids[0] !== 'arrival') errors.push('arrival must be first');
  if (ids.includes('walking') && ids[ids.length - 1] !== 'walking') errors.push('walking must be last');

  return errors;
}

// The model returns bare JSON per the prompt, but guard against fences.
export function parseEssayJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(trimmed);
}
