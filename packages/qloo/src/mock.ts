import entitiesFixture from "../fixtures/entities.json";
import insightsPlacesFixture from "../fixtures/insights-places.json";
import searchBrandsFixture from "../fixtures/search-brands.json";
import searchFugaziFixture from "../fixtures/search-fugazi.json";
import searchLisbonFixture from "../fixtures/search-lisbon.json";
import searchRintaroFixture from "../fixtures/search-rintaro.json";
import tagsNaturalWineFixture from "../fixtures/tags-natural-wine.json";
import tagsTasteContextFixture from "../fixtures/tags-taste-context.json";
import { extractAffinity, extractResultsArray, extractTagsArray, isRecord, mapEntityList, mapScoredEntity, mapTagList } from "./mapping";
import type {
  InsightsParams,
  InsightsResult,
  QlooClient,
  QlooEntity,
  ScoredEntity,
  SearchParams,
  SearchResult,
  TagAffinity,
  TagAffinityResult,
  TagSearchResult,
} from "./types";

export const QLOO_FIXTURE_MARKER = searchRintaroFixture._fixture;

const MOCK_DELAY_MS = 50;
const DEFAULT_SEARCH_TAKE = 8;

const SEARCH_FIXTURES: unknown[] = [
  searchRintaroFixture,
  searchFugaziFixture,
  entitiesFixture,
  insightsPlacesFixture,
  searchLisbonFixture,
  searchBrandsFixture,
];

// ---------------------------------------------------------------------------
// SYNTHETIC INSIGHT AFFINITIES — MOCK MODE ONLY
//
// The insights fixture below only covers five San Francisco places, which left
// the Studio's Lisbon (Atlas) and brand (Verve) demo pages unresolved in mock
// mode. For requested ids that are missing from the insights fixture but known
// to any other mock fixture, the mock synthesizes a scored entry so the demo
// stays usable end to end.
//
// These affinities are entirely fake: they exist ONLY to make the clearly
// labeled mock demo work, and they never touch live mode (createQlooClient
// returns this client only for QLOO_MOCK=1 or { mock: true }). The derivation
// is a pure FNV-1a hash of the entity id, so repeated calls and test runs are
// stable and deterministic:
//
//   affinity    = round(0.58 + (fnv1a(id) % 37) / 100, 4)        -> 0.58..0.94
//   foundAt     = "query.affinity"
//   rankIndex   = position in the returned entity list
//   contributions, only when fnv1a(id) % 2 === 0 (about half of the ids):
//     [{ entity_id: <Fugazi id>, score: round(0.2 + (fnv1a(id + "c") % 40) / 100, 2) }]
//
// Fixture-backed ids always win: anything present in insights-places.json keeps
// its authored values (Rintaro stays 0.93, House of Prime Rib keeps the
// query.measurements.affinity path, Che Fico stays affinity-less). Requested
// ids that appear in no fixture at all are skipped, exactly as before, so the
// caller keeps seeing "resolved without affinity" for them.
// ---------------------------------------------------------------------------

const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;
const MOCK_SIGNAL_ENTITY_ID = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";

const SYNTHESIS_SOURCE_FIXTURES: unknown[] = [
  searchRintaroFixture,
  searchFugaziFixture,
  searchLisbonFixture,
  searchBrandsFixture,
  entitiesFixture,
];

function fnv1a(value: string): number {
  let hash = FNV1A_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_PRIME) >>> 0;
  }
  return hash;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildInsightSourceIndex(fixtures: unknown[]): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();
  for (const fixture of fixtures) {
    for (const value of extractResultsArray(fixture) ?? []) {
      if (!isRecord(value)) continue;
      const entityId = value["entity_id"];
      if (typeof entityId !== "string" || entityId.length === 0) continue;
      if (!index.has(entityId)) index.set(entityId, value);
    }
  }
  return index;
}

const INSIGHT_ENTITY_SOURCES = buildInsightSourceIndex(SYNTHESIS_SOURCE_FIXTURES);

function synthesizeInsightsEntry(entityId: string, source: Record<string, unknown>): Record<string, unknown> {
  const hash = fnv1a(entityId);
  const query: Record<string, unknown> = { affinity: roundTo(0.58 + (hash % 37) / 100, 4) };
  if (hash % 2 === 0) {
    query["explainability"] = {
      contributions: [
        { entity_id: MOCK_SIGNAL_ENTITY_ID, score: roundTo(0.2 + (fnv1a(`${entityId}c`) % 40) / 100, 2) },
      ],
    };
  }
  return { ...source, query };
}

function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectSearchResults(query: string, take: number): unknown[] {
  const normalizedQuery = normalizeMatchText(query);
  if (normalizedQuery.length === 0) return [];
  const results: unknown[] = [];
  const seen = new Set<string>();
  for (const fixture of SEARCH_FIXTURES) {
    for (const value of extractResultsArray(fixture) ?? []) {
      if (!isRecord(value)) continue;
      const entityId = value["entity_id"];
      const name = value["name"];
      if (typeof entityId !== "string" || entityId.length === 0) continue;
      if (typeof name !== "string") continue;
      if (seen.has(entityId)) continue;
      if (!normalizeMatchText(name).includes(normalizedQuery)) continue;
      seen.add(entityId);
      results.push(value);
      if (results.length >= take) return results;
    }
  }
  return results;
}

function selectEntityIds(values: unknown[], entityIds: string[] | undefined): unknown[] {
  if (entityIds === undefined || entityIds.length === 0) return values;
  return values.filter(
    (value) => isRecord(value) && typeof value["entity_id"] === "string" && entityIds.includes(value["entity_id"]),
  );
}

function selectInsightsValues(resultEntityIds: string[] | undefined): unknown[] {
  const fixtureValues = extractResultsArray(insightsPlacesFixture) ?? [];
  if (resultEntityIds === undefined || resultEntityIds.length === 0) return fixtureValues;

  // Fixture-backed ids come first, in fixture order, with their authored values.
  const values = selectEntityIds(fixtureValues, resultEntityIds);
  const matched = new Set<string>();
  for (const value of values) {
    if (isRecord(value) && typeof value["entity_id"] === "string") matched.add(value["entity_id"]);
  }

  // Remaining requested ids are synthesized in request order when some other
  // fixture knows them; ids no fixture knows are skipped (stay unscored).
  for (const entityId of resultEntityIds) {
    if (matched.has(entityId)) continue;
    const source = INSIGHT_ENTITY_SOURCES.get(entityId);
    if (source === undefined) continue;
    matched.add(entityId);
    values.push(synthesizeInsightsEntry(entityId, source));
  }
  return values;
}

export function createMockQlooClient(): QlooClient {
  async function search(params: SearchParams): Promise<SearchResult> {
    await mockDelay();
    const take = Math.max(1, Math.trunc(params.take ?? DEFAULT_SEARCH_TAKE));
    const payload = {
      _fixture: QLOO_FIXTURE_MARKER,
      success: true,
      results: selectSearchResults(params.query, take),
    };
    return { entities: mapEntityList(payload.results), durationMs: MOCK_DELAY_MS, raw: payload };
  }

  async function insights(params: InsightsParams): Promise<InsightsResult> {
    await mockDelay();
    const values = selectInsightsValues(params.resultEntityIds);
    const entities: ScoredEntity[] = [];
    values.forEach((value, rankIndex) => {
      const scored = mapScoredEntity(value, rankIndex);
      if (scored !== undefined) entities.push(scored);
    });
    const result: InsightsResult = { entities, durationMs: MOCK_DELAY_MS, raw: insightsPlacesFixture };
    if (insightsPlacesFixture.query !== undefined) {
      result.aggregateExplainability = insightsPlacesFixture.query;
    }
    return result;
  }

  async function searchTags(_params: { query: string; take?: number }): Promise<TagSearchResult> {
    await mockDelay();
    const values = extractTagsArray(tagsNaturalWineFixture) ?? [];
    return { tags: mapTagList(values), raw: tagsNaturalWineFixture };
  }

  async function getEntities(entityIds: string[]): Promise<{ entities: QlooEntity[]; raw: unknown }> {
    await mockDelay();
    const ids = Array.isArray(entityIds) ? entityIds : [];
    const values = selectEntityIds(extractResultsArray(entitiesFixture) ?? [], ids);
    return { entities: mapEntityList(values), raw: entitiesFixture };
  }

  /**
   * Labelled fixture tags, so Taste Context renders offline too. Its own
   * fixture rather than the tag-search one: this is a taste *vocabulary*,
   * spanning domains and carrying affinities, and product scoring (§5.11)
   * needs words a garment can actually match. The wine-only search fixture
   * would leave every product grid unscored in mock mode.
   */
  async function tagAffinities(params: {
    signalEntityIds: string[];
    take?: number;
  }): Promise<TagAffinityResult> {
    await mockDelay();
    const values = extractTagsArray(tagsTasteContextFixture) ?? [];
    const tags: TagAffinity[] = [];
    for (const value of values) {
      if (!isRecord(value)) continue;
      const id = value["id"];
      const name = value["name"];
      if (typeof id !== "string" || typeof name !== "string") continue;
      const affinity = extractAffinity(value);
      tags.push({ id, name, ...(affinity !== undefined ? { affinity: affinity.value } : {}) });
    }
    return { tags: tags.slice(0, params.take ?? tags.length), durationMs: 0, raw: tagsTasteContextFixture };
  }

  return { search, insights, tagAffinities, searchTags, getEntities };
}
