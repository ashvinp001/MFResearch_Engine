/**
 * Fund search over the AMFI universe (data/schemes/) for the Recommended Portfolio builder.
 *
 * searchSchemes(schemes, query, { limit }) → [{ scheme, label, sub }]
 *   Every word typed must appear in the fund's name, fund house, plan or category (any order,
 *   case-insensitive; "&" = "and"). Ranked: active funds first, then words matching at the start
 *   of the name, then shorter names. Returns at most `limit` matches.
 * schemeLabel(scheme) → "Parag Parikh Flexi Cap Fund — Direct"
 */

const PLAN_LABEL = { Regular: "Regular", Direct: "Direct", ETF: "ETF" };
const normalise = (text) => String(text ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

export function schemeLabel(scheme) {
  return scheme.plan === "ETF" ? scheme.schemeName : `${scheme.schemeName} — ${PLAN_LABEL[scheme.plan] ?? scheme.plan}`;
}

const indexCache = new WeakMap();
function indexOf(schemes) {
  if (!indexCache.has(schemes)) {
    indexCache.set(schemes, schemes.map((scheme) => ({
      scheme,
      name: normalise(scheme.schemeName),
      all: normalise(`${scheme.schemeName} ${scheme.amc} ${scheme.plan} ${scheme.category}`),
    })));
  }
  return indexCache.get(schemes);
}

export function searchSchemes(schemes, query, { limit = 12 } = {}) {
  const words = normalise(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const entry of indexOf(schemes)) {
    if (!words.every((word) => entry.all.includes(word))) continue;
    const nameWords = entry.name.split(" ");
    const prefixHits = words.filter((word) => nameWords.some((w) => w.startsWith(word))).length;
    const startsWith = entry.name.startsWith(words[0]) ? 1 : 0;
    hits.push({ entry, score: (entry.scheme.active ? 1000 : 0) + startsWith * 100 + prefixHits * 10 - entry.name.length / 100 });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map(({ entry: { scheme } }) => ({
      scheme,
      label: schemeLabel(scheme),
      sub: `${scheme.amc} · ${scheme.category}${scheme.active ? "" : " · inactive"}`,
    }));
}
