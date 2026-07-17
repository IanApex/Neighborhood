import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEssay, parseEssayJson } from '../src/validate.js';

const text = (s) => s.padEnd(60, ' lorem');
const movement = (id, layerRef = 'tract') => ({ id, layerRef, text: text(`${id} movement`) });

const good = () => ({
  title: 'A Place',
  movements: [movement('arrival'), movement('built'), movement('home'), movement('walking')],
});

// Trimmed dossier view with both conditional layers present.
const dossier = () => ({
  tractCore: { layers: { yearBuilt: { totalUnits: 100, buckets: [] } } },
  addressContext: {
    amenities: {
      namedExamples: [{ name: 'Voyageur Park' }, { name: 'Luna Coffee Roasters' }],
    },
  },
});

const goodLive = () => {
  const e = good();
  e.movements[1].checkpoints = [
    { afterYear: 1939, text: 'The oldest layer predates 1940.' },
    { afterYear: 1979, text: 'A long even accumulation followed.' },
    { afterYear: 2024, text: 'Building has slowed since.' },
  ];
  e.movements[3].paragraphs = [
    { text: 'Voyageur Park sits by the river.', pins: ['Voyageur Park'] },
    { text: 'The rest of the walkshed is unnamed here.', pins: [] },
  ];
  return e;
};

test('valid essay passes', () => {
  assert.deepEqual(validateEssay(good()), []);
});

test('title required', () => {
  const e = good();
  delete e.title;
  assert.ok(validateEssay(e).some((x) => /title/.test(x)));
});

test('movement count 4-6 enforced', () => {
  const e = good();
  e.movements = e.movements.slice(0, 3);
  assert.ok(validateEssay(e).some((x) => /4-6/.test(x)));
  e.movements = [
    movement('arrival'), movement('built'), movement('home'),
    movement('history'), movement('canopy'), movement('walking'),
    { id: 'walking', layerRef: 'x', text: text('extra') },
  ];
  assert.ok(validateEssay(e).some((x) => /4-6/.test(x)));
});

test('unknown ids rejected', () => {
  const e = good();
  e.movements[1] = movement('vibes');
  assert.ok(validateEssay(e).some((x) => /unknown id/.test(x)));
});

test('arrival first, walking last', () => {
  const e = good();
  e.movements = [movement('built'), movement('arrival'), movement('home'), movement('walking')];
  assert.ok(validateEssay(e).some((x) => /arrival must be first/.test(x)));
  e.movements = [movement('arrival'), movement('walking'), movement('home'), movement('built')];
  assert.ok(validateEssay(e).some((x) => /walking must be last/.test(x)));
});

test('text length sanity', () => {
  const e = good();
  e.movements[0].text = 'too short';
  assert.ok(validateEssay(e).some((x) => /length/.test(x)));
});

test('live-shaped essay with checkpoints and paragraphs passes against dossier', () => {
  assert.deepEqual(validateEssay(goodLive(), dossier()), []);
});

test('without a dossier the conditional checks are skipped', () => {
  assert.deepEqual(validateEssay(good()), []);
});

test('built checkpoints required when yearBuilt layer exists', () => {
  assert.ok(validateEssay(good(), dossier()).some((x) => /3-5 checkpoints/.test(x)));
});

test('built checkpoints not required when yearBuilt layer is null', () => {
  const d = dossier();
  d.tractCore.layers.yearBuilt = null;
  const errors = validateEssay(goodLive(), d);
  assert.ok(!errors.some((x) => /checkpoint/.test(x)));
});

test('built checkpoint count 3-5 enforced', () => {
  const e = goodLive();
  e.movements[1].checkpoints = e.movements[1].checkpoints.slice(0, 2);
  assert.ok(validateEssay(e, dossier()).some((x) => /3-5 checkpoints/.test(x)));
  e.movements[1].checkpoints = [
    { afterYear: 1939, text: 'a' }, { afterYear: 1949, text: 'b' }, { afterYear: 1959, text: 'c' },
    { afterYear: 1969, text: 'd' }, { afterYear: 1979, text: 'e' }, { afterYear: 1989, text: 'f' },
  ];
  assert.ok(validateEssay(e, dossier()).some((x) => /3-5 checkpoints/.test(x)));
});

test('built checkpoint afterYears must be strictly ascending', () => {
  const e = goodLive();
  e.movements[1].checkpoints[1].afterYear = 1939;
  assert.ok(validateEssay(e, dossier()).some((x) => /strictly ascending/.test(x)));
  e.movements[1].checkpoints[1].afterYear = 1920;
  assert.ok(validateEssay(e, dossier()).some((x) => /strictly ascending/.test(x)));
});

test('built checkpoint afterYear must be a sane year', () => {
  const e = goodLive();
  e.movements[1].checkpoints[0].afterYear = '1939';
  assert.ok(validateEssay(e, dossier()).some((x) => /sane year/.test(x)));
  e.movements[1].checkpoints[0].afterYear = 12;
  assert.ok(validateEssay(e, dossier()).some((x) => /sane year/.test(x)));
});

test('built checkpoint texts must be non-empty', () => {
  const e = goodLive();
  e.movements[1].checkpoints[2].text = '   ';
  assert.ok(validateEssay(e, dossier()).some((x) => /checkpoint 2 text/.test(x)));
});

test('walking paragraphs required when amenities exist', () => {
  assert.ok(validateEssay(good(), dossier()).some((x) => /2-4 paragraphs/.test(x)));
});

test('walking paragraphs not required when amenities are null', () => {
  const d = dossier();
  d.addressContext.amenities = null;
  const errors = validateEssay(goodLive(), d);
  assert.ok(!errors.some((x) => /paragraph/.test(x)));
});

test('walking paragraph count 2-4 enforced', () => {
  const e = goodLive();
  e.movements[3].paragraphs = e.movements[3].paragraphs.slice(0, 1);
  assert.ok(validateEssay(e, dossier()).some((x) => /2-4 paragraphs/.test(x)));
});

test('walking pin naming something not in the record is rejected', () => {
  const e = goodLive();
  e.movements[3].paragraphs[0].pins = ['The Invented Bistro'];
  assert.ok(
    validateEssay(e, dossier()).some((x) => /pin "The Invented Bistro" does not match/.test(x)),
  );
});

test('walking pins match namedExamples case-insensitively', () => {
  const e = goodLive();
  e.movements[3].paragraphs[0].pins = ['voyageur park', ' Luna Coffee Roasters '];
  assert.deepEqual(validateEssay(e, dossier()), []);
});

test('walking pins must be an array', () => {
  const e = goodLive();
  e.movements[3].paragraphs[1].pins = null;
  assert.ok(validateEssay(e, dossier()).some((x) => /pins must be an array/.test(x)));
});

test('parseEssayJson strips code fences', () => {
  const parsed = parseEssayJson('```json\n{"title": "X"}\n```');
  assert.equal(parsed.title, 'X');
});
