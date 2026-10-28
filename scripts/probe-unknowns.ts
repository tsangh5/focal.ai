/**
 * Live checks for the open questions in docs/spec.md §8.
 *
 *   pnpm probe:unknowns            run every section whose keys are set
 *   pnpm probe:unknowns qloo jev   run only the named sections
 *
 * Sections:
 * - qloo: do tag signals change insights scores (per type)? does any weight
 *   syntax on entity signals take effect? how many entity signals are used?
 * - jev:  tokens, latency and accuracy of card identification on labelled
 *   sample pages, including pages that are not lists of things.
 * - llm:  which models each free OpenAI-compatible tier lists, and whether a
 *   tool-calling request comes back with tool calls.
 *
 * Keys come from .env or apps/web/.env.local and are never printed. The report
 * is written to scripts/probe-output/ (gitignored: Qloo's terms forbid storing
 * response data in a public repo). Exit codes: 0 ran, 1 failed, 2 no keys.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Relative, not `@focal-ai/core`: the probe takes no workspace dependency, and
// style.ts imports nothing, so tsx compiles it as plain source.
import {
  FACET_VALUES,
  STYLE_FACETS,
  facetCriteria,
  facetMatchesTag,
  type ProductDescriptor,
} from "../packages/core/src/style";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const outputDir = join(scriptDir, "probe-output");

for (const envFile of [join(repoRoot, ".env"), join(repoRoot, "apps/web/.env.local")]) {
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const SECTIONS = ["qloo", "jev", "llm"] as const;
type Section = (typeof SECTIONS)[number];

const report: string[] = [];

function log(line = ""): void {
  console.log(line);
  report.push(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errorText(body: unknown): string {
  const error = asRecord(asRecord(body)?.error);
  const text = error?.reason ?? error?.message ?? asRecord(body)?.message;
  return typeof text === "string" ? text : JSON.stringify(body)?.slice(0, 200) ?? "no body";
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Qloo
// ---------------------------------------------------------------------------

const QLOO_PACE_MS = 250; // stays under the observed 5 req/s burst limit
let lastQlooCallAt = 0;

type QlooReply = { status: number; ms: number; body: unknown };

async function qloo(apiKey: string, baseUrl: string, path: string, params: Record<string, string>): Promise<QlooReply> {
  const wait = lastQlooCallAt + QLOO_PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastQlooCallAt = Date.now();

  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}?${new URLSearchParams(params).toString()}`, {
    headers: { "X-Api-Key": apiKey },
  });
  const body: unknown = await response.json().catch(() => undefined);
  return { status: response.status, ms: Math.round(performance.now() - started), body };
}

type TypeCase = {
  label: string;
  type: string;
  city?: string;
  items: string[];
  tagQuery: string;
};

// Names mirror the Studio demo pages plus a film list; all are real entities.
const TYPE_CASES: TypeCase[] = [
  {
    label: "place (SF restaurants)",
    type: "urn:entity:place",
    city: "San Francisco",
    items: [
      "Bar Part Time",
      "Rintaro",
      "State Bird Provisions",
      "Zuni Café",
      "House of Prime Rib",
      "Tartine Manufactory",
      "Che Fico",
      "Nari",
      "Kin Khao",
      "Lazy Bear",
    ],
    tagQuery: "natural wine",
  },
  {
    label: "movie",
    type: "urn:entity:movie",
    items: [
      "Paprika",
      "Spirited Away",
      "The Godfather",
      "Mad Max: Fury Road",
      "Moonlight",
      "Lady Bird",
      "Hereditary",
      "The Notebook",
      "Toy Story",
      "Parasite",
    ],
    tagQuery: "anime",
  },
  {
    label: "brand",
    type: "urn:entity:brand",
    items: ["Aesop", "Muji", "Patagonia", "Nike", "Vitra", "Ferm Living", "Supreme", "Uniqlo", "Le Labo", "Gucci"],
    tagQuery: "minimalist",
  },
];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function entityType(entity: Record<string, unknown>): string | undefined {
  const types = asArray(entity.types);
  const first = types[0];
  if (typeof first === "string") return first;
  return typeof entity.subtype === "string" ? entity.subtype : undefined;
}

async function resolveEntity(
  apiKey: string,
  baseUrl: string,
  name: string,
  type: string,
  city?: string,
): Promise<string | undefined> {
  const params: Record<string, string> = { query: name, types: type, take: "5" };
  if (city !== undefined) params["filter.location.query"] = city;
  const reply = await qloo(apiKey, baseUrl, "/search", params);
  const results = asArray(asRecord(reply.body)?.results).map(asRecord);
  const match = results.find(
    (entity) =>
      entity !== undefined &&
      entityType(entity) === type &&
      normalize(String(entity.name ?? "")) === normalize(name),
  );
  return typeof match?.entity_id === "string" ? match.entity_id : undefined;
}

async function firstTagId(apiKey: string, baseUrl: string, query: string): Promise<{ id: string; name: string } | undefined> {
  const reply = await qloo(apiKey, baseUrl, "/v2/tags", { "filter.query": query, take: "5" });
  const tags = asArray(asRecord(asRecord(reply.body)?.results)?.tags).map(asRecord);
  const tag = tags.find((candidate) => typeof candidate?.id === "string");
  return tag ? { id: String(tag.id), name: String(tag.name ?? tag.id) } : undefined;
}

type Scores = { status: number; ms: number; error?: string; affinity: Map<string, number>; order: string[] };

async function insights(apiKey: string, baseUrl: string, params: Record<string, string>): Promise<Scores> {
  const reply = await qloo(apiKey, baseUrl, "/v2/insights", params);
  const entities = asArray(asRecord(asRecord(reply.body)?.results)?.entities).map(asRecord);
  const affinity = new Map<string, number>();
  const order: string[] = [];
  for (const entity of entities) {
    if (entity === undefined || typeof entity.entity_id !== "string") continue;
    order.push(entity.entity_id);
    const value = asNumber(asRecord(entity.query)?.affinity);
    if (value !== undefined) affinity.set(entity.entity_id, value);
  }
  return {
    status: reply.status,
    ms: reply.ms,
    ...(reply.status >= 400 ? { error: errorText(reply.body) } : {}),
    affinity,
    order,
  };
}

/** Taste Context: `filter.type=urn:tag` puts the vocabulary under `results.tags`. */
async function tagAffinities(
  apiKey: string,
  baseUrl: string,
  signalEntityIds: string[],
): Promise<{ tags: { id: string; name: string; affinity?: number }[]; error?: string }> {
  const reply = await qloo(apiKey, baseUrl, "/v2/insights", {
    "filter.type": "urn:tag",
    "signal.interests.entities": signalEntityIds.join(","),
    take: "18",
  });
  if (reply.status >= 400) return { tags: [], error: errorText(reply.body) };
  const values = asArray(asRecord(asRecord(reply.body)?.results)?.tags).map(asRecord);
  const tags: { id: string; name: string; affinity?: number }[] = [];
  for (const value of values) {
    if (value === undefined) continue;
    const id = typeof value.id === "string" ? value.id : value.tag_id;
    if (typeof id !== "string" || typeof value.name !== "string") continue;
    const affinity = asNumber(asRecord(value.query)?.affinity);
    tags.push({ id, name: value.name, ...(affinity !== undefined ? { affinity } : {}) });
  }
  return { tags };
}

function compare(base: Scores, variant: Scores): { maxDelta: number; meanDelta: number; orderChanged: boolean } {
  const deltas: number[] = [];
  for (const [id, value] of base.affinity) {
    const other = variant.affinity.get(id);
    if (other !== undefined) deltas.push(Math.abs(other - value));
  }
  const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;
  const meanDelta = deltas.length > 0 ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length : 0;
  return { maxDelta, meanDelta, orderChanged: base.order.join() !== variant.order.join() };
}

/** Mean absolute difference over the ids both score; lower = closer. */
function distance(a: Scores, b: Scores): number {
  const deltas: number[] = [];
  for (const [id, value] of a.affinity) {
    const other = b.affinity.get(id);
    if (other !== undefined) deltas.push(Math.abs(other - value));
  }
  return deltas.length > 0 ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length : Number.NaN;
}

function describe(scores: Scores): string {
  if (scores.error !== undefined) return `HTTP ${scores.status} — ${scores.error}`;
  return `HTTP ${scores.status}, ${scores.order.length} scored, ${scores.affinity.size} with affinity, ${scores.ms} ms`;
}

const EFFECT_THRESHOLD = 0.002;

// Candidate syntaxes for weighted entity signals. Qloo silently ignores
// unsupported parameters, so a 200 that matches the unweighted baseline means
// "ignored". Add the documented syntax here once confirmed in Qloo's reference.
const WEIGHT_VARIANTS: { label: string; params: (heavy: string, light: string) => Record<string, string> }[] = [
  {
    label: 'JSON [{"entity","weight"}]',
    params: (heavy, light) => ({
      "signal.interests.entities": JSON.stringify([
        { entity: heavy, weight: 25 },
        { entity: light, weight: 1 },
      ]),
    }),
  },
  {
    label: 'JSON [{"entity_id","weight"}]',
    params: (heavy, light) => ({
      "signal.interests.entities": JSON.stringify([
        { entity_id: heavy, weight: 25 },
        { entity_id: light, weight: 1 },
      ]),
    }),
  },
];

async function runQloo(): Promise<boolean> {
  const apiKey = env("QLOO_API_KEY");
  if (apiKey === undefined) {
    log("qloo: SKIPPED — set QLOO_API_KEY in .env or apps/web/.env.local");
    return false;
  }
  const baseUrl = (env("QLOO_API_BASE") ?? "https://hackathon.api.qloo.com").replace(/\/+$/, "");
  log("## Qloo");
  log();

  const fugazi = await resolveEntity(apiKey, baseUrl, "Fugazi", "urn:entity:artist");
  const swift = await resolveEntity(apiKey, baseUrl, "Taylor Swift", "urn:entity:artist");
  if (fugazi === undefined || swift === undefined) {
    log("Could not resolve the seed artists (Fugazi, Taylor Swift) — aborting the Qloo section.");
    return true;
  }

  // 1. Tag signals, per type
  log("### 1. Do tag signals change scores?");
  log();
  const resolvedByCase = new Map<string, string[]>();
  for (const typeCase of TYPE_CASES) {
    const ids: string[] = [];
    for (const item of typeCase.items) {
      const id = await resolveEntity(apiKey, baseUrl, item, typeCase.type, typeCase.city);
      if (id !== undefined) ids.push(id);
    }
    resolvedByCase.set(typeCase.label, ids);
    const tag = await firstTagId(apiKey, baseUrl, typeCase.tagQuery);
    log(`**${typeCase.label}** — resolved ${ids.length}/${typeCase.items.length}; tag for "${typeCase.tagQuery}": ${tag ? `${tag.name} (${tag.id})` : "none found"}`);
    if (ids.length < 3 || tag === undefined) {
      log("- skipped: need at least 3 resolved items and a tag");
      log();
      continue;
    }

    const common: Record<string, string> = {
      "filter.type": typeCase.type,
      "filter.results.entities": ids.join(","),
      "feature.explainability": "true",
      take: String(Math.min(50, Math.max(20, ids.length))),
    };
    if (typeCase.city !== undefined) common["filter.location.query"] = typeCase.city;

    const base = await insights(apiKey, baseUrl, { ...common, "signal.interests.entities": fugazi });
    const withTag = await insights(apiKey, baseUrl, {
      ...common,
      "signal.interests.entities": fugazi,
      "signal.interests.tags": tag.id,
    });
    const tagOnly = await insights(apiKey, baseUrl, { ...common, "signal.interests.tags": tag.id });

    log(`- entity signal only: ${describe(base)}`);
    log(`- entity + tag signal: ${describe(withTag)}`);
    log(`- tag signal only: ${describe(tagOnly)}`);
    if (base.error === undefined && withTag.error === undefined) {
      const effect = compare(base, withTag);
      const verdict = effect.maxDelta > EFFECT_THRESHOLD || effect.orderChanged ? "TAG SIGNAL TAKES EFFECT" : "NO EFFECT (likely ignored)";
      log(`- **${verdict}** — max |Δaffinity| ${round(effect.maxDelta)}, mean ${round(effect.meanDelta)}, order changed: ${effect.orderChanged}`);
    }
    log();
  }

  // 2. Weighted entity signals
  log("### 2. Are signal weights accepted?");
  log();
  const targets = resolvedByCase.get(TYPE_CASES[0]?.label ?? "") ?? [];
  if (targets.length < 3) {
    log("- skipped: not enough resolved place targets");
  } else {
    const common: Record<string, string> = {
      "filter.type": "urn:entity:place",
      "filter.results.entities": targets.join(","),
      "filter.location.query": "San Francisco",
      take: "20",
    };
    const heavyOnly = await insights(apiKey, baseUrl, { ...common, "signal.interests.entities": fugazi });
    const unweighted = await insights(apiKey, baseUrl, { ...common, "signal.interests.entities": `${fugazi},${swift}` });
    const baseline = distance(unweighted, heavyOnly);
    log(`- Fugazi only: ${describe(heavyOnly)}`);
    log(`- Fugazi + Taylor Swift, unweighted: ${describe(unweighted)} — distance to Fugazi-only ${round(baseline)}`);
    for (const variant of WEIGHT_VARIANTS) {
      const scores = await insights(apiKey, baseUrl, { ...common, ...variant.params(fugazi, swift) });
      if (scores.error !== undefined || scores.affinity.size === 0) {
        log(`- ${variant.label}: REJECTED or empty — ${describe(scores)}`);
        continue;
      }
      const toHeavy = distance(scores, heavyOnly);
      const sameAsUnweighted = compare(unweighted, scores).maxDelta <= EFFECT_THRESHOLD;
      const verdict = sameAsUnweighted
        ? "IGNORED (same as unweighted)"
        : toHeavy < baseline
          ? "TAKES EFFECT (moved toward the heavier like)"
          : "CHANGED, but not toward the heavier like";
      log(`- ${variant.label}: **${verdict}** — distance to Fugazi-only ${round(toHeavy)}`);
    }
  }
  log();

  // 3. Signal cap
  log("### 3. How many entity signals are used?");
  log();
  const recs = await insights(apiKey, baseUrl, {
    "filter.type": "urn:entity:artist",
    "signal.interests.entities": fugazi,
    take: "50",
  });
  const signalPool = recs.order.filter((id) => id !== fugazi);
  log(`- signal pool: ${signalPool.length} artist ids from a recommendations call (${describe(recs)})`);
  if (targets.length >= 3 && signalPool.length >= 20) {
    const common: Record<string, string> = {
      "filter.type": "urn:entity:place",
      "filter.results.entities": targets.join(","),
      "filter.location.query": "San Francisco",
      take: "20",
    };
    let previous: Scores | undefined;
    for (const count of [20, 35, 50]) {
      if (signalPool.length < count) break;
      const scores = await insights(apiKey, baseUrl, {
        ...common,
        "signal.interests.entities": signalPool.slice(0, count).join(","),
      });
      const change =
        previous !== undefined && scores.error === undefined && previous.error === undefined
          ? ` — vs previous: max |Δ| ${round(compare(previous, scores).maxDelta)} (a change means the extra signals are used)`
          : "";
      log(`- ${count} signals: ${describe(scores)}${change}`);
      previous = scores;
    }
  } else {
    log("- skipped: not enough targets or signal ids");
  }
  log();

  // 4. Taste vocabulary reach over the product facet table (§5.11)
  log("### 4. Do taste vocabularies reach the product facets?");
  log();
  log(
    "Product scoring joins Qloo's taste tags to the facet table by synonym. A profile whose tags reach no facet scores nothing and the grid is left alone, so reach is the ceiling on how often product ranking does anything at all.",
  );
  log();
  const signalSets: { label: string; ids: string[] }[] = [
    { label: "Fugazi only", ids: [fugazi] },
    ...(targets.length > 0 ? [{ label: "Fugazi + SF places", ids: [fugazi, ...targets.slice(0, 3)] }] : []),
  ];
  for (const set of signalSets) {
    const tags = await tagAffinities(apiKey, baseUrl, set.ids);
    if (tags.error !== undefined) {
      log(`- ${set.label}: ERROR ${tags.error}`);
      continue;
    }
    const reached = new Map<string, string[]>();
    for (const facet of STYLE_FACETS) {
      for (const value of FACET_VALUES[facet]) {
        const hits = tags.tags.filter((t) => facetMatchesTag(value, t.name)).map((t) => t.name);
        if (hits.length > 0) reached.set(`${facet}:${value.id}`, [...new Set(hits)]);
      }
    }
    const total = STYLE_FACETS.reduce((n, f) => n + FACET_VALUES[f].length, 0);
    log(`- **${set.label}** — ${tags.tags.length} tags, reaching ${reached.size}/${total} facet values`);
    for (const [value, hits] of reached) log(`  - ${value} ← ${hits.join(", ")}`);
    if (reached.size === 0) log("  - (no overlap: product grids would be left alone for this profile)");
  }
  log();
  return true;
}

// ---------------------------------------------------------------------------
// Jev (TypeSafe System One)
// ---------------------------------------------------------------------------

/**
 * Must stay in step with TYPE_CHOICES in
 * apps/web/lib/server/jev/client.ts — the probe measures the shipped
 * vocabulary, so a copy that has drifted measures nothing useful. The facet
 * vocabulary below is imported rather than copied for exactly that reason;
 * these strings cannot be, because the probe takes no workspace dependency.
 */
const QLOO_TYPES: Record<string, string> = {
  place: "A physical venue: restaurant, bar, café, hotel, shop, museum or similar",
  destination: "A city, region, country or travel destination",
  movie: "A film",
  tv_show: "A TV series",
  artist: "A musician or band",
  book: "A book",
  podcast: "A podcast",
  video_game: "A video game",
  brand: "A company or brand, including fashion, beauty and product brands",
  person: "A public figure such as an actor, author or athlete",
  product:
    "A specific item for sale whose card does not name its brand: a garment, shoe, accessory or piece of homeware on a single-brand store",
  not_a_thing: "Not a named real-world thing: an email, article headline, ad copy or interface text",
};

type SampleCard = { snippets: string[]; name: number | "none"; type: string; city?: string };
type SamplePage = {
  label: string;
  site: string;
  title: string;
  cityHints: string[];
  isList: boolean;
  cards: SampleCard[];
  /** Hand-labelled facets per card, for the product describe pass (§5.11). */
  facets?: ProductDescriptor[];
};

// Hand-labelled pages shaped like real listings; the name is not always the
// first snippet, and the last two pages are not lists of things.
const SAMPLE_PAGES: SamplePage[] = [
  {
    label: "restaurant search",
    site: "www.yelp.com",
    title: "Top 10 Best Dinner near San Francisco, CA",
    cityHints: ["San Francisco, CA", "Mission District"],
    isList: true,
    cards: [
      { snippets: ["Sponsored", "Olive Garden Italian Restaurant", "4.0 (812 reviews)", "Italian · $$"], name: 1, type: "place", city: "San Francisco, CA" },
      { snippets: ["Rintaro", "4.6 (1,203 reviews)", "Izakaya · Mission · $$", "Open until 10:00 PM"], name: 0, type: "place", city: "San Francisco, CA" },
      { snippets: ["4.5 (2,876 reviews)", "State Bird Provisions", "New American · Fillmore", "$$$"], name: 1, type: "place", city: "San Francisco, CA" },
      { snippets: ["Zuni Café", "Californian · Hayes Valley", "Closed now", "1658 Market St"], name: 0, type: "place", city: "San Francisco, CA" },
      { snippets: ["Bar Part Time", "Wine Bars · Mission", "4.7 (318 reviews)", "Happy hour"], name: 0, type: "place", city: "San Francisco, CA" },
    ],
  },
  {
    label: "film list",
    site: "letterboxd.com",
    title: "Favourite films of 2006 · a list by someone",
    cityHints: [],
    isList: true,
    cards: [
      { snippets: ["1.", "Paprika", "2006", "Satoshi Kon"], name: 1, type: "movie" },
      { snippets: ["2.", "Pan's Labyrinth", "2006", "Guillermo del Toro"], name: 1, type: "movie" },
      { snippets: ["3.", "Children of Men", "2006", "Alfonso Cuarón"], name: 1, type: "movie" },
      { snippets: ["4.", "The Prestige", "2006", "Christopher Nolan"], name: 1, type: "movie" },
    ],
  },
  {
    // Multi-brand: every card names a brand Qloo knows, so these must keep
    // resolving as entities. This is the path §5.11 must not regress.
    label: "multi-brand shop grid (brand is not the product name)",
    site: "www.ssense.com",
    title: "Designer Home & Lifestyle",
    cityHints: [],
    isList: true,
    cards: [
      { snippets: ["Aesop", "Resurrection Aromatique Hand Wash", "$41"], name: 0, type: "brand" },
      { snippets: ["New season", "Le Labo", "Santal 33 Eau de Parfum", "$220"], name: 1, type: "brand" },
      { snippets: ["Ferm Living", "Pond Mirror", "$189"], name: 0, type: "brand" },
      { snippets: ["Vitra", "Eames Elephant", "$275", "Low stock"], name: 0, type: "brand" },
    ],
  },
  {
    // The page that prompted §5.11: a single-brand store never prints its own
    // name on the tile, so there is no brand to choose and no entity to
    // resolve. `is_list` measured 0.45 here when products were `not_a_thing`;
    // this sample is what re-measures it.
    label: "single-brand product grid (uniqlo.com/ca/en/men/shirts-and-polo-shirts)",
    site: "www.uniqlo.com",
    title: "Men's Shirts & Polo Shirts",
    cityHints: [],
    isList: true,
    cards: [
      { snippets: ["Dry-EX Short Sleeve Polo Shirt", "$39.90", "6 Colors"], name: 0, type: "product" },
      { snippets: ["Supima Cotton Crew Neck Short Sleeve T-Shirt", "$19.90", "12 Colors"], name: 0, type: "product" },
      { snippets: ["New", "Selvedge Denim Work Shirt", "$59.90", "2 Colors"], name: 1, type: "product" },
      { snippets: ["Extra Fine Merino Crew Neck Sweater", "$49.90", "9 Colors"], name: 0, type: "product" },
      { snippets: ["Linen Blend Long Sleeve Shirt", "$39.90", "5 Colors"], name: 0, type: "product" },
      { snippets: ["Blocktech Hooded Parka", "$99.90", "Limited offer", "3 Colors"], name: 0, type: "product" },
    ],
    facets: [
      { style: "athletic", formality: "casual" },
      { style: "minimal", formality: "casual" },
      { style: "workwear", formality: "smart-casual" },
      { style: "minimal", formality: "smart-casual" },
      { style: "classic", formality: "smart-casual" },
      { style: "outdoor", formality: "casual" },
    ],
  },
  {
    label: "email inbox (not a list of things)",
    site: "mail.example.com",
    title: "Inbox (3)",
    cityHints: [],
    isList: false,
    cards: [
      { snippets: ["Jane Cooper", "Re: Q3 budget", "Thanks for sending this over", "10:42 AM"], name: "none", type: "not_a_thing" },
      { snippets: ["Rintaro", "Your reservation is confirmed", "Party of 2 on Friday", "9:15 AM"], name: "none", type: "not_a_thing" },
      { snippets: ["GitHub", "[focal.ai] CI passed", "All checks have passed", "Yesterday"], name: "none", type: "not_a_thing" },
    ],
  },
  {
    label: "news headlines (not a list of things)",
    site: "news.example.com",
    title: "Top stories",
    cityHints: [],
    isList: false,
    cards: [
      { snippets: ["World", "Storm closes highways across the region", "3 hours ago"], name: "none", type: "not_a_thing" },
      { snippets: ["Business", "Retail chain posts record quarter", "5 hours ago"], name: "none", type: "not_a_thing" },
      { snippets: ["Culture", "Festival lineup announced for spring", "Yesterday"], name: "none", type: "not_a_thing" },
    ],
  },
];

type JevChoice = { choice?: string; confidence?: number };

function buildJevRequest(page: SamplePage, model: string): Record<string, unknown> {
  const questions: Record<string, unknown> = {
    is_list: {
      type: "noul",
      instructions:
        "Is this page section a list of named real-world things (venues, films, shows, artists, books, podcasts, games, brands, destinations, public figures or products for sale)?",
      criteria: null,
    },
  };
  const cards = page.cards.map((card, index) => {
    const snippets: Record<string, string> = {};
    card.snippets.forEach((text, position) => {
      snippets[`s${position}`] = text;
    });
    const nameCriteria: Record<string, string> = { ...snippets, none: "None of these snippets names a real-world thing" };
    questions[`c${index}_name`] = {
      type: "choice",
      instructions: `Which snippet of card c${index} is the name of the thing the card is about? If the card names a brand, choose the brand. Otherwise, for a product card, choose the product name — never the price or the colour count.`,
      criteria: nameCriteria,
    };
    questions[`c${index}_type`] = {
      type: "choice",
      instructions: `What kind of thing is card c${index} about?`,
      criteria: QLOO_TYPES,
    };
    if (page.cityHints.length > 0) {
      const cityCriteria: Record<string, string> = { unknown: "The city cannot be told from the page" };
      page.cityHints.forEach((hint, position) => {
        cityCriteria[`h${position}`] = hint;
      });
      questions[`c${index}_city`] = {
        type: "choice",
        instructions: `Which city hint gives the city of the thing on card c${index}?`,
        criteria: cityCriteria,
      };
    }
    return { id: `c${index}`, snippets };
  });

  return {
    model,
    state: { site: page.site, title: page.title, cityHints: page.cityHints, cards },
    questions,
  };
}

/**
 * Mirrors buildDescribeRequest in apps/web/lib/server/jev/client.ts: the
 * facets are read from the product name alone, one single-choice question per
 * facet. The criteria come from the shared vocabulary, so only the
 * instruction text can drift.
 */
function buildDescribeRequest(names: string[], model: string): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  names.forEach((name, index) => {
    for (const facet of STYLE_FACETS) {
      questions[`p${index}_${facet}`] = {
        type: "choice",
        instructions: `For the product "${name}", which ${facet} does it belong to?`,
        criteria: facetCriteria(facet),
      };
    }
  });
  return { model, state: { products: names.map((name, index) => ({ id: `p${index}`, name })) }, questions };
}

type Graded = { field: string; correct: boolean; confidence: number };

async function runJev(): Promise<boolean> {
  const apiKey = env("TYPESAFE_API_KEY");
  if (apiKey === undefined) {
    log("jev: SKIPPED — set TYPESAFE_API_KEY in .env or apps/web/.env.local");
    return false;
  }
  const baseUrl = (env("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai").replace(/\/+$/, "");
  const model = env("TYPESAFE_MODEL") ?? "jev-latest";
  const pricePerMTok = Number(env("JEV_PRICE_PER_MTOK") ?? "0.042");
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  log("## Jev");
  log();
  const modelsReply = await fetch(`${baseUrl}/v1/models`, { headers });
  const modelsBody: unknown = await modelsReply.json().catch(() => undefined);
  const models = asArray(asRecord(modelsBody)?.models)
    .map((card) => asRecord(card)?.name)
    .filter((name): name is string => typeof name === "string");
  log(`- models (HTTP ${modelsReply.status}): ${models.length > 0 ? models.join(", ") : errorText(modelsBody)}`);
  log(`- using model \`${model}\`, priced at $${pricePerMTok} per million input tokens (override with JEV_PRICE_PER_MTOK)`);
  log();

  const graded: Graded[] = [];
  const facetGraded: Graded[] = [];
  let totalTokens = 0;
  let totalCards = 0;
  for (const page of SAMPLE_PAGES) {
    const started = performance.now();
    const response = await fetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildJevRequest(page, model)),
    });
    const ms = Math.round(performance.now() - started);
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      log(`**${page.label}** — HTTP ${response.status}: ${errorText(body)}`);
      continue;
    }
    const answers = asRecord(asRecord(body)?.answers) ?? {};
    const tokens = asNumber(asRecord(asRecord(body)?.usage)?.input_tokens);
    if (tokens !== undefined) totalTokens += tokens;
    totalCards += page.cards.length;

    const isList = asNumber(asRecord(answers.is_list)?.noul);
    // The 0.5 cut-off is the gate the whole page passes or fails on, so call
    // the verdict rather than leaving the reader to compare two numbers.
    const listVerdict =
      isList === undefined ? "?" : `${round(isList, 2)} ${isList >= 0.5 === page.isList ? "✓" : "✗"}`;
    log(
      `**${page.label}** — ${ms} ms, ${tokens ?? "?"} input tokens` +
        (tokens !== undefined ? ` (~$${(tokens / 1e6 * pricePerMTok).toFixed(6)})` : "") +
        `, is a list: ${listVerdict} (expected ${page.isList ? "yes" : "no"}, cut-off 0.5)`,
    );

    page.cards.forEach((card, index) => {
      const name = asRecord(answers[`c${index}_name`]) as JevChoice | undefined;
      const type = asRecord(answers[`c${index}_type`]) as JevChoice | undefined;
      const expectedName = card.name === "none" ? "none" : `s${card.name}`;
      const checks: [string, JevChoice | undefined, string][] = [
        ["name", name, expectedName],
        ["type", type, card.type],
      ];
      if (card.city !== undefined) {
        const city = asRecord(answers[`c${index}_city`]) as JevChoice | undefined;
        const expectedCity = `h${page.cityHints.indexOf(card.city)}`;
        checks.push(["city", city, expectedCity]);
      }
      const parts: string[] = [];
      for (const [field, answer, expected] of checks) {
        const correct = answer?.choice === expected;
        const confidence = answer?.confidence ?? 0;
        graded.push({ field, correct, confidence });
        parts.push(`${field} ${correct ? "✓" : `✗ (got ${answer?.choice ?? "?"}, want ${expected})`} ${round(confidence, 2)}`);
      }
      log(`  - c${index} ${card.snippets.join(" | ")} → ${parts.join("; ")}`);
    });

    // Second call, product pages only: the facets are read from the product
    // name alone, so this is the accuracy §5.11's scoring actually rests on.
    if (page.facets !== undefined) {
      const names = page.cards.map((card) => (card.name === "none" ? "" : (card.snippets[card.name] ?? "")));
      const started2 = performance.now();
      const res2 = await fetch(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildDescribeRequest(names, model)),
      });
      const ms2 = Math.round(performance.now() - started2);
      const body2: unknown = await res2.json().catch(() => undefined);
      if (!res2.ok) {
        log(`  describe — HTTP ${res2.status}: ${errorText(body2)}`);
      } else {
        const a2 = asRecord(asRecord(body2)?.answers) ?? {};
        const tokens2 = asNumber(asRecord(asRecord(body2)?.usage)?.input_tokens);
        if (tokens2 !== undefined) totalTokens += tokens2;
        log(`  describe — ${ms2} ms, ${tokens2 ?? "?"} input tokens`);
        names.forEach((productName, index) => {
          const expected = page.facets![index] ?? {};
          const parts: string[] = [];
          for (const facet of STYLE_FACETS) {
            const answer = asRecord(a2[`p${index}_${facet}`]) as JevChoice | undefined;
            const got = answer?.choice ?? "?";
            const want = expected[facet];
            // An unlabelled facet is not graded: "unknown" is a valid answer
            // for an axis a title genuinely does not carry (palette, mostly).
            if (want === undefined) {
              parts.push(`${facet} – (got ${got})`);
              continue;
            }
            const correct = got === want;
            facetGraded.push({ field: facet, correct, confidence: answer?.confidence ?? 0 });
            parts.push(`${facet} ${correct ? "✓" : `✗ (got ${got}, want ${want})`} ${round(answer?.confidence ?? 0, 2)}`);
          }
          log(`  - p${index} ${productName} → ${parts.join("; ")}`);
        });
      }
    }
    log();
  }

  if (facetGraded.length > 0) {
    log("### Facet accuracy (product descriptors)");
    log();
    log("| facet | graded | correct | mean confidence |");
    log("|---|---|---|---|");
    for (const facet of [...STYLE_FACETS, "all" as const]) {
      const rows = facet === "all" ? facetGraded : facetGraded.filter((g) => g.field === facet);
      if (rows.length === 0) continue;
      const correct = rows.filter((g) => g.correct).length;
      const meanConfidence = rows.reduce((s, g) => s + g.confidence, 0) / rows.length;
      log(`| ${facet} | ${rows.length} | ${correct} (${round((correct / rows.length) * 100, 1)}%) | ${round(meanConfidence, 2)} |`);
    }
    log();
    log(`Facets below the ${0.6} confidence floor are dropped by \`parseDescribeAnswers\`, leaving the axis unset.`);
    log();
  }

  if (graded.length > 0) {
    log("### Accuracy by confidence threshold");
    log();
    log("| threshold | answers kept | accuracy of kept |");
    log("|---|---|---|");
    for (const threshold of [0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
      const kept = graded.filter((answer) => answer.confidence >= threshold);
      const accuracy = kept.length > 0 ? kept.filter((answer) => answer.correct).length / kept.length : Number.NaN;
      log(`| ${threshold} | ${kept.length}/${graded.length} | ${Number.isNaN(accuracy) ? "–" : `${round(accuracy * 100, 1)}%`} |`);
    }
    log();
    if (totalCards > 0 && totalTokens > 0) {
      const perCard = totalTokens / totalCards;
      log(`- ~${Math.round(perCard)} input tokens per card; a 30-card page ≈ ${Math.round(perCard * 30)} tokens ≈ $${(perCard * 30 / 1e6 * pricePerMTok).toFixed(5)}`);
      log();
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Free LLM tiers (OpenAI-compatible)
// ---------------------------------------------------------------------------

type Provider = { name: string; keyEnv: string; baseUrl: string; model: string };

// Default model ids are best guesses; each is overridable and the listing
// printed below shows what the provider actually serves.
const PROVIDERS: Provider[] = [
  { name: "groq", keyEnv: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", model: env("GROQ_MODEL") ?? "openai/gpt-oss-120b" },
  { name: "cerebras", keyEnv: "CEREBRAS_API_KEY", baseUrl: "https://api.cerebras.ai/v1", model: env("CEREBRAS_MODEL") ?? "gpt-oss-120b" },
  { name: "openrouter", keyEnv: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", model: env("OPENROUTER_MODEL") ?? "openai/gpt-oss-120b:free" },
];

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "search_entities",
    description: "Look up a named thing in the taste graph before adding it to the user's profile.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The name as the user said it" },
        type: { type: "string", enum: Object.keys(QLOO_TYPES).filter((key) => key !== "not_a_thing") },
      },
      required: ["query", "type"],
      additionalProperties: false,
    },
  },
};

async function runLlm(): Promise<boolean> {
  const configured = PROVIDERS.filter((provider) => env(provider.keyEnv) !== undefined);
  if (configured.length === 0) {
    log(`llm: SKIPPED — set any of ${PROVIDERS.map((provider) => provider.keyEnv).join(", ")}`);
    return false;
  }
  log("## Free LLM tiers");
  log();
  for (const provider of configured) {
    const headers = { Authorization: `Bearer ${env(provider.keyEnv) ?? ""}`, "Content-Type": "application/json" };
    log(`**${provider.name}**`);

    const listing = await fetch(`${provider.baseUrl}/models`, { headers });
    const listingBody: unknown = await listing.json().catch(() => undefined);
    const ids = asArray(asRecord(listingBody)?.data)
      .map(asRecord)
      .filter((model): model is Record<string, unknown> => model !== undefined)
      .filter((model) =>
        provider.name !== "openrouter" ||
        (String(model.id).endsWith(":free") && asArray(model.supported_parameters).includes("tools")),
      )
      .map((model) => String(model.id));
    log(`- models (HTTP ${listing.status}${provider.name === "openrouter" ? ", free with tool support" : ""}): ${ids.length > 0 ? ids.slice(0, 25).join(", ") : errorText(listingBody)}`);
    log(`- testing \`${provider.model}\` (${ids.includes(provider.model) ? "listed" : "not in the listing"})`);

    const started = performance.now();
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: "You build the user's taste profile. Look up every named thing they mention with search_entities before saying anything else." },
          { role: "user", content: "I love the band Fugazi and the film Paprika." },
        ],
        tools: [SEARCH_TOOL],
        tool_choice: "auto",
      }),
    });
    const ms = Math.round(performance.now() - started);
    const body: unknown = await response.json().catch(() => undefined);
    const limits = [...response.headers.entries()]
      .filter(([name]) => name.startsWith("x-ratelimit"))
      .map(([name, value]) => `${name.replace("x-ratelimit-", "")}=${value}`)
      .join(", ");
    if (!response.ok) {
      log(`- tool call: HTTP ${response.status} — ${errorText(body)}`);
    } else {
      const message = asRecord(asRecord(asArray(asRecord(body)?.choices)[0])?.message);
      const calls = asArray(message?.tool_calls)
        .map((call) => asRecord(asRecord(call)?.function))
        .map((fn) => `${String(fn?.name)}(${String(fn?.arguments)})`);
      const usage = asRecord(asRecord(body)?.usage);
      log(`- tool call: ${calls.length > 0 ? `**WORKS** — ${calls.join(", ")}` : "**NO TOOL CALLS** returned"} (${ms} ms, ${asNumber(usage?.prompt_tokens) ?? "?"} prompt tokens)`);
    }
    if (limits) log(`- rate-limit headers: ${limits}`);
    log();
  }
  return true;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => !(SECTIONS as readonly string[]).includes(arg));
  if (unknown.length > 0) {
    console.error(`Unknown section(s): ${unknown.join(", ")}. Choose from: ${SECTIONS.join(", ")}.`);
    process.exit(1);
  }
  const selected: Section[] = args.length > 0 ? (args as Section[]) : [...SECTIONS];
  const runners: Record<Section, () => Promise<boolean>> = { qloo: runQloo, jev: runJev, llm: runLlm };

  log(`# focal.ai — open-question probe (${new Date().toISOString()})`);
  log();
  let ran = 0;
  for (const section of selected) {
    if (await runners[section]()) ran += 1;
  }

  if (ran === 0) {
    console.log("\nNo section ran: add the keys above to .env (repo root) or apps/web/.env.local and re-run.");
    process.exit(2);
  }
  mkdirSync(outputDir, { recursive: true });
  const file = join(outputDir, `unknowns-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, `${report.join("\n")}\n`);
  console.log(`\nReport written to ${file}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
