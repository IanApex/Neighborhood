# Neighborhood Essay — data spike

## What this project is

A generated, scroll-driven visual essay about any US neighborhood. Enter an
address → resolve to a census tract → assemble a "place dossier" JSON from
open data → Claude synthesizes a narrative from the dossier ONLY → rendered
as a designed scrollytelling experience (MapLibre + scroll triggers, Vue 3).

This repo is currently **phase 1: the data spike.** Goal: produce complete,
readable dossiers for two contrasting tracts (one in De Pere WI, one dense
urban tract) and judge whether the raw material is rich enough.

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

## Known unknowns / verify before trusting

- ~~B25003 tenure variable codes~~ verified correct against 2024 metadata
  (001=total occupied, 002=owner, 003=renter), 2026-07-13
- ~~ACS_YEAR~~ bumped to 2024 (newest 5-year vintage); groups metadata
  endpoint verified on both 2023 and 2024. NOTE: the Census data API now
  requires a key even for low volume — there is no keyless fallback
- Amenities anchor on the input point (address/coords), not the tract
  centroid — centroids of large tracts can land far from anything walkable.
  This means the amenities layer is per-point, so a pure GEOID cache key
  slightly over-shares for large tracts; revisit when caching is built
- NLCD canopy, historical maps (Sanborn/USGS topo), and HOLC redlining
  layers are stubbed as null in the dossier — each is its own future spike;
  check licensing on Sanborn sheets and Mapping Inequality data before
  publishing any overlay

## Conventions

- Each data layer fetcher lives in its own module in `src/` and may fail
  independently; the assembler uses Promise.allSettled and writes a dossier
  with gaps rather than failing the whole run
- Dossiers are written to `data/dossier-<GEOID>.json` and are committed for
  the two reference tracts (they're the spike's actual deliverable)
- ACS sentinel values (large negatives like -666666666) must be nulled, not
  passed through
