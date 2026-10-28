import {
  favouriteThings,
  runPageRank as runCorePageRank,
  runProductRank,
  type DescribedProduct,
  type PageInsightsFn,
  type PageItem,
  type PageRankResult,
  type ProfileV2,
  type TasteTag,
} from "@focal-ai/core";
import type { QlooEntityType } from "@focal-ai/qloo";
import { toCandidateScores, toCoreSearchFn } from "../adapters";
import { buildInsightsParams } from "../pipeline";
import { getQlooClient } from "../qloo";
import { cachedResolutionResolver, getResolutionStore } from "../resolution/cache";
import { getDescriber } from "./identify";
import { isEntityShortType, toInsightType, type PageRankBody } from "./schemas";

const RESOLVE_SEARCH_TAKE = 3;
/** Taste vocabulary breadth for product scoring; matches /api/taste-context. */
const TASTE_TAG_TAKE = 18;

function pageInsights(): PageInsightsFn {
  const client = getQlooClient();
  return async (args) => {
    const query = {
      resultType: args.resultType,
      signalEntityIds: args.entitySignals.map((s) => s.id),
      signalTagIds: args.tagSignals.map((s) => s.id),
      resultEntityIds: args.resultEntityIds,
      locationQuery: args.locationQuery,
      explainability: args.explainability,
      take: args.take,
    };
    const result = await client.insights({ ...query, resultType: args.resultType as QlooEntityType });
    return { scores: toCandidateScores(result.entities), request: { path: "/v2/insights", params: buildInsightsParams(query) } };
  };
}

/** The extension names cards `c<n>` in page order, so gaps from unidentified cards keep true positions. */
function pagePosition(clientId: string): number | undefined {
  const m = /^c(\d{1,4})$/.exec(clientId);
  return m ? Number(m[1]) : undefined;
}

function mostCommonCity(body: PageRankBody): string | undefined {
  const counts = new Map<string, number>();
  for (const item of body.items) if (item.city) counts.set(item.city, (counts.get(item.city) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Product grids (§5.11). Two reads, neither of them an insights call: the
 * profile's taste vocabulary from Qloo, and the style facets of each product
 * name. The Qloo client caches `/v2/insights` responses for 10 minutes and the
 * signal set is the whole profile, so the tag call is made once per profile
 * and reused across every product page the user opens in that window.
 */
async function rankProductPage(body: PageRankBody, profile: ProfileV2, pageId: string): Promise<PageRankResult> {
  const signalIds = favouriteThings(profile).map((t) => t.qlooId);

  let tasteTags: TasteTag[] = [];
  if (signalIds.length > 0) {
    const res = await getQlooClient().tagAffinities({ signalEntityIds: signalIds, take: TASTE_TAG_TAKE });
    tasteTags = res.tags.map((t) => ({
      id: t.id,
      name: t.name,
      ...(t.affinity !== undefined ? { affinity: t.affinity } : {}),
    }));
  }

  const descriptors = await getDescriber().describe(body.items.map((i) => i.name));
  const items: DescribedProduct[] = body.items.map((item, i) => ({
    clientId: item.clientId,
    name: item.name,
    originalIndex: pagePosition(item.clientId) ?? i,
    descriptor: descriptors[i] ?? {},
  }));

  return runProductRank({ pageId, items, tasteTags, profile });
}

/** Server side of the extension's rank request: one insights call, lift-only plan. */
export async function rankPage(body: PageRankBody, profile: ProfileV2, pageId: string, opts: { callerKey: string }): Promise<PageRankResult & { resolutionLimited: boolean }> {
  // Product grids never resolve a name, so the resolution cache cannot limit them.
  if (!isEntityShortType(body.pageType)) {
    return { ...(await rankProductPage(body, profile, pageId)), resolutionLimited: false };
  }
  const pageType = toInsightType(body.pageType);
  const items: PageItem[] = body.items.map((item, i) => {
    const located = item.type === "place" || item.type === "destination";
    return {
      clientId: item.clientId,
      name: item.name,
      originalIndex: pagePosition(item.clientId) ?? i,
      type: isEntityShortType(item.type) ? toInsightType(item.type) : "product",
      ...(item.city && located ? { city: item.city } : {}),
    };
  });
  const locationQuery = body.pageType === "place" || body.pageType === "destination" ? mostCommonCity(body) : undefined;
  // Per-request flag — set by the cached resolver's onLimited, never module state.
  let resolutionLimited = false;
  const result = await runCorePageRank({
    pageId,
    pageType,
    items,
    profile,
    ...(locationQuery ? { locationQuery } : {}),
    deps: {
      search: toCoreSearchFn(getQlooClient(), RESOLVE_SEARCH_TAKE),
      insights: pageInsights(),
      resolve: cachedResolutionResolver(getResolutionStore(), opts.callerKey, () => { resolutionLimited = true; }),
    },
  });
  return { ...result, resolutionLimited };
}
