// Census ACS 5-year API: housing + population data for one tract.
// Docs: https://www.census.gov/data/developers/data-sets/acs-5year.html
// Requires a free API key: https://api.census.gov/data/key_signup.html
//
// Verified variables:
//   B25035_001E  Median year structure built
//   B25034_*     Year structure built, by period (buckets fetched via group())
//   B01003_001E  Total population
// To VERIFY on first run (I believe these are correct but confirm against
// the variables list for your chosen vintage):
//   B25003_001E/002E/003E  Tenure: total occupied / owner / renter

const ACS_YEAR = process.env.ACS_YEAR || '2024'; // newest 5-year vintage (verified live 2026-07)
const BASE = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5`;

function requireKey() {
  const key = process.env.CENSUS_API_KEY;
  if (!key) throw new Error('Set CENSUS_API_KEY (free: https://api.census.gov/data/key_signup.html)');
  return key;
}

// Rows come back as arrays with a header row; zip into an object.
function zipRow(json) {
  const [header, row] = json;
  return Object.fromEntries(header.map((h, i) => [h, row[i]]));
}

export async function fetchCoreStats({ state, county, tract }) {
  const key = requireKey();
  const vars = 'NAME,B25035_001E,B01003_001E,B25003_001E,B25003_002E,B25003_003E';
  const url = `${BASE}?get=${vars}&for=tract:${tract}&in=state:${state}%20county:${county}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS HTTP ${res.status}: ${await res.text()}`);
  const data = zipRow(await res.json());

  const num = (v) => {
    const n = Number(v);
    // ACS uses large negative sentinels (e.g. -666666666) for suppressed/unavailable.
    return Number.isFinite(n) && n > -1000 ? n : null;
  };

  return {
    tractName: data.NAME,
    medianYearBuilt: num(data.B25035_001E),
    population: num(data.B01003_001E),
    tenure: {
      totalOccupied: num(data.B25003_001E),
      ownerOccupied: num(data.B25003_002E),
      renterOccupied: num(data.B25003_003E),
    },
  };
}

// Year-built distribution (the "waves of construction" data).
// Uses group() to fetch all B25034 estimates, and the groups metadata
// endpoint to label each bucket — so this stays correct across vintages
// instead of hardcoding bucket labels that shift over time.
// If the groups metadata URL 404s on your vintage, fall back to:
//   https://api.census.gov/data/${ACS_YEAR}/acs/acs5/variables.json
export async function fetchYearBuiltDistribution({ state, county, tract }) {
  const key = requireKey();

  const labelsRes = await fetch(`${BASE}/groups/B25034.json`);
  if (!labelsRes.ok) throw new Error(`ACS groups metadata HTTP ${labelsRes.status} — see fallback note in source`);
  const labelsJson = await labelsRes.json();
  const labels = {}; // e.g. B25034_002E -> "Estimate!!Total:!!Built 2020 or later"
  for (const [name, meta] of Object.entries(labelsJson.variables || {})) {
    if (name.endsWith('E')) labels[name] = meta.label;
  }

  const url = `${BASE}?get=group(B25034)&for=tract:${tract}&in=state:${state}%20county:${county}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ACS HTTP ${res.status}: ${await res.text()}`);
  const data = zipRow(await res.json());

  const buckets = [];
  for (const [name, label] of Object.entries(labels)) {
    if (name === 'B25034_001E') continue; // total
    const count = Number(data[name]);
    if (!Number.isFinite(count)) continue;
    buckets.push({
      variable: name,
      label: label.replace(/Estimate!!Total:?!?!?/, '').replace(/^!+/, ''),
      count,
    });
  }
  // B25034 numbering runs newest (_002E, "2020 or later") to oldest (_011E,
  // "1939 or earlier"); sort descending so buckets read oldest-first.
  buckets.sort((a, b) => b.variable.localeCompare(a.variable));
  return {
    totalUnits: Number(data['B25034_001E']) || null,
    buckets,
  };
}
