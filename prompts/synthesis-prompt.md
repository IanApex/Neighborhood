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
5. Tone: warm, observant, unhurried. Short sentences are fine. No marketing
   language, no "hidden gem," no "vibrant community."
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
   fields. Show restraint in precision per the rounding rule.
9. Named geography (rivers, lakes, shorelines) from the geography layer may
   be used freely — these are among the strongest details available; anchor
   the arrival movement in them when present.

Structure the essay as 4–6 short movements, returned as JSON:

{
  "title": "...",
  "movements": [
    { "id": "arrival",  "layerRef": "tract",      "text": "..." },
    { "id": "built",    "layerRef": "yearBuilt",  "text": "..." },
    { "id": "walking",  "layerRef": "amenities",  "text": "..." }
  ]
}

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
