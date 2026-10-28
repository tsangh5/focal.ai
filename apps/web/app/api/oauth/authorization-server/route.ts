import { connection } from "next/server";
import { authkitIssuer } from "@/lib/server/mcp/auth";

function unavailable(): Response {
  return Response.json({ error: { code: "UPSTREAM", message: "authorization server unavailable" } }, { status: 502 });
}

/** Mirrors AuthKit's metadata for MCP clients that look it up on the resource's origin. */
export async function GET(): Promise<Response> {
  // Fetch AuthKit's metadata at request time, not once at build.
  await connection();
  const issuer = authkitIssuer();
  if (!issuer) return Response.json({ error: { code: "NOT_FOUND", message: "OAuth is not configured" } }, { status: 404 });
  try {
    const upstream = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) return unavailable();
    return Response.json(await upstream.json(), { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch {
    // Network errors, timeouts and non-JSON bodies all mean the same thing to an MCP client.
    return unavailable();
  }
}
