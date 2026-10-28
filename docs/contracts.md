# Locked interfaces (source of truth for parallel implementation)

These names and shapes are frozen. Implementation agents must code against them exactly. Any change requires **editing this file first**, then the code — never the reverse. If an implementation cannot satisfy a contract, stop and raise it; do not silently deviate.

Packages: `@focal-ai/qloo` (Qloo HTTP client, no React/Next deps), `@focal-ai/core` (pure taste/render engine), `@focal-ai/web` (`apps/web` — the only adapter between the two packages), `@focal-ai/mcp` (stdio MCP server: read tools + `create_render_plan`).

## A. `@focal-ai/qloo` — Qloo HTTP client

Only this package talks to Qloo. It owns auth, parsing, error taxonomy, timeout/retry, and the TTL cache. `raw` fields carry the unmodified upstream payload so the inspector can show request/response pairs. Nothing in this package interprets taste — that is `@focal-ai/core`'s job.

```ts
export type QlooEntityType =
  | "urn:entity:artist" | "urn:entity:book" | "urn:entity:brand"
  | "urn:entity:destination" | "urn:entity:movie" | "urn:entity:person"
  | "urn:entity:place" | "urn:entity:podcast" | "urn:entity:tv_show" | "urn:entity:videogame";

export interface QlooEntity {
  entityId: string;
  name: string;
  subtype: string;
  disambiguation?: string;
  popularity?: number;
  tagIds: string[];
  tagNames: string[];
  properties?: Record<string, unknown>;
  raw: unknown;
}

export interface SearchParams { query: string; types?: QlooEntityType[]; location?: string; take?: number; page?: number; }
export interface SearchResult { entities: QlooEntity[]; durationMs: number; raw: unknown; }

export interface InsightsParams {
  resultType: QlooEntityType;
  signalEntityIds: string[];
  resultEntityIds?: string[];
  locationQuery?: string;
  explainability?: boolean;
  take?: number;
}
export interface ScoreContribution { entityId: string; score: number; }
export interface ScoredEntity {
  entity: QlooEntity;
  affinity?: number;
  affinityFoundAt?: string;
  rankIndex: number;
  contributions?: ScoreContribution[];
  explainabilityRaw?: unknown;
}
export interface InsightsResult { entities: ScoredEntity[]; aggregateExplainability?: unknown; durationMs: number; raw: unknown; }
export interface TagSearchResult { tags: { id: string; name: string; subtype?: string }[]; raw: unknown; }
export type DataSource = "live" | "mock";

export interface QlooClient {
  search(params: SearchParams): Promise<SearchResult>;
  insights(params: InsightsParams): Promise<InsightsResult>;
  searchTags(params: { query: string; take?: number }): Promise<TagSearchResult>;
  getEntities(entityIds: string[]): Promise<{ entities: QlooEntity[]; raw: unknown }>;
}

export declare function createQlooClient(opts: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  mock?: boolean;
  timeoutMs?: number;
  cacheTtlMs?: number;
}): QlooClient;

export type QlooErrorCode = "AUTH" | "RATE_LIMIT" | "BAD_REQUEST" | "NOT_FOUND" | "UPSTREAM" | "TIMEOUT" | "PARSE";
export declare class QlooError extends Error {
  code: QlooErrorCode;
  status?: number;
  retryAfterMs?: number;
}
```

Defaults and behavior (all overridable via `createQlooClient` opts):

| Setting | Default | Notes |
| --- | --- | --- |
| `baseUrl` | `process.env.QLOO_API_BASE ?? "https://hackathon.api.qloo.com"` | Auth header `X-Api-Key`; hackathon keys work ONLY against this host. 401 confirmed without key. |
| `mock` | `process.env.QLOO_MOCK === "1"` | Mock fixtures must be loudly labeled (`_fixture: "mock"`), derived from public Qloo doc examples, never presented as live data. |
| `timeoutMs` | `8000` | On timeout: exactly 1 retry, then `QlooError` code `TIMEOUT`. |
| `cacheTtlMs` | `600000` (10 min) | In-process TTL cache keyed by full request URL (key excluded). |

Endpoints used — and only these: `GET /search`, `GET /v2/insights`, `GET /v2/tags?filter.query=...`, `GET /v2/entities`. `/recs` and `/recommendations` are unsupported legacy; never call them.

Insights parameter mapping: `resultType` → `filter.type` (required, e.g. `urn:entity:place` / `brand` / `destination` / `artist` / `movie`); `signalEntityIds` → `signal.interests.entities` (comma-separated taste seed IDs, cross-domain explicitly supported); `resultEntityIds` → `filter.results.entities` (comma-separated candidate IDs to score/rank — this is the scoring primitive); `locationQuery` → `filter.location.query` (city); `explainability` → `feature.explainability=true`; `take` max 50, default 20; `page` for pagination.

Affinity extraction must be defensive: try `entity.query.affinity`, then `entity.query.measurements.affinity`, and record which path succeeded in `affinityFoundAt`. Unknown shapes must never throw — return the entity with `affinity: undefined`. The exact path/scale is verified in ticket T-01 and recorded in [qloo-contract.md](./qloo-contract.md).

Error taxonomy: `AUTH` (401/403), `RATE_LIMIT` (429, populate `retryAfterMs` from `Retry-After` when present), `BAD_REQUEST` (400/422), `NOT_FOUND` (404), `UPSTREAM` (5xx), `TIMEOUT`, `PARSE` (shape mismatch on a 2xx).

## B. `@focal-ai/core` — pure engine

Standalone and framework-free: it imports **nothing** from `@focal-ai/qloo` (web and MCP adapt between the two). All functions are pure/deterministic except `resolveCandidates`, which takes an injected `CoreSearchFn` — the seam where `apps/web` wraps `QlooClient.search`.

```ts
export interface CoreEntity { entityId: string; name: string; subtype: string; disambiguation?: string; popularity?: number; tagIds?: string[]; tagNames?: string[]; }
export type CoreSearchFn = (args: { query: string; types?: string[]; location?: string }) => Promise<CoreEntity[]>;

export interface TasteSeed { entityId: string; name: string; subtype: string; disambiguation?: string; polarity: "like" | "dislike"; weight: number; source: "typed" | "searched" | "agent"; addedAt: string; }
export interface ProfileRule { kind: "exclude" | "collapse" | "boost"; match: { tagId?: string; brandId?: string; flag?: "sponsored" }; weight?: number; }
export interface TasteProfile { version: 1; updatedAt: string; seeds: TasteSeed[]; rules: ProfileRule[]; }
export declare const PROFILE_STORAGE_KEY = "focal.profile.v1";
export declare function createEmptyProfile(): TasteProfile;
export declare function addSeed(p: TasteProfile, seed: TasteSeed): TasteProfile;
export declare function removeSeed(p: TasteProfile, entityId: string): TasteProfile;
export declare function serializeProfile(p: TasteProfile): string;
export declare function deserializeProfile(json: string): TasteProfile;

export interface PageCandidate { clientId: string; name: string; locationText?: string; url?: string; originalIndex: number; sponsored?: boolean; }
export type ResolutionStatus = "resolved" | "ambiguous" | "unresolved";
export interface ResolvedCandidate extends PageCandidate { status: ResolutionStatus; entity?: CoreEntity; }
export declare function resolveCandidates(candidates: PageCandidate[], search: CoreSearchFn, expectedType: string, defaults?: { location?: string }): Promise<ResolvedCandidate[]>;

export interface CandidateScore { entityId: string; affinity?: number; rankIndex: number; contributions?: { entityId: string; score: number }[]; tagNames?: string[]; }
export interface RankedCandidate extends ResolvedCandidate {
  position: number;
  affinity?: number;
  affinityPct?: number;
  scoreMeta?: { contributions?: { entityId: string; score: number }[]; tagNames?: string[] };
  reason?: { text: string; contributions?: { name: string; score: number }[]; tags?: string[] };
  ruleEffects?: { kind: ProfileRule["kind"]; label: string }[];
}
export declare function rankCandidates(args: { candidates: ResolvedCandidate[]; scores: CandidateScore[]; profile: TasteProfile }): RankedCandidate[];

export type RenderOp =
  | { op: "reorder"; containerId: string; order: string[] }
  | { op: "collapse"; containerId: string; clientIds: string[]; label: string }
  | { op: "annotate"; containerId: string; clientId: string; text: string }
  | { op: "emphasize"; containerId: string; clientId: string; level: "high" }
  | { op: "hide"; containerId: string; clientIds: string[]; label: string };
export interface RenderPlan { id: string; pageId: string; createdAt: string; ops: RenderOp[]; summary: { moved: number; collapsed: number; unresolved: number; avgMovement: number }; }
export declare function planRender(args: { pageId: string; ranked: RankedCandidate[]; options?: { annotate?: boolean; emphasizeThreshold?: number; collapseSponsored?: boolean; containerId?: string } }): RenderPlan;
export declare function validatePlan(plan: RenderPlan): { ok: true } | { ok: false; errors: string[] };
export declare function buildReason(ranked: RankedCandidate, profile: TasteProfile): RankedCandidate["reason"];
```

Invariants (each enforced by tests):

- Ranker orders by affinity descending. Unresolved candidates sink to the end and keep their original relative order. Ties break on `originalIndex` (stable sort). A missing affinity never produces a favorable score.
- Annotate text must be plain text, at most 140 characters, and must **reject** any string containing `<` (XSS guard). `validatePlan` enforces this plus op referential integrity (every `clientId`/`order` entry exists) and container-id shape.
- `containerId` must match `/^focal:[a-z0-9-]+$/i`.
- Explanations (`buildReason`, `contributions`, `tags`) may cite ONLY contributions/tags/entities actually present in the data handed to them. Never invent relationships, brands, or scores.
- Profile persists in browser `localStorage` under `focal.profile.v1` (`PROFILE_STORAGE_KEY`). Server-side profile persistence is forbidden — the profile travels per request and is discarded.

## C. HTTP API — `apps/web`

Next.js route handlers are the only HTTP surface. The Qloo key lives in server env and never reaches the client.

```text
GET  /api/health   → { ok: true, hasQlooKey: boolean, dataSource: "live" | "mock" }
POST /api/qloo/search  body { query: string, types?: QlooEntityType[], location?: string }
                       → { entities: QlooEntity[], meta: { dataSource: DataSource, durationMs: number } }
POST /api/qloo/rank    body { pageType: QlooEntityType, locationQuery?: string, candidates: PageCandidate[], profile: TasteProfile }
                       → { ranked: RankedCandidate[], plan: RenderPlan, meta: { dataSource: DataSource, durationMs: number, unresolved: number, qlooRequest: { path: string, params: Record<string, string> } } }
POST /api/agent        (P1, contract TBD in ticket T-19)
```

Data-flow rules (non-negotiable):

- Only these leave the browser: entity name strings, city strings, Qloo entity IDs, and the taste profile. The server never receives page HTML, DOM dumps, or form values.
- The profile travels with each request (`/api/qloo/rank`, `/api/agent`) and is never persisted server-side — no database, no profile contents in logs.
- `dataSource: "mock"` is reachable ONLY when `QLOO_MOCK=1`, and the UI must badge mock data loudly anywhere it appears.
- `meta.qlooRequest` records the upstream path + query params (key excluded) so the inspector can show exactly what was asked of Qloo.
- Invalid bodies are rejected with zod (400) before any upstream call.

## D. Mock vs live honesty + affinity conventions

- Affinity is `0..1` as returned by Qloo. Display it as `round(affinity*1000)/10` percent and always label it "Qloo affinity".
- `popularity` is a `0..1` percentile. It is NEVER summed with, substituted for, or blended into affinity.
- Missing affinity → the candidate is treated as unresolved for ranking purposes, never silently given a favorable score.
- No fabricated scores or relationships anywhere — in code, fixtures, tests, copy, or demo data.
- Mock fixtures are env-gated (`QLOO_MOCK=1`), carry `_fixture: "mock"`, derive from public Qloo documentation examples (for example the Balthazar place id `FCE8B172-4795-43E4-B222-3B550DC05FD9` from Qloo's public recipe), and are labeled in every UI surface that can render them.
- LLM (Anthropic) features are OPTIONAL. Without `ANTHROPIC_API_KEY`, agent/narration features run degraded (deterministic explanations from real data) or are disabled with an honest message; nothing else may break.

## B-appendix. Rank pipeline (added 2026-10-18)

Orchestration seam extracted from `apps/web` so every surface runs the same logic: seeds → resolve → one insights call → rank → plan. Search and insights are injected functions; `@focal-ai/core` still imports nothing from `@focal-ai/qloo`.

```ts
export interface PipelineSearchFn { (args: { query: string; types?: string[]; location?: string }): Promise<CoreEntity[]>; }
export interface PipelineInsightsFn { (args: { resultType: string; signalEntityIds: string[]; resultEntityIds?: string[]; locationQuery?: string; explainability?: boolean; take?: number }): Promise<{ scores: CandidateScore[]; request?: { path: string; params: Record<string, string> } }>; }
export interface RankPipelineArgs { pageId: string; pageType: string; locationQuery?: string; containerId?: string; candidates: PageCandidate[]; profile: TasteProfile; deps: { search: PipelineSearchFn; insights: PipelineInsightsFn }; planOptions?: { annotate?: boolean; emphasizeThreshold?: number; collapseSponsored?: boolean }; }
export interface RankPipelineResult { ranked: RankedCandidate[]; plan: RenderPlan; meta: { unresolved: number; insightsCalls: number; qlooRequest?: { path: string; params: Record<string, string> } }; }
export declare class PipelineError extends Error { code: "NO_SEEDS" | "PLAN_INVALID"; }
export declare function runRankPipeline(args: RankPipelineArgs): Promise<RankPipelineResult>;
```

Web `/api/qloo/rank` and the MCP `score_candidates` tool both call `runRankPipeline`; adapters (search/insights injection, request building, error mapping) live at the edges.

## B-appendix 2. Product scoring (added 2026-10-28)

Product grids have no Qloo entity to resolve to, so they take a separate path (spec §5.11): no `resolveCandidates`, no insights call. The caller supplies the profile's weighted tag vocabulary (one `tagAffinities` call, made and cached in `apps/web`), and `@focal-ai/core` joins it to product descriptors with a hand-written synonym table. Still pure and still Qloo-free.

```ts
export type StyleFacet = "style" | "palette" | "formality";
export declare const STYLE_FACETS: readonly StyleFacet[];
export interface FacetValue { id: string; name: string; synonyms: string[]; keywords: string[]; }
export declare const FACET_VALUES: Record<StyleFacet, FacetValue[]>;
export type ProductDescriptor = Partial<Record<StyleFacet, string>>;
export declare function facetValue(facet: StyleFacet, id: string): FacetValue | undefined;
export declare function facetCriteria(facet: StyleFacet): Record<string, string>;
export declare function facetMatchesTag(value: FacetValue, tagName: string): boolean;
export declare function describeFromName(name: string): ProductDescriptor;

export interface TasteTag { id: string; name: string; affinity?: number; }
export interface DescribedProduct { clientId: string; name: string; originalIndex: number; descriptor: ProductDescriptor; }
export interface FacetMatch { facet: StyleFacet; valueId: string; valueName: string; tagId: string; tagName: string; affinity: number; }
export interface ProductScore { clientId: string; score: number; matches: FacetMatch[]; tagIds: string[]; }
export declare function scoreProduct(descriptor: ProductDescriptor, tasteTags: TasteTag[]): Omit<ProductScore, "clientId">;
export declare function scoreProducts(products: DescribedProduct[], tasteTags: TasteTag[]): ProductScore[];

export interface ProductRankArgs { pageId: string; items: DescribedProduct[]; tasteTags: TasteTag[]; profile: ProfileV2; containerId?: string; liftOptions?: LiftOptions; }
export declare function runProductRank(args: ProductRankArgs): PageRankResult;
```

Invariants (each enforced by tests):

- Each facet contributes **at most once**, whatever the wording of the matched tag, so a verbose product title cannot inflate a score. `score = Σ affinity` over at most three facets.
- A tag Qloo returned with no affinity is never matched: an unscored match must not read as a zero-strength one.
- A product matching nothing scores `0`, not `undefined` — it stays in the page mean, because the gap between matching and non-matching products is the signal.
- Synonyms match on whole words (with a short suffix allowance, so `minimal` reaches `Minimalism`). `art` must never match `Smart`.
- The score is meaningless across pages. `runProductRank` always hands it to `decideLift` for within-page z-scoring and never compares it to a Qloo affinity.
- Matched facets carry the real Qloo tag URN, so hard rules and disliked vibes apply through the existing tag machinery with no product-specific code.
- When no product on the page matches anything, the result is `nothing_scored` with a `null` plan — never `ranked` with an empty one.
