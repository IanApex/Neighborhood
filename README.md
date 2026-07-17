# Neighborhood Essay

Address in → place dossier JSON out → a scroll-driven visual essay.
Phase 1 (data spike) and phase 2 (narrative voice) are closed; phase 3
(the scroll experience, `frontend/`) runs against static fixtures; phase 4
adds the live address pipeline (`worker/`, staging-gated).

## Live pipeline (phase 4, `worker/`)

A Cloudflare Worker serves `POST /essay` (`{address}` or `{lat, lon}`) and a
fast `POST /geocode` for the resolution ritual. tractCore + essay are cached
in KV by GEOID; addressContext (amenities at the input point) is generated
fresh per request — per-address by design. Overpass responses cache in KV on
a ~200m grid (30-day TTL) and the endpoint is per-IP rate limited. Responses
are EXACTLY the fixture shape. Synthesis runs on `claude-sonnet-4-6` with
prompt caching on the static rules block (built from
`prompts/synthesis-prompt.md` at bundle time — single source of truth), and
the essay JSON is schema-validated with one corrective retry; invalid output
is never returned.

Deploy (staging gate — unlisted URL, no analytics, no public sharing; review
generated essays for unfamiliar places before any public step):

```
cd worker
npm install
wrangler kv namespace create ESSAYS      # paste ids into wrangler.toml
wrangler secret put CENSUS_API_KEY
wrangler secret put ANTHROPIC_API_KEY    # OWNER TASK FIRST: set the Anthropic
                                         # console spend cap before this deploy
wrangler deploy
```

Local dev: `npm run dev` (miniflare; put `CENSUS_API_KEY=...` in
`worker/.dev.vars`, never committed). Without `ANTHROPIC_API_KEY` the worker
returns a clearly-marked mock essay so the pipeline can be exercised.
Each synthesis logs one line: geoid, token counts, ms.

Frontend live mode: set `VITE_WORKER_URL=<worker url>` in
`frontend/.env.local`. The address input becomes real; the three fixtures
remain as instant demo entries that never hit the worker. Worker tests:
`cd worker && npm test`; frontend logic tests: `cd frontend && npm test`.

## Setup

1. Node 18+ (native fetch required)
2. Get a free Census API key: https://api.census.gov/data/key_signup.html
3. `cp .env.example .env` and add the key
4. Run:

```
node --env-file=.env src/assemble.js "335 S Broadway, De Pere, WI"
node --env-file=.env src/assemble.js --coords 41.8917 -87.6086
```

(`--env-file` needs Node 20+; on older Node, export the vars yourself.)

Output lands in `data/dossier-<GEOID>.json`. To print the trimmed synthesis
view of a dossier (what goes into the narrative prompt — no raw counts or
map geometry):

### Historical layers (phase 5)

The HOLC and National Register layers read local geohash partitions that are
NOT committed (they're derived data). Rebuild them any time:

```
node scripts/build-holc.mjs    # Mapping Inequality → data/holc/ + data/kv/holc-bulk-*.json
node scripts/build-nrhp.mjs    # NPS National Register → data/nrhp/ + data/kv/nrhp-bulk-*.json
```

Upload to the worker's KV namespace (repeat per bulk file):

```
cd worker
npx wrangler kv bulk put ../data/kv/holc-bulk-0.json --namespace-id=<ESSAYS id> --remote
npx wrangler kv bulk put ../data/kv/nrhp-bulk-0.json --namespace-id=<ESSAYS id> --remote
```

HOLC data is CC BY-NC 4.0 (Mapping Inequality, Digital Scholarship Lab,
University of Richmond): attribution required wherever the layer appears,
noncommercial forever. NRHP data is public domain (NPS).

```
npm run synthesis-view data/dossier-<GEOID>.json
```

## Frontend (phase 3)

Vue 3 + Vite + MapLibre GL, hand-rolled CSS with design tokens, mobile-first
at 390px. Static fixtures only — the three reference dossiers plus matching
essay JSONs (currently placeholders, flagged in-file) paired by GEOID in
`frontend/src/fixtures/`. No pipeline/geocoding/synthesis calls; the basemap
is OpenFreeMap vector tiles (keyless), recolored to the token palette.

```
cd frontend
npm install
npm run dev          # tract-picker dev screen at the root
```

Deep-link a fixture with `/?geoid=<GEOID>`. Smoke-test all three fixtures in
headless Chrome (screenshots + console errors, 390×844):

```
npm run build && npm run preview   # in one terminal
node scripts/smoke.mjs out         # in another; add --reduced-motion
```

## Reference tracts

| GEOID | Place | Tests |
|---|---|---|
| 55009010300 | De Pere, WI | small-city baseline |
| 17031081402 | Chicago (Streeterville) | dense-urban contrast |
| 26163514300 | Detroit (east side) | hard-profile voice test |

The Detroit tract was chosen data-first from four rust-belt candidates: its
dossier shows 1938 median year built, 83% of units pre-1960, ~35% of units
unoccupied, sparse walkable amenities, and an empty named-geography layer —
the hardest test of the essay's honesty and voice rules. Selection rationale
is documented in CLAUDE.md.

## What's in a dossier (v0.2)

Split into two parts so the GEOID cache key stays honest:

**tractCore** — purely a function of the tract, cacheable by GEOID:
- Tract identity: GEOID, name, centroid, land/water area (numeric)
- Core stats: population, median year built, owner/renter split (ACS 5-year)
- Year-built distribution by period (ACS B25034 via group()), oldest first
- Named geography: waterways, water bodies/shorelines, landforms near the
  tract (OSM/Overpass), search radius scaled to tract size. May be empty
- Stubs for future layers: canopy, historical maps, HOLC

**addressContext** — anchored at the input point, regenerated per request:
- Walking-distance amenities: normalized counts by type + named examples
  (OSM/Overpass). Infrastructure-texture types (benches, gardens, parking,
  docks) are flagged `texture: true`; institution-like types are deduped by
  name; raw per-feature counts kept under `raw` for debugging
- The anchor itself, with `source` noting geocoded address vs centroid
  fallback

## First-run findings (verified live, 2026-07-13)

1. ACS tenure codes (B25003_001/002/003 = total/owner/renter) are correct,
   verified against the 2024 vintage metadata
2. The groups metadata endpoint resolves fine on both 2023 and 2024 vintages
   — no fallback needed. ACS_YEAR default is now 2024 (newest 5-year vintage)
3. The Census data API now **hard-requires an API key** — keyless low-volume
   access no longer works. Without a key both ACS layers fail (gracefully)
4. overpass-api.de returns **406** for requests without a User-Agent header
   (Node fetch sends none) — fixed in `src/overpass.js`
5. The public Overpass instance does get busy (504s); the fetcher now retries
   once, and `OVERPASS_URL` can point at a mirror such as
   `https://overpass.kumi.systems/api/interpreter`
6. Amenities are anchored on the **input point**, not the tract centroid:
   De Pere tract 103's centroid lands in farmland (7 features vs 216 at the
   address). The dossier records which anchor was used

## Definition of done for this spike

~~Two~~ Three committed dossiers (see Reference tracts) that a human can
read top to bottom and say: "yes, there's an essay in here." Phase 1 closed
2026-07-13. Phase 2 (narrative voice) lives in `prompts/synthesis-prompt.md`;
essay runs happen conversationally for now.
