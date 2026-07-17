// Essay validation (B3): never render unvalidated output. The movement
// schema the frontend depends on, enforced at the edge.

const KNOWN_IDS = new Set(['arrival', 'built', 'home', 'history', 'canopy', 'walking']);

// dossier (the trimmed synthesis view) gates the layer-conditional checks:
// built.checkpoints are required when yearBuilt data exists, and
// walking.paragraphs (with pins verified against namedExamples) when
// amenities exist. Without a dossier those checks are skipped.
export function validateEssay(essay, dossier = null) {
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

  const built = movements.find((m) => m?.id === 'built');
  if (built && dossier?.tractCore?.layers?.yearBuilt) {
    if (!Array.isArray(built.checkpoints) || built.checkpoints.length < 3 || built.checkpoints.length > 5) {
      errors.push('built movement must carry 3-5 checkpoints {afterYear, text} when yearBuilt data exists');
    } else {
      let prev = -Infinity;
      for (const [i, cp] of built.checkpoints.entries()) {
        if (typeof cp?.text !== 'string' || !cp.text.trim())
          errors.push(`built checkpoint ${i} text missing or empty`);
        if (typeof cp?.afterYear !== 'number' || cp.afterYear < 1500 || cp.afterYear > 2100) {
          errors.push(`built checkpoint ${i} afterYear is not a sane year`);
        } else {
          if (cp.afterYear <= prev) errors.push('built checkpoint afterYears must be strictly ascending');
          prev = cp.afterYear;
        }
      }
    }
  }

  const walking = movements.find((m) => m?.id === 'walking');
  const namedExamples = dossier?.addressContext?.amenities?.namedExamples;
  if (walking && dossier?.addressContext?.amenities) {
    if (!Array.isArray(walking.paragraphs) || walking.paragraphs.length < 2 || walking.paragraphs.length > 4) {
      errors.push('walking movement must carry 2-4 paragraphs {text, pins} when amenities exist');
    } else {
      // Pins are an honesty surface: every pin must name something the
      // dossier actually records, or the essay is rejected.
      const known = new Set(
        (namedExamples ?? []).map((e) => e?.name?.trim().toLowerCase()).filter(Boolean),
      );
      for (const [i, p] of walking.paragraphs.entries()) {
        if (typeof p?.text !== 'string' || !p.text.trim())
          errors.push(`walking paragraph ${i} text missing or empty`);
        if (!Array.isArray(p?.pins)) {
          errors.push(`walking paragraph ${i} pins must be an array (use [] when nothing is named)`);
          continue;
        }
        for (const pin of p.pins) {
          if (typeof pin !== 'string' || !known.has(pin.trim().toLowerCase()))
            errors.push(`walking paragraph ${i} pin "${pin}" does not match any namedExamples name`);
        }
      }
    }
  }

  return errors;
}

// The model returns bare JSON per the prompt, but guard against fences.
export function parseEssayJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(trimmed);
}
