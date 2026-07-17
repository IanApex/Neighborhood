// Neighborhood Essay worker (phase 4, workstream B).
//
// POST /geocode { address } | { lat, lon }  → { tractLine, geoid } (fast, for the ritual)
// POST /essay   { address } | { lat, lon }  → { dossier, essay } in EXACTLY the
//                                             fixture shape — the frontend loader
//                                             must not care where data came from.
//
// Caching model mirrors the dossier split: tractCore + essay are cached in KV
// by GEOID; addressContext (amenities at the input point) is generated fresh
// on every request — per-address by design, never cached with the tract.
// Overpass responses get their own KV cache keyed by a ~200m grid + radius.

import { tractFromAddress, tractFromCoordinates } from '../../src/geocode.js';
import { fetchCoreStats, fetchYearBuiltDistribution } from '../../src/acs.js';
import { fetchAmenities } from '../../src/overpass.js';
import { fetchGeography } from '../../src/geography.js';
import { synthesisView } from '../../src/dossier-view.js';
import { synthesizeEssay } from './synthesize.js';

// Bump whenever the essay schema changes (it is part of the tract cache
// key): essays cached under an older schema regenerate instead of being
// served without the fields the frontend now expects.
// v2: built.checkpoints + walking.paragraphs required.
const ESSAY_SCHEMA_VERSION = 2;

const TRACT_CACHE_TTL = 60 * 60 * 24 * 30; // tractCore+essay: 30 days
const OVERPASS_CACHE_TTL = 60 * 60 * 24 * 30; // Overpass etiquette at the edge
const RATE_LIMIT_PER_MINUTE = 5; // a few essays per minute is plenty

// ~200m grid cell (1/500° ≈ 220m). Shared by the Overpass cache AND the
// tract/essay cache: the essay's walking prose is synthesized from the
// requesting address's amenities, so a cached essay is only valid for
// addresses in the same walkshed cell — a different address in the same
// tract gets its own synthesis.
const gridCell = ({ lat, lon }) =>
  `${(Math.round(lat * 500) / 500).toFixed(3)},${(Math.round(lon * 500) / 500).toFixed(3)}`;

export default {
  async fetch(request, env, ctx) {
    // The spike's fetch modules read process.env — populate it from bindings.
    process.env.CENSUS_API_KEY = env.CENSUS_API_KEY ?? '';
    process.env.ACS_YEAR = env.ACS_YEAR ?? '2024';
    if (env.OVERPASS_URL) process.env.OVERPASS_URL = env.OVERPASS_URL;

    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN ?? '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const respond = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });

    if (request.method !== 'POST' || !['/essay', '/geocode'].includes(url.pathname))
      return respond({ error: { type: 'not_found' } }, 404);

    // Per-IP rate limit (KV counter; eventual consistency makes this a soft
    // limit, which is all the endpoint needs).
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const minute = Math.floor(Date.now() / 60_000);
    const rlKey = `rl:${ip}:${minute}`;
    const count = Number((await env.ESSAYS.get(rlKey)) ?? 0);
    if (count >= RATE_LIMIT_PER_MINUTE)
      return respond({ error: { type: 'rate_limited' } }, 429);
    ctx.waitUntil(env.ESSAYS.put(rlKey, String(count + 1), { expirationTtl: 120 }));

    let body;
    try {
      body = await request.json();
    } catch {
      return respond({ error: { type: 'bad_request' } }, 400);
    }

    // 1. Geocode (Census geocoder is server-side only — no CORS — which is
    //    exactly why this lives here).
    let geo;
    try {
      geo =
        body.address != null
          ? await tractFromAddress(String(body.address))
          : await tractFromCoordinates(Number(body.lat), Number(body.lon));
    } catch (err) {
      return respond({ error: { type: 'geocoder_unavailable', detail: err.message } }, 502);
    }
    if (!geo?.tract) return respond({ error: { type: 'address_not_found' } }, 404);
    const { tract } = geo;

    if (url.pathname === '/geocode') {
      return respond({ geoid: tract.geoid, tractName: tract.name });
    }

    const anchor = Number.isFinite(geo.location?.lat)
      ? { ...geo.location, source: 'input-point' }
      : { ...tract.centroid, source: 'tract-centroid' };

    // 2/3. tractCore + essay: KV by GEOID + anchor grid cell; on miss run
    // the pipeline + synthesize.
    const started = Date.now();
    const tractKey = `tract${ESSAY_SCHEMA_VERSION}:${tract.geoid}:${gridCell(anchor)}`;
    let cached = await env.ESSAYS.get(tractKey, 'json');

    // 4. addressContext is ALWAYS fresh (per-address by design) — start it in
    //    parallel with whatever else we need. Amenities may be null; the
    //    dossier has gaps and the essay adapts.
    const amenitiesPromise = fetchAmenitiesCached(env, ctx, anchor).catch((err) => {
      console.log(JSON.stringify({ warn: 'amenities_failed', detail: err.message }));
      return null;
    });

    let tractCore;
    let essay;
    if (cached) {
      ({ tractCore, essay } = cached);
    } else {
      const settle = (r) => (r.status === 'fulfilled' ? r.value : null);
      const [core, yearBuilt, geography] = (
        await Promise.allSettled([
          fetchCoreStats(tract),
          fetchYearBuiltDistribution(tract),
          fetchGeography(tract),
        ])
      ).map(settle);

      tractCore = {
        tract: {
          geoid: tract.geoid,
          name: tract.name,
          centroid: tract.centroid,
          areaLandSqM: tract.areaLand,
          areaWaterSqM: tract.areaWater,
        },
        layers: { core, yearBuilt, geography, canopy: null, historicalMaps: null, holc: null },
      };

      // Synthesis sees the same dossier shape the fixtures use, trimmed.
      const amenities = await amenitiesPromise;
      const draft = assembleDossier(env, geo, tract, tractCore, anchor, amenities);
      const result = await synthesizeEssay(env, synthesisView(draft));

      console.log(
        JSON.stringify({
          geoid: tract.geoid,
          synthesis_ms: result.ms,
          input_tokens: result.usage?.input_tokens ?? null,
          output_tokens: result.usage?.output_tokens ?? null,
          cache_read_input_tokens: result.usage?.cache_read_input_tokens ?? null,
          mock: result.mock ?? false,
          total_ms: Date.now() - started,
        }),
      );

      if (result.error) return respond({ error: result.error }, 502);
      essay = result.essay;

      ctx.waitUntil(
        env.ESSAYS.put(tractKey, JSON.stringify({ tractCore, essay }), {
          expirationTtl: TRACT_CACHE_TTL,
        }),
      );
      return respond({ dossier: assembleDossier(env, geo, tract, tractCore, anchor, amenities), essay });
    }

    const amenities = await amenitiesPromise;
    console.log(JSON.stringify({ geoid: tract.geoid, cache: 'hit', total_ms: Date.now() - started }));
    return respond({ dossier: assembleDossier(env, geo, tract, tractCore, anchor, amenities), essay });
  },
};

// EXACTLY the fixture shape (see src/assemble.js) — fixture parity is a rule.
function assembleDossier(env, geo, tract, tractCore, anchor, amenities) {
  return {
    schemaVersion: '0.2.0',
    generatedAt: new Date().toISOString(),
    sources: {
      geocoding: 'US Census Bureau Geocoder (Public_AR_Current)',
      demographics: `US Census Bureau ACS 5-year (${env.ACS_YEAR ?? '2024'})`,
      amenities: 'OpenStreetMap contributors, via Overpass API',
      geography: 'OpenStreetMap contributors, via Overpass API',
    },
    input: geo.matchedAddress ? { matchedAddress: geo.matchedAddress } : { coordinates: geo.location },
    tractCore,
    addressContext: { anchor, amenities },
  };
}

// Overpass etiquette at the edge: cache responses in KV keyed by the shared
// ~200m grid cell + radius, TTL ~30 days.
async function fetchAmenitiesCached(env, ctx, anchor) {
  const key = `overpass:${gridCell(anchor)}:1200`;
  const hit = await env.ESSAYS.get(key, 'json');
  if (hit) return hit;
  const amenities = await fetchAmenities(anchor);
  ctx.waitUntil(env.ESSAYS.put(key, JSON.stringify(amenities), { expirationTtl: OVERPASS_CACHE_TTL }));
  return amenities;
}
