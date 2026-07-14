// Smoke test: drives the built app in real Chrome at 390×844, walks every
// movement for every fixture, captures console errors and screenshots.
//
//   node scripts/smoke.mjs [outDir] [--reduced-motion]
//
// Requires `npm run build && npm run preview` (port 4173) and a local
// Chrome install.

import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:4173';
const GEOIDS = ['55009010300', '17031081402', '26163514300'];
const outDir = process.argv[2] ?? 'smoke-out';
const reducedMotion = process.argv.includes('--reduced-motion');

await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
});

let failures = 0;

for (const geoid of GEOIDS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  if (reducedMotion) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Resource 404s (favicon, a missing tile) aren't app failures; real JS
    // errors arrive via pageerror.
    if (m.type() === 'error' && !/Failed to load resource|tiles\.openfreemap|ERR_INTERNET/.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });

  const tag = (name) => `${outDir}/${geoid}-${name}${reducedMotion ? '-rm' : ''}.png`;
  const shot = async (name) => page.screenshot({ path: tag(name) });

  await page.goto(`${BASE}/?geoid=${geoid}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page
    .waitForFunction('window.__arrivalSettled === true', { timeout: 45_000 })
    .catch(() => errors.push('arrival never settled'));
  await page.waitForFunction('window.__mapIdle === true', { timeout: 30_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  const youAtArrival = await page.evaluate(() => !!document.querySelector('.you-dot'));
  if (!youAtArrival) errors.push('you-dot missing at end of arrival');
  await shot('1-arrival');

  const geom = await page.evaluate(() => {
    const stock = document.querySelector('.stock');
    const walking = document.querySelector('.movement--walking');
    const track = document.querySelector('.built-track');
    return {
      stockTop: stock ? stock.offsetTop : null,
      trackH: track ? track.offsetHeight : null,
      walkingTop: walking ? walking.offsetTop : null,
      docH: document.body.scrollHeight,
      staticStock: !!document.querySelector('.stock--static'),
    };
  });

  if (geom.staticStock) {
    // Reduced motion: the print form — just scroll through and shoot it.
    await page.evaluate((y) => window.scrollTo(0, y), geom.stockTop);
    await new Promise((r) => setTimeout(r, 700));
    await shot('2-built-static');
  } else {
    const settle = (ms = 2200) => new Promise((r) => setTimeout(r, ms));
    const counter = () =>
      page.evaluate(() => document.querySelector('.stock-playhead-year')?.textContent.trim());

    // Mid-1950s-ish and the Detroit 1970s void (unit index 4 of 10).
    await page.evaluate((y) => window.scrollTo(0, y), geom.stockTop + geom.trackH * 0.28);
    await settle();
    console.log(`${geoid} counter @28%: ${await counter()}`);
    await shot('2-built-early');

    await page.evaluate((y) => window.scrollTo(0, y), geom.stockTop + geom.trackH * 0.47);
    await settle();
    console.log(`${geoid} counter @47%: ${await counter()}`);
    await shot('3-built-mid');

    // Home field: past the track.
    await page.evaluate((y) => window.scrollTo(0, y), geom.stockTop + geom.trackH + 500);
    await settle(2800);
    await shot('4-home');
  }

  // Walking + closing.
  await page.evaluate((y) => window.scrollTo(0, y), geom.walkingTop + 200);
  await new Promise((r) => setTimeout(r, 2600));
  await shot('5-walking');
  const pinCount = await page.evaluate(() => document.querySelectorAll('.map-pin').length);

  // While the final walking paragraph is on screen the essay must still be
  // readable — closing may only engage a full quiet screen later.
  await page.evaluate(() => {
    const walking = document.querySelector('.movement--walking');
    window.scrollTo(0, walking.offsetTop + walking.offsetHeight - window.innerHeight + 40);
  });
  await new Promise((r) => setTimeout(r, 1200));
  const prematureClose = await page.evaluate(() => !!document.querySelector('.experience--closing'));
  if (prematureClose) errors.push('closing engaged while the last walking paragraph was on screen');
  await shot('5b-walking-end');

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((r) => setTimeout(r, 2600));
  const closed = await page.evaluate(() => !!document.querySelector('.experience--closing'));
  if (!closed) errors.push('closing never engaged at the end of the page');
  const youAtClose = await page.evaluate(() => !!document.querySelector('.you-dot'));
  if (!youAtClose) errors.push('you-dot missing at closing — it must never leave');
  await shot('6-closing');

  // The portrait export: capture the actual composed PNG for review.
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: (await import('node:path')).resolve(outDir),
  });
  await page.click('.save-button').catch(() => errors.push('save button unreachable'));
  await new Promise((r) => setTimeout(r, 1500));

  console.log(`${geoid}: pins=${pinCount} errors=${errors.length}`);
  for (const e of errors) console.log(`  ! ${e}`);
  if (errors.length) failures++;
  await page.close();
}

await browser.close();
process.exit(failures ? 1 : 0);
