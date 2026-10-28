import { cacheKey, createTtlCache } from "./cache";
import { QlooError } from "./errors";
import {
  extractAffinity,
  extractResultsArray,
  extractTagsArray,
  isRecord,
  mapEntityList,
  mapScoredEntity,
  mapTagList,
} from "./mapping";
import { createMockQlooClient } from "./mock";
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

export const QLOO_DEFAULT_BASE_URL = "https://hackathon.api.qloo.com";
export const QLOO_DEFAULT_TIMEOUT_MS = 8000;
export const QLOO_DEFAULT_CACHE_TTL_MS = 600000;
export const QLOO_DEFAULT_INSIGHTS_TAKE = 20;

const RETRY_DELAY_MS = 300;
const RATE_LIMIT_RETRY_DELAY_MS = 1000;
const SEARCH_TAKE_MIN = 1;
const SEARCH_TAKE_MAX = 100;
const INSIGHTS_TAKE_MIN = 1;
const INSIGHTS_TAKE_MAX = 50;
const TAGS_TAKE_MIN = 1;
const TAGS_TAKE_MAX = 50;

export function createQlooClient(opts: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  mock?: boolean;
  timeoutMs?: number;
  cacheTtlMs?: number;
} = {}): QlooClient {
  if (opts.mock ?? process.env.QLOO_MOCK === "1") {
    return createMockQlooClient();
  }

  const apiKey = opts.apiKey ?? process.env.QLOO_API_KEY;
  const baseUrl = (opts.baseUrl || process.env.QLOO_API_BASE || QLOO_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? QLOO_DEFAULT_TIMEOUT_MS;
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const cache = createTtlCache(opts.cacheTtlMs ?? QLOO_DEFAULT_CACHE_TTL_MS);

  function requireApiKey(): string {
    if (!apiKey) throw new QlooError("AUTH", "QLOO_API_KEY is not set");
    return apiKey;
  }

  function buildUrl(path: string, query: Record<string, string>): string {
    let url: URL;
    try {
      url = new URL(path, baseUrl);
    } catch (error) {
      throw new QlooError("UPSTREAM", "Qloo base URL is not a valid URL", { cause: error });
    }
    url.search = new URLSearchParams(query).toString();
    return url.toString();
  }

  async function fetchJsonOnce(
    path: string,
    query: Record<string, string>,
    key: string,
  ): Promise<{ payload: unknown; durationMs: number }> {
    const url = buildUrl(path, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers: { "X-Api-Key": key, accept: "application/json" },
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          throw new QlooError("TIMEOUT", `Qloo request to ${path} timed out after ${timeoutMs}ms`, { cause: error });
        }
        throw new QlooError("UPSTREAM", `Qloo request to ${path} failed: ${describeError(error)}`, { cause: error });
      }

      if (!response.ok) throw errorFromResponse(response, path);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          throw new QlooError("TIMEOUT", `Qloo request to ${path} timed out after ${timeoutMs}ms`, { cause: error });
        }
        throw new QlooError("PARSE", `Qloo response from ${path} was not valid JSON`, { cause: error });
      }

      return { payload, durationMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJsonWithRetry(
    path: string,
    query: Record<string, string>,
    key: string,
  ): Promise<{ payload: unknown; durationMs: number }> {
    let retried = false;
    for (;;) {
      try {
        return await fetchJsonOnce(path, query, key);
      } catch (error) {
        const qlooError = toQlooError(error, path);
        const retryDelayMs = retryDelayFor(qlooError);
        if (retryDelayMs === undefined || retried) throw qlooError;
        retried = true;
        await delay(retryDelayMs);
      }
    }
  }

  async function requestCached<T>(
    path: string,
    query: Record<string, string>,
    map: (payload: unknown, durationMs: number) => T,
  ): Promise<T> {
    const key = requireApiKey();
    const cacheId = cacheKey(query);
    const cached = cache.get(cacheId);
    if (cached !== undefined) return cached as T;
    const { payload, durationMs } = await fetchJsonWithRetry(path, query, key);
    const result = map(payload, durationMs);
    cache.set(cacheId, result);
    return result;
  }

  async function search(params: SearchParams): Promise<SearchResult> {
    const query: Record<string, string> = {};
    addParam(query, "query", params.query);
    if (params.types?.length) addParam(query, "types", params.types.join(","));
    addParam(query, "filter.location.query", params.location);
    addParam(query, "take", clampTake(params.take, SEARCH_TAKE_MIN, SEARCH_TAKE_MAX));
    addParam(query, "page", params.page);

    return requestCached("/search", query, (payload, durationMs) => {
      const values = extractResultsArray(payload);
      if (values === undefined) {
        throw new QlooError("PARSE", "Qloo /search response did not contain a results array");
      }
      return { entities: mapEntityList(values), durationMs, raw: payload };
    });
  }

  async function insights(params: InsightsParams): Promise<InsightsResult> {
    const query: Record<string, string> = {};
    addParam(query, "filter.type", params.resultType);
    if (params.signalEntityIds?.length) {
      addParam(query, "signal.interests.entities", params.signalEntityIds.join(","));
    }
    if (params.signalTagIds?.length) {
      addParam(query, "signal.interests.tags", params.signalTagIds.join(","));
    }
    if (params.resultEntityIds?.length) {
      addParam(query, "filter.results.entities", params.resultEntityIds.join(","));
    }
    addParam(query, "filter.location.query", params.locationQuery);
    addParam(query, "bias.trends", params.biasTrends);
    if (params.explainability === true) addParam(query, "feature.explainability", "true");
    addParam(query, "take", clampTake(params.take, INSIGHTS_TAKE_MIN, INSIGHTS_TAKE_MAX) ?? QLOO_DEFAULT_INSIGHTS_TAKE);

    return requestCached("/v2/insights", query, (payload, durationMs) => {
      const values = extractResultsArray(payload);
      if (values === undefined) {
        throw new QlooError("PARSE", "Qloo /v2/insights response did not contain a results.entities array");
      }
      const entities: ScoredEntity[] = [];
      values.forEach((value, rankIndex) => {
        const scored = mapScoredEntity(value, rankIndex);
        if (scored !== undefined) entities.push(scored);
      });
      const result: InsightsResult = { entities, durationMs, raw: payload };
      if (isRecord(payload) && payload["query"] !== undefined) {
        result.aggregateExplainability = payload["query"];
      }
      return result;
    });
  }

  /**
   * Descriptive tags for a taste set — Qloo's "Taste Context". Same endpoint as
   * `insights` but `filter.type=urn:tag`, and the payload puts them under
   * `results.tags` rather than `results.entities`, so it needs its own parser.
   */
  async function tagAffinities(params: {
    signalEntityIds: string[];
    take?: number;
  }): Promise<TagAffinityResult> {
    const query: Record<string, string> = {};
    addParam(query, "filter.type", "urn:tag");
    if (params.signalEntityIds.length > 0) {
      addParam(query, "signal.interests.entities", params.signalEntityIds.join(","));
    }
    addParam(query, "take", clampTake(params.take, INSIGHTS_TAKE_MIN, INSIGHTS_TAKE_MAX) ?? QLOO_DEFAULT_INSIGHTS_TAKE);

    return requestCached("/v2/insights", query, (payload, durationMs) => {
      const values = extractTagsArray(payload);
      if (values === undefined) {
        throw new QlooError("PARSE", "Qloo tag insights response did not contain a results.tags array");
      }
      const tags: TagAffinity[] = [];
      for (const value of values) {
        if (!isRecord(value)) continue;
        const id = typeof value["id"] === "string" ? value["id"] : value["tag_id"];
        const name = value["name"];
        if (typeof id !== "string" || typeof name !== "string") continue;
        const affinity = extractAffinity(value);
        tags.push({ id, name, ...(affinity !== undefined ? { affinity: affinity.value } : {}) });
      }
      return { tags, durationMs, raw: payload };
    });
  }

  async function searchTags(params: { query: string; take?: number }): Promise<TagSearchResult> {
    const query: Record<string, string> = {};
    addParam(query, "filter.query", params.query);
    addParam(query, "take", clampTake(params.take, TAGS_TAKE_MIN, TAGS_TAKE_MAX));

    return requestCached("/v2/tags", query, (payload) => {
      const values = extractTagsArray(payload);
      if (values === undefined) {
        throw new QlooError("PARSE", "Qloo /v2/tags response did not contain a tags array");
      }
      return { tags: mapTagList(values), raw: payload };
    });
  }

  async function getEntities(entityIds: string[]): Promise<{ entities: QlooEntity[]; raw: unknown }> {
    const query: Record<string, string> = {};
    const ids = Array.isArray(entityIds) ? entityIds : [];
    if (ids.length > 0) addParam(query, "entity_ids", ids.join(","));

    return requestCached("/entities", query, (payload) => {
      const values = extractResultsArray(payload);
      if (values === undefined) {
        throw new QlooError("PARSE", "Qloo /entities response did not contain a results array");
      }
      return { entities: mapEntityList(values), raw: payload };
    });
  }

  return { search, insights, tagAffinities, searchTags, getEntities };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry taxonomy: TIMEOUT/UPSTREAM get one short retry; RATE_LIMIT gets one retry
// honoring retryAfterMs (live 429s carry no Retry-After, so default to 1000 ms).
// AUTH/BAD_REQUEST/NOT_FOUND/PARSE are never retried, and each request retries at most once.
function retryDelayFor(error: QlooError): number | undefined {
  if (error.code === "TIMEOUT" || error.code === "UPSTREAM") return RETRY_DELAY_MS;
  if (error.code === "RATE_LIMIT") return error.retryAfterMs ?? RATE_LIMIT_RETRY_DELAY_MS;
  return undefined;
}

function addParam(query: Record<string, string>, key: string, value: string | number | undefined): void {
  if (value === undefined) return;
  query[key] = String(value);
}

function clampTake(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function errorFromResponse(response: Response, path: string): QlooError {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new QlooError("AUTH", `Qloo rejected the API key for ${path} (HTTP ${status})`, { status });
  }
  if (status === 429) {
    return new QlooError("RATE_LIMIT", `Qloo rate limit reached for ${path} (HTTP 429)`, {
      status,
      retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
    });
  }
  if (status === 400 || status === 422) {
    return new QlooError("BAD_REQUEST", `Qloo rejected the request to ${path} (HTTP ${status})`, { status });
  }
  if (status === 404) {
    return new QlooError("NOT_FOUND", `Qloo endpoint ${path} was not found (HTTP 404)`, { status });
  }
  if (status >= 400 && status < 500) {
    return new QlooError("BAD_REQUEST", `Qloo rejected the request to ${path} (HTTP ${status})`, { status });
  }
  return new QlooError("UPSTREAM", `Qloo request to ${path} failed (HTTP ${status})`, { status });
}

function toQlooError(error: unknown, path: string): QlooError {
  if (error instanceof QlooError) return error;
  return new QlooError("UPSTREAM", `Qloo request to ${path} failed: ${describeError(error)}`, { cause: error });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
