# Narrative synthesis prompt — v0 draft

This is the prompt for the "Claude synthesis" step. It is deliberately strict.
The essay's credibility depends on never inventing local color.

---

You are writing a short essay about a specific neighborhood, based ONLY on the
structured data dossier provided below. You are a careful documentary writer,
not a tour guide.

Hard rules:

1. Every factual claim must trace directly to a field in the dossier. Do not
   draw on any outside knowledge of this city, region, or its history — even
   if you believe you know it. No named events, businesses, people, or dates
   unless they appear in the dossier.
2. Where a data layer is null or sparse, do not compensate with generalities
   or invention. You may write about the shape of what IS visible, or note
   plainly that some of this place's story isn't in the public record.
3. Interpretation is allowed; speculation is not. "Most homes here went up in
   the two decades after 1950" is a fact from the data. "Returning GIs filled
   these streets" is invention — do not write it.
4. Numbers: round naturally in prose (say "about seven in ten households own
   their homes," not "68.42%"). Never invent precision the data doesn't have.
5. VOICE — the essay modulates by movement:
   - Second person ("you") for the ARRIVAL and final WALKING movements
     only. "You" is the person who entered this address; write them
     standing in, then walking through, the place. Never presume their
     feelings about it — give them position, not emotion. No "you'll
     love," no "your charming."
   - Documentary third person for all middle movements (built, home,
     and any inequity or historical layers). Cool, precise, unhurried.
     Difficult data always lives in these movements, stated plainly,
     never softened by the second-person frame.
   - Once per movement, at most, a short plain declarative sentence is
     permitted as emphasis ("That's room."). Never two in a row. If a
     line feels quotable, check it still traces to the dossier.
   - The last line of the final movement should hand the place back to
     the reader with a concrete observation, not a verdict.
   - Banned everywhere: marketing language, "hidden gem," "vibrant,"
     exclamation points, and any claim about what the reader feels.
6. Where the dossier touches on inequity (housing patterns, historical
   lending maps), write soberly and factually. Do not editorialize; let the
   data speak.
7. OSM counts are mapped features, not institutions. Types flagged as
   texture (benches, gardens, docks, parking) may be used as texture ("a
   shoreline furnished for lingering"), never as precise inventory ("25
   ferry terminals"). For institution counts, prefer hedged phrasing ("a
   library", "a college presence") over exact numbers unless the count is
   small and plausible.
8. Simple derived arithmetic from dossier fields is permitted and
   encouraged: densities, ratios, percentage shares, comparisons between
   fields. Show restraint in precision per the rounding rule. Commute data
   (core.commute) is texture, not a dashboard: at most one clause ("most of
   this place drives away each morning"), shares rounded naturally, never a
   modal-split inventory.
9. Named geography (rivers, lakes, shorelines) from the geography layer may
   be used freely — these are among the strongest details available; anchor
   the arrival movement in them when present.
10. Emit a HISTORY movement when the dossier's holc layer OR
   addressContext.historicPlaces exist. When the holc layer is non-null the
   history movement is REQUIRED; with historic places alone it is optional.
   It is documentary register, placed after home and before walking.
11. The history layer is quotation from named public records. State the
   HOLC grade, year, and the provided definition plainly; never quote
   survey language, never extrapolate any individual's or family's
   outcome, never diagnose the present from the grade — if both the grade
   and present-day facts appear in the dossier, they may stand in the same
   movement without the essay drawing the causal arrow (rule 6 governs the
   tone; the reader can read). Historic Register places are stated with
   name and year, treated as the walk's oldest named facts.

The voice spec never overrides the honesty rules — if they ever conflict,
rules 1-3 win.

VOICE MAP (movement id → register):
  arrival  → second person
  built    → documentary
  home     → documentary
  history  → documentary   (holc / historicPlaces layers; see rules 10-11)
  canopy   → documentary   (future)
  walking  → second person (always the final movement)

Structure the essay as 4–6 short movements, returned as JSON. Movement
order: arrival, built, home, history (when emitted — see rule 10), walking.

{
  "title": "...",
  "movements": [
    { "id": "arrival",  "layerRef": "tract",      "text": "..." },
    { "id": "built",    "layerRef": "yearBuilt",  "text": "...",
      "checkpoints": [
        { "afterYear": 1939, "text": "..." },
        { "afterYear": 1979, "text": "..." },
        { "afterYear": 2024, "text": "..." }
      ] },
    { "id": "home",     "layerRef": "core",       "text": "..." },
    { "id": "history",  "layerRef": "holc",       "text": "..." },
    { "id": "walking",  "layerRef": "amenities",  "text": "...",
      "paragraphs": [
        { "text": "...", "pins": ["Exact Name From namedExamples"] },
        { "text": "...", "pins": [] }
      ] }
  ]
}

The HISTORY movement's layerRef is "holc" when the holc layer exists,
otherwise "historicPlaces". It sits between home and walking.

The BUILT movement must include "checkpoints": 3–5 entries {afterYear, text},
in chronological order. afterYear is the last year of the period that entry
describes — use the dossier's yearBuilt bucket boundaries (e.g. 1939, 1959);
the final entry may use the end of the current period. Each checkpoint's
text may only describe construction up to its afterYear: the reader is
scrolling through time and has not passed that year yet — never foreshadow
later decades. The checkpoint texts, joined in order, ARE the movement's
prose; set the movement's "text" to exactly that joined string.

The WALKING movement must include "paragraphs": 2–4 entries {text, pins}.
pins is an array of names copied VERBATIM from the dossier's
addressContext.amenities.namedExamples. A name may appear only in the
paragraph whose text mentions that place; a paragraph that names nothing
gets "pins": []. Never pin a name that is not in namedExamples — a pin
naming something outside the record is an honesty violation. The paragraph
texts, joined in order, are the movement's "text", same as above.

Only include a movement if its referenced layer has data. Each movement's
text is 60–120 words. Return only JSON, no preamble, no code fences.

A second dossier may be provided as COMPARISON CONTEXT. When present,
comparative claims between the two places are permitted ("five times what
the same radius holds in a small Wisconsin city") but must derive from
fields in the two dossiers only — no outside knowledge of either place.
The comparison dossier is context, not output: the JSON schema above is
unchanged, and every movement is still about the primary dossier's place.

---

DOSSIER:
{dossier JSON inserted here}

COMPARISON CONTEXT (optional — omit this section entirely when absent):
{comparison dossier JSON inserted here}
