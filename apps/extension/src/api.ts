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

/**
 * Where the names sit in one list structure, learned on an identify call and
 * kept only in this browser (§5.3). Structure only, never page text. Mirrors
 * apps/web/lib/server/page/layout.ts.
 */
export interface LearnedLayout {
  /** Structure signature of the list it was learned on. */
  fingerprint: string;
  namePosition: { snippetIndex: number };
  type: InsightType;
  citySource: { hintIndex: number } | null;
}

export interface IdentifyResponse {
  isList: boolean;
  pageType: InsightType | null;
  items: IdentifiedItem[];
  /** Only when the cards agreed enough to be named locally next time. */
  layout?: LearnedLayout;
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
  /** Items matched to a Qloo entity. Older servers leave it out. */
  resolvedCount?: number;
  /** The lookup budget left some items unresolved. */
  resolutionLimited?: boolean;
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

/**
 * What happened on a page focal was allowed to act on. Only reported once the
 * site is enabled and the guards passed — anything earlier is already explained
 * by an eligibility reason.
 */
export type PageOutcome =
  /** Reordered: some cards were lifted. */
  | "lifted"
  /** Ranked, but nothing stood out enough to move. */
  | "nothing-to-lift"
  /** No group of cards on the page looked like a list of things. */
  | "no-list"
  /** A list, but not of things Qloo knows — search results, articles, UI. */
  | "not-a-list"
  /** The profile has nothing that applies to this kind of thing. */
  | "no-signals"
  /** Identify or rank failed. */
  | "error"
  /** Signed out, so there is no profile to rank with. */
  | "signed-out";

export type ContentMessage =
  | { type: "identify"; body: IdentifyRequest }
  | { type: "rank"; body: RankRequest }
  | { type: "feedback"; body: FeedbackRequest }
  /** A null id clears the tab's result: its page or plan is gone. */
  | { type: "page-result"; pageResultId: string | null; lifted: number }
  /** Why this page ended up as it did, so the popup can say so. */
  | { type: "page-outcome"; outcome: PageOutcome }
  | { type: "open-why"; pageResultId: string }
  /** The on-page offer: turn focal on for this host, or decline it. */
  | { type: "enable-site"; host: string; on: boolean }
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
