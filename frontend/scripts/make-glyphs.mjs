// Generate MapLibre glyph PBFs for "Literata Italic" so the map can speak
// in the essay's own serif (map labels use pre-rasterized SDF glyphs, not
// CSS fonts). Browser-rasterized via @mapbox/tiny-sdf in headless Chrome —
// the same approach as maplibre/font-maker; native fontnik has no Windows
// build. Output: public/glyphs/Literata Italic/<range>.pbf
//
//   node scripts/make-glyphs.mjs
//
// Ranges 0-255 and 256-511 cover US water names (incl. accented Latin).

import puppeteer from 'puppeteer-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FONT = resolve('src/assets/fonts/Literata-Italic-Variable.ttf');
const OUT = resolve('public/glyphs/Literata Italic');
const STACK = 'Literata Italic';
const RANGES = [
  [0, 255],
  [256, 511],
];

// ——— minimal protobuf writer (glyphs.proto) ———
const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
};
const zigzag = (n) => varint(n < 0 ? -n * 2 - 1 : n * 2);
const bytesField = (tag, payload) => [...varint((tag << 3) | 2), ...varint(payload.length), ...payload];
const uintField = (tag, n) => [...varint(tag << 3), ...varint(n)];
const sintField = (tag, n) => [...varint(tag << 3), ...zigzag(n)];
const str = (s) => [...new TextEncoder().encode(s)];

function encodeGlyph(g) {
  const body = [
    ...uintField(1, g.id),
    ...(g.bitmap.length ? bytesField(2, g.bitmap) : []),
    ...uintField(3, g.width),
    ...uintField(4, g.height),
    ...sintField(5, g.left),
    ...sintField(6, g.top),
    ...uintField(7, g.advance),
  ];
  return bytesField(3, body); // fontstack.glyphs
}

function encodeRange(rangeName, glyphs) {
  const stackBody = [
    ...bytesField(1, str(STACK)),
    ...bytesField(2, str(rangeName)),
    ...glyphs.flatMap(encodeGlyph),
  ];
  return Uint8Array.from(bytesField(1, stackBody)); // glyphs.stacks
}

// ——— rasterize in the browser ———
const fontB64 = (await readFile(FONT)).toString('base64');
const tinySdfSource = (await readFile(resolve('node_modules/@mapbox/tiny-sdf/index.js'), 'utf8')).replace(
  'export default class TinySDF',
  'window.TinySDF = class TinySDF',
);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--disable-gpu'] });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: tinySdfSource });
await page.evaluate(async (b64) => {
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const face = new FontFace('LiterataGlyph', buf, { style: 'italic', weight: '400' });
  await face.load();
  document.fonts.add(face);
}, fontB64);

await mkdir(OUT, { recursive: true });

for (const [start, end] of RANGES) {
  const glyphs = await page.evaluate(
    ([s, e]) => {
      // Standard mapbox glyph parameters: 24px em, 3px buffer, SDF radius 8.
      const sdf = new window.TinySDF({
        fontSize: 24,
        buffer: 3,
        radius: 8,
        cutoff: 0.25,
        fontFamily: 'LiterataGlyph',
        fontStyle: 'italic',
        fontWeight: '400',
      });
      const out = [];
      for (let id = s; id <= e; id++) {
        if (id < 32) continue; // control chars
        const ch = String.fromCharCode(id);
        const g = sdf.draw(ch);
        if (!g.glyphAdvance) continue;
        out.push({
          id,
          bitmap: g.glyphWidth && g.glyphHeight ? Array.from(g.data) : [],
          width: g.glyphWidth,
          height: g.glyphHeight,
          left: g.glyphLeft,
          // fontnik's `top` is baseline-relative: glyphTop - ascender at
          // 24px. font-maker uses this same constant.
          top: g.glyphTop - 27,
          advance: Math.round(g.glyphAdvance),
        });
      }
      return out;
    },
    [start, end],
  );
  const rangeName = `${start}-${end}`;
  await writeFile(resolve(OUT, `${rangeName}.pbf`), encodeRange(rangeName, glyphs));
  console.log(`${STACK} ${rangeName}: ${glyphs.length} glyphs`);
}

await browser.close();
