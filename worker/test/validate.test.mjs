import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEssay, parseEssayJson } from '../src/validate.js';

const text = (s) => s.padEnd(60, ' lorem');
const movement = (id, layerRef = 'tract') => ({ id, layerRef, text: text(`${id} movement`) });

const good = () => ({
  title: 'A Place',
  movements: [movement('arrival'), movement('built'), movement('home'), movement('walking')],
});

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

test('parseEssayJson strips code fences', () => {
  const parsed = parseEssayJson('```json\n{"title": "X"}\n```');
  assert.equal(parsed.title, 'X');
});
