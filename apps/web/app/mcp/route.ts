import { handleHostedRequest } from "@focal-ai/mcp/hosted";
import { getDb } from "@/lib/server/db";
import { mcpDeps } from "@/lib/server/mcp/deps";
import { mcpUnauthorized, publicOrigin, resolveMcpCaller } from "@/lib/server/mcp/auth";
import { checkRateLimit } from "@/lib/server/rateLimit";

const RATE_LIMIT = { limit: 120, windowMs: 60000 };

async function handle(req: Request): Promise<Response> {
  const db = getDb();
  if (!db) return Response.json({ error: { code: "UNAVAILABLE", message: "accounts are not configured" } }, { status: 503 });
  const caller = await resolveMcpCaller(req, db);
  if (caller === "missing") return mcpUnauthorized(req);
  if (caller === "invalid") return mcpUnauthorized(req, "invalid_token");
  const limit = checkRateLimit(`mcp:${caller.userId}`, RATE_LIMIT);
  if (!limit.ok) {
    return Response.json(
      { error: { code: "RATE_LIMIT", message: "Too many requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }
  return handleHostedRequest(req, mcpDeps(db, caller.userId, caller.client, `${publicOrigin(req)}/profile`), {
    token: "",
    clientId: caller.client,
    scopes: caller.scopes,
    extra: { userId: caller.userId },
  });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
