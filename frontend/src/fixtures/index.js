// Fixture loader: pairs dossier + essay by GEOID. Static fixtures only in
// this phase — no API calls anywhere. Real essay JSONs replace the
// placeholders file-for-file; the loader treats both identically.

const dossierModules = import.meta.glob('./dossier-*.json', { eager: true });
const essayModules = import.meta.glob('./essays/essay-*.json', { eager: true });

const geoidOf = (path) => path.match(/(\d{11})\.json$/)?.[1];

const essays = {};
for (const [path, mod] of Object.entries(essayModules)) {
  essays[geoidOf(path)] = mod.default;
}

export const fixtures = Object.entries(dossierModules)
  .map(([path, mod]) => {
    const dossier = mod.default;
    const geoid = geoidOf(path);
    return { geoid, dossier, essay: essays[geoid] ?? null };
  })
  .filter((f) => f.essay) // a fixture is a PAIR; unpaired dossiers don't show
  .sort((a, b) => a.geoid.localeCompare(b.geoid));

export function fixtureFor(geoid) {
  return fixtures.find((f) => f.geoid === geoid) ?? null;
}
