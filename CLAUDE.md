# Neighborhood Essay — data spike

## What this project is

A generated, scroll-driven visual essay about any US neighborhood. Enter an
address → resolve to a census tract → assemble a "place dossier" JSON from
open data → Claude synthesizes a narrative from the dossier ONLY → rendered
as a designed scrollytelling experience (MapLibre + scroll triggers, Vue 3).

This repo is currently **phase 1: the data spike.** Goal: produce complete,
readable dossiers for two contrasting tracts (one in De Pere WI, one dense
urban tract) and judge whether the raw material is rich enough.

## Design thesis (phase 3) — governs every visual choice

The visual system is forbidden from editorializing, exactly as the prose is.
One palette, one type system, one motion language for every tract in America.
No per-tract mood, color grading, or atmosphere. The truth lives in the
data's shape rendered plainly: sparse tracts end quieter than rich ones by
construction, never by art direction. Reverence is expressed through
restraint (whitespace, pacing, book-quality typography, no UI chrome), never
through atmosphere (no vignettes, grain, or ambient washes). Where the data
is silent, the page is visibly quiet — an empty layer is choreography, not a
bug. Never render a fact at a precision the dossier doesn't have (e.g.
vacancy is known in aggregate, not per-parcel — it must never appear as
locations on the map).

## Core architectural rule — do not violate

The narrative layer may only state facts present in the dossier JSON. Never
let generation draw on model knowledge of a place. If a layer is missing, the
essay adapts; it never fills gaps with invented local history. The synthesis
prompt in `prompts/synthesis-prompt.md` encodes this — keep it strict.

## Stack decisions already made

- Node 18+ ESM, zero runtime deps for the spike (native fetch only)
- Data unit = census tract (GEOID), which is also the future cache key
- Census Geocoder for address→tract (no CORS — server-side only)
- ACS 5-year for housing/population (needs free CENSUS_API_KEY in .env)
- Overpass public instance for OSM amenities (rate-limited: cache, be polite)
- Frontend later: Vue 3 + Vite + MapLibre GL (owner's home stack — not React)

## Dossier structure (v0.2.0): tractCore vs addressContext

The dossier is split to keep the GEOID cache key honest:

- **tractCore** — everything that is purely a function of the tract:
  identity (GEOID, name, centroid, land/water area), core ACS stats,
  yearBuilt distribution, named geography. Cacheable by GEOID: two requests
  in the same tract get byte-identical tractCore.
- **addressContext** — the walking-distance amenities layer, anchored at
  the input point (`anchor.source` records whether that was the geocoded
  address or a centroid fallback). Regenerated per request, never cached by
  GEOID: amenities vary by point within a tract (De Pere tract 103 centroid
  vs address = 7 vs 216 features), so caching them per-tract would serve
  one address's walkshed to every address in the tract.

## Historical layers (phase 5) — licensing is binding

- **HOLC grades** come from Mapping Inequality (Digital Scholarship Lab,
  University of Richmond), **CC BY-NC 4.0**: attribution is REQUIRED
  wherever the layer appears (colophon, portrait footer when shown) and
  the layer is **noncommercial forever** — this constrains any future
  monetization of the product while the layer exists. The original HOLC
  area descriptions contain the era's racist language: they are NEVER
  fetched, stored, or quoted. The layer carries grade, category, city,
  year, and a fixed one-line definition (shipped IN the layer so the
  essay's explanation traces to the dossier like every other fact).
- **Historic places** come from the NPS National Register points layer
  (federal work, public domain).
- Both are national datasets partitioned by geohash-4 into KV
  (`holc:<cell>`, `nrhp:<cell>`) by `scripts/build-holc.mjs` and
  `scripts/build-nrhp.mjs`; the CLI assembler reads the same partitions
  from `data/holc/`, `data/nrhp/` (gitignored — rebuild commands in
  README). Lookup logic is shared: `src/history.js`.
- holc lives in `tractCore.layers` (anchor point-in-polygon, centroid
  fallback; null = no coverage, which is most of the country and normal).
  historicPlaces live in `addressContext` (walk-scoped, per-address,
  nearest-first, cap 8; empty array is normal).
- The HISTORY movement: REQUIRED when holc is non-null (the record's
  hardest page may not be skipped), optional with historic places alone;
  documentary register; after home, before walking. Prompt rules 10-11
  govern content: state grade/year/definition plainly, never quote survey
  language, never draw the causal arrow to the present.
- The HOLC grade wash on the map quotes the archival grade colors (muted,
  lightened, never saturated) — the one sanctioned exception to the
  single-palette rule, because it is a quotation of the primary source.

## Diptych mode ("then & now", phase 5)

Sequential v1: essay one runs fully; its closing offers address two, whose
essay is synthesized with dossier one as COMPARISON CONTEXT (worker
`POST /essay` accepts `compareGeoid` + `compareGrid`). CACHE RULE: a
comparison-context essay depends on BOTH places and caches under
`tract<v>:<geoid>:<grid>:vs:<compareGeoid>` — never the plain key, or solo
readers of that tract inherit someone else's comparison. The diptych
closing is both portraits side by side (stacked at 390px), one combined
save, attribution once — no summary stats, no "winner."

## Known unknowns / verify before trusting

- ~~B25003 tenure variable codes~~ verified correct against 2024 metadata
  (001=total occupied, 002=owner, 003=renter), 2026-07-13
- ~~ACS_YEAR~~ bumped to 2024 (newest 5-year vintage); groups metadata
  endpoint verified on both 2023 and 2024. NOTE: the Census data API now
  requires a key even for low volume — there is no keyless fallback
- NLCD canopy, historical maps (Sanborn/USGS topo), and HOLC redlining
  layers are stubbed as null in the dossier — each is its own future spike;
  check licensing on Sanborn sheets and Mapping Inequality data before
  publishing any overlay

## Reference tracts

Three committed dossiers, each testing something different:

1. **55009010300** — De Pere WI (335 S Broadway): small-city baseline
2. **17031081402** — Chicago Streeterville: dense-urban contrast
3. **26163514300** — Detroit east side, tract 5143: hard-profile voice test

The hard tract was selected data-first from four candidates (Detroit east
side, Cleveland Hough, Gary Midtown, North St. Louis) by comparing dossiers,
not reputations. Detroit 5143 qualified on the most simultaneous signals
(2024 ACS 5-year / OSM as of 2026-07-13):

- Median year built 1938; 83% of units pre-1960; 8% built since 2000
- ~35% of housing units not occupied (1,181 units, 763 occupied households)
- 126 walkable features vs 216 (small-city ref) and 1,083 (dense-urban ref)
- Named geography layer came back empty — valid, and the starkest test of
  rule 2 (write the shape of what IS visible; no compensation)

North St. Louis (29510127700) had higher vacancy (~44%) but also 366
amenities and a named lake — a softer test of the arrival/walking movements.

## Movement architecture (phase 3 frontend)

The essay renders as ordered `<section>` movements over a persistent map
stage; color accumulates as layers arrive (final quantity of color =
quantity of data):

1. **Arrival** — blank paper + address input; committed address FLIPs into
   the dedication line; resolution ritual sets line-by-line; the map draws
   in the dossier's order of knowing (named geography inks first when
   present, street grid fades up around it; empty geography = grid draws
   alone, same timing). No fly-to, ever. Second-person prose follows.
2. **Built** — the ONLY scroll-scrubbed movement: scroll sets a target year,
   rAF eases toward it; equal scroll distance per decade (empty decades
   scroll at full length while only the year counter moves); housing units
   are an accumulating field of era-tinted marks beside the prose, never on
   the map (no footprints in the dossier); each paragraph lands after its
   decade range completes.
3. **Home** — the same marks resettle into a plain ordered field;
   vacancy (totalUnits − totalOccupied) hollows that many marks to outlines
   (seeded by GEOID, stable across visits, never on the map); filled marks
   split into the two tenure tones.
4. **Walking** — map returns centered on addressContext.anchor; the walk
   radius breathes out as a drawn line; only namedExamples with coordinates
   get plotted, in sync with the prose; anonymous counts stay prose-only.
   Closing state = the accumulated page (the shareable portrait, exported
   as an image).

All movements except Built use simple IntersectionObserver reveals.
prefers-reduced-motion swaps Built's scrub for per-decade small multiples
and every entrance for a plain fade — same truth, print form.

Standing rules from the phase-3 review:

- **The you-dot** — a small breathing ink dot at addressContext.anchor, the
  essay's protagonist. It appears as the LAST thing arrival draws and is
  never removed and never labeled: full opacity through the recede (it
  lives outside the fading map canvas), walking a dotted trail toward each
  paragraph's pins in Walking, present in the portrait. Reduced motion
  renders it as a static ring.
- **Marks never move.** The Home transition changes fills in place inside
  the decade columns — vacancy drains to outline, era tint crossfades to
  tenure tone. No position interpolation, ever. The homes didn't go
  anywhere; neither do the marks.
- **The tiles already hold buildings and parks.** Don't hide them: building
  fill is faint undated ink (never era-colored — we don't know building
  ages), surfacing as Built begins; park green arrives with the walk
  radius. Waterway lines carry a slow dash-flow (rivers move; showing that
  is true, not editorial).

Frontend fixtures pair `frontend/src/fixtures/dossier-<GEOID>.json` with
`frontend/src/fixtures/essays/essay-<GEOID>.json` by GEOID. The committed
essay JSONs are, as of phase 5, RATIFIED LIVE OUTPUT — generated by the
deployed worker pipeline and committed after human review against the
honesty rules (rule 11 especially). Fixtures and live are the same
pipeline's output by rule; the loader treats both identically.

Essay schema (fixtures and live are identical shapes BY RULE — the
synthesis prompt requests these fields and `worker/src/validate.js`
rejects essays without them):

- `title` + `movements[]` of `{id, layerRef, text}`
- the `built` movement REQUIRES `checkpoints`: 3–5 `{afterYear, text}`
  entries, strictly ascending, at the dossier's yearBuilt bucket
  boundaries; each text describes only construction up to its afterYear
  (the reader hasn't scrolled past it); joined texts = the movement text
- the `walking` movement REQUIRES `paragraphs`: 2–4 `{text, pins}`
  entries; every pin is a name copied verbatim from the dossier's
  `namedExamples` (validated case-insensitively — a pin naming something
  not in the record is an honesty violation), `[]` when a paragraph names
  nothing; joined texts = the movement text
- the checkpoint/paragraph requirements are conditional on the layer
  existing (no yearBuilt data → no built movement → no checkpoints)

The frontend keeps even-chunking fallbacks for resilience, but they are
fallbacks, not a supported shape. The KV tract cache key carries
`ESSAY_SCHEMA_VERSION` (`worker/src/index.js`) — bump it with any essay
schema change so stale cached essays regenerate.

## Worker architecture (phase 4, `worker/`)

The live pipeline is a Cloudflare Worker (`POST /essay`, plus `POST /geocode`
for the ritual's honest first line). Flow: geocode (Census geocoder is
server-side only — no CORS — which is why this exists) → KV lookup of
`{tractCore, essay}` keyed by **GEOID + the anchor's ~200m grid cell** → on
miss, run the existing `src/` fetch modules (they are imported directly;
`process.env` is populated from bindings) and synthesize with
`claude-sonnet-4-6` (prompt cached static rules from
`prompts/synthesis-prompt.md`, bundled at build time — never a divergent
copy; trimmed dossier via `synthesisView`) → validate the movement schema,
one corrective retry, structured error on second failure.

Why the grid cell is in the essay's cache key: the essay's walking prose is
synthesized from the requesting address's amenities, so an essay cached by
GEOID alone would hand a different address in the same tract another
walkshed's prose. The same `gridCell()` (1/500° ≈ 220m) keys the Overpass
response cache — one function, shared, in `worker/src/index.js`.
addressContext itself is still ALWAYS generated fresh per request (from the
grid-cached Overpass response); it is per-address by design and never
stored with the tract entry.

**Fixture-parity rule: live responses must always match the fixture shape.**
The frontend loader must not care whether data came from
`frontend/src/fixtures/` or the worker — same keys, same layer structure,
same `schemaVersion`. Any dossier schema change lands in three places at
once: `src/assemble.js`, the worker's `assembleDossier`, and the fixtures.

Secrets are never committed (`wrangler secret put CENSUS_API_KEY /
ANTHROPIC_API_KEY`; local dev uses gitignored `.dev.vars`). The Anthropic
console spend cap must be set before any deploy — owner task, not code.
Staging is an unlisted URL: no analytics, no public sharing, owner reviews
generated essays for unfamiliar places before any public step.

## Conventions

- Each data layer fetcher lives in its own module in `src/` and may fail
  independently; the assembler uses Promise.allSettled and writes a dossier
  with gaps rather than failing the whole run
- Dossiers are written to `data/dossier-<GEOID>.json` and are committed for
  the three reference tracts (see "Reference tracts" above)
- ACS sentinel values (large negatives like -666666666) must be nulled, not
  passed through
