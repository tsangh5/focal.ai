import { PagePipelineError } from "@focal-ai/core";
import { errorResponse } from "@/lib/server/errors";
import { rankPage } from "@/lib/server/page/rank";
import { pageRankBodySchema } from "@/lib/server/page/schemas";
import { resolveSession, unauthorizedResponse } from "@/lib/server/page/session";
import { getPageResultStore } from "@/lib/server/page/store";
import { checkRateLimit } from "@/lib/server/rateLimit";

const RATE_LIMIT = { limit: 60, windowMs: 60000 };

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const session = await resolveSession(req);
  if (!session) return unauthorizedResponse();
  const limit = checkRateLimit(`rank:${session.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many rank requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = pageRankBodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);

  const pageResultId = crypto.randomUUID();
  try {
    const result = await rankPage(parsed.data, session.profile, pageResultId);
    await getPageResultStore().save({
      id: pageResultId,
      userId: session.userId,
      hostname: parsed.data.host,
      status: result.status,
      items: result.items,
      plan: result.plan,
      meta: { ...result.meta, pageType: parsed.data.pageType, signals: result.signals, stats: result.stats, durationMs: Date.now() - startedAt },
    });
    return Response.json({ pageResultId, status: result.status, plan: result.plan });
  } catch (e) {
    if (e instanceof PagePipelineError) {
      return Response.json({ error: { code: e.code, message: "could not build a valid plan" } }, { status: 500 });
    }
    return errorResponse(e);
  }
}
