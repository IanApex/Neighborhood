# Neighborhood Essay — phase 1 data spike

Address in → place dossier JSON out. This spike answers one question: is the
open data rich enough, for both a small Wisconsin city and a dense urban
tract, to support a generated essay worth designing around?

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

Output lands in `data/dossier-<GEOID>.json`.

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

Two committed dossiers — one De Pere tract, one dense urban tract — that a
human can read top to bottom and say: "yes, there's an essay in here."
Then phase 2 (narrative engine) starts from `prompts/synthesis-prompt.md`.
