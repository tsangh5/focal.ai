import type { UsageKind } from "@focal-ai/db";
import { getDb } from "./db";

/**
 * Free-tier metering for the two things that cost the project money: Jev
 * identification behind a page rank, and the hosted model behind chat.
 *
 * A visitor gets a fixed allowance on the project's keys, then has to bring
 * their own. Callers who supply a key are never metered and never blocked —
 * they are spending their own quota, not ours.
 *
 * Counted separately on purpose: a ranked page and a chat message are
 * different units at different prices, so one shared number would either
 * starve chat or give away too many ranks.
 */
export const FREE_ALLOWANCE: Record<UsageKind, number> = {
  rank: 25,
  chat: 25,
};

export interface QuotaVerdict {
  /** False when the allowance is spent and no key was supplied. */
  allowed: boolean;
  used: number;
  limit: number;
  /** True when the caller brought a key, so nothing was metered. */
  ownKey: boolean;
}

/** A key supplied per request. Never stored: it is used for that call only. */
export function callerKey(req: Request, header: string): string | undefined {
  const raw = req.headers.get(header)?.trim();
  // Guard against a header that is present but empty, or implausibly long.
  return raw && raw.length >= 8 && raw.length <= 400 ? raw : undefined;
}

/**
 * Checks the allowance without spending it. Call `spend` only once the work
 * actually happened, so a failed upstream call is not charged to the user.
 */
export async function checkQuota(userId: string, kind: UsageKind, ownKey: boolean): Promise<QuotaVerdict> {
  const limit = FREE_ALLOWANCE[kind];
  if (ownKey) return { allowed: true, used: 0, limit, ownKey: true };
  const db = getDb();
  // Without a database there is nothing to meter against; the dev session and
  // local runs are not the case this protects.
  if (!db) return { allowed: true, used: 0, limit, ownKey: false };
  try {
    const used = await db.usage.get(userId, kind);
    return { allowed: used < limit, used, limit, ownKey: false };
  } catch {
    // The counters table may not exist yet (migration 0003 unapplied). Failing
    // open keeps ranking and chat working; failing closed would take the whole
    // product down to enforce a free tier.
    return { allowed: true, used: 0, limit, ownKey: false };
  }
}

export async function spendQuota(userId: string, kind: UsageKind, ownKey: boolean): Promise<void> {
  if (ownKey) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.usage.bump(userId, kind);
  } catch {
    // Same as above: an unmetered request beats a failed one.
  }
}

export function quotaExceeded(kind: UsageKind, verdict: QuotaVerdict): Response {
  const what = kind === "rank" ? "ranked pages" : "chat messages";
  return Response.json(
    {
      error: {
        code: "QUOTA_EXCEEDED",
        message: `You have used your ${verdict.limit} free ${what}. Add your own API key to keep going.`,
        kind,
        used: verdict.used,
        limit: verdict.limit,
      },
    },
    { status: 402 },
  );
}
