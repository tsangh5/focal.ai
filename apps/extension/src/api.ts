import type { CardSnapshot, RenderPlan } from "./types";

/**
 * Qloo's 10 insight types, short form (core `urn:entity:<type>`), plus
 * `product`. A product is not a Qloo entity — it is scored from style facets
 * instead of resolved (§5.11) — but it travels the same wire.
 */
export type InsightType =
  | "place" | "destination" | "movie" | "tv_show" | "book"
  | "artist" | "brand" | "podcast" | "videogame" | "person"
  | "product";

/** Sent only for a new layout: card snippets, never full HTML (§6). */
export interface IdentifyRequest {
  host: string;
  pathPattern: string;
  signature: string;
  cityHints: string[];
  cards: CardSnapshot[];
}

export interface IdentifiedItem {
  clientId: string;
  name: string;
  type: InsightType;
  city?: string;
}

export interface IdentifyResponse {
  isList: boolean;
  pageType: InsightType | null;
  items: IdentifiedItem[];
}

/** Known layouts send only names, type and city (§6). */
export interface RankRequest {
  host: string;
  pathPattern: string;
  pageType: InsightType;
  items: IdentifiedItem[];
}

export interface RankResponse {
  pageResultId: string | null;
  status: "ranked" | "no_signals" | "nothing_scored";
  plan: RenderPlan | null;
}

export type Verdict = "more" | "less";

/** "More like this" / "Not for me" on a lifted card (§5.8). */
export interface FeedbackRequest {
  pageResultId: string;
  clientId: string;
  verdict: Verdict;
}

export interface FeedbackResponse {
  saved: boolean;
  name?: string;
  strength?: string;
}

export type ContentMessage =
  | { type: "identify"; body: IdentifyRequest }
  | { type: "rank"; body: RankRequest }
  | { type: "feedback"; body: FeedbackRequest }
  | { type: "page-result"; pageResultId: string; lifted: number }
  | { type: "open-why"; pageResultId: string }
  | { type: "sync-settings" };

export type BackgroundReply<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/** Messages the focal website may send through externally_connectable. */
export type ExternalMessage =
  | { type: "focal:session"; token: string; email?: string }
  | { type: "focal:signout" }
  | { type: "focal:settings"; settings: unknown }
  | { type: "focal:ping" };

/**
 * Path with ids generalised so layouts can be shared without leaking
 * specifics: numeric or id-like segments become `:id`; query is dropped.
 */
export function pathPattern(pathname: string): string {
  const parts = pathname.split("/").map((seg) => {
    if (!seg) return seg;
    if (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || (/\d/.test(seg) && seg.length > 12)) return ":id";
    return seg.toLowerCase();
  });
  return parts.join("/") || "/";
}
