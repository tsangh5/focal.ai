import { errorResponse } from "@/lib/server/errors";
import { JevError } from "@/lib/server/jev/client";
import { getIdentifier, IdentifyUnavailableError, selectIdentified } from "@/lib/server/page/identify";
import { deriveLayout } from "@/lib/server/page/layout";
import { identifyBodySchema } from "@/lib/server/page/schemas";
import { resolveSession, unauthorizedResponse } from "@/lib/server/page/session";
import { checkRateLimit } from "@/lib/server/rateLimit";

/** Per-user Jev budget: one call per new layout, so this is generous. */
const RATE_LIMIT = { limit: 30, windowMs: 60000 };

export async function POST(req: Request): Promise<Response> {
  const session = await resolveSession(req);
  if (!session) return unauthorizedResponse();
  const limit = checkRateLimit(`identify:${session.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many identify requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_REQUEST", message: "invalid request body" } }, { status: 400 });
  }
  const parsed = identifyBodySchema.safeParse(payload);
  if (!parsed.success) return errorResponse(parsed.error);
  try {
    const answer = await getIdentifier().identify(parsed.data);
    // The extension keeps the layout and names cards locally next time; it is never stored here.
    const layout = deriveLayout(parsed.data, answer);
    return Response.json({ ...selectIdentified(answer), ...(layout ? { layout } : {}) });
  } catch (e) {
    if (e instanceof IdentifyUnavailableError) {
      return Response.json({ error: { code: "UNAVAILABLE", message: e.message } }, { status: 503 });
    }
    if (e instanceof JevError) {
      return Response.json({ error: { code: "UPSTREAM", message: "identification failed" } }, { status: 502 });
    }
    return errorResponse(e);
  }
}
