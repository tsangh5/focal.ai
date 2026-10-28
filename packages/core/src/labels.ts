/**
 * Lift labels (spec §5.6, decision 24): page-relative words with the reason
 * first, e.g. "Top pick for you · because you like Fugazi and Rintaro".
 *
 * The reason names only liked things from the profile that Qloo's
 * explainability credits (score >= 0.1, top 2). With nothing grounded the
 * label is just the badge words; no reason text is ever invented. Exact
 * affinity never appears in a label.
 */
import type { LiftBadge } from "./lift";
import type { ProfileV2, ThingEntry } from "./taste";

const MIN_CONTRIBUTION_SCORE = 0.1;
const MAX_REASONS = 2;
const MAX_NAME_LENGTH = 40;
export const MAX_LABEL_LENGTH = 140;

export const BADGE_TEXT: Record<LiftBadge, string> = {
  "top-pick": "Top pick for you",
  "good-match": "Good match",
  favourite: "You like this",
};

/** Favourites say so directly; "because you like X" would be circular. */
const FAVOURITE_TEXT: Record<"love" | "like", string> = {
  love: "You love this",
  like: "You like this",
};

export interface LiftLabel {
  badge: LiftBadge;
  text: string;
  reasonNames: string[];
}

function shorten(name: string): string {
  const clean = name.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return clean.length <= MAX_NAME_LENGTH ? clean : `${clean.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
}

export function groundedReasonNames(
  contributions: { entityId: string; score: number }[] | undefined,
  profile: ProfileV2,
): string[] {
  const liked = new Map<string, ThingEntry>();
  for (const e of profile.entries) {
    if (e.kind === "thing" && e.strength !== "dislike") liked.set(e.qlooId, e);
  }
  const names: string[] = [];
  for (const c of [...(contributions ?? [])].sort((a, b) => b.score - a.score)) {
    if (names.length >= MAX_REASONS) break;
    if (c.score < MIN_CONTRIBUTION_SCORE) continue;
    const thing = liked.get(c.entityId);
    if (thing && !names.includes(thing.name)) names.push(thing.name);
  }
  return names;
}

export function buildLiftLabel(
  badge: LiftBadge,
  contributions: { entityId: string; score: number }[] | undefined,
  profile: ProfileV2,
  favourite?: "love" | "like",
): LiftLabel {
  if (badge === "favourite") {
    return { badge, text: FAVOURITE_TEXT[favourite ?? "like"], reasonNames: [] };
  }
  const reasonNames = groundedReasonNames(contributions, profile);
  const words = BADGE_TEXT[badge];
  if (reasonNames.length === 0) return { badge, text: words, reasonNames };
  const because = reasonNames.map(shorten).join(" and ");
  const text = `${words} · because you like ${because}`;
  return { badge, text: text.length <= MAX_LABEL_LENGTH ? text : words, reasonNames };
}
