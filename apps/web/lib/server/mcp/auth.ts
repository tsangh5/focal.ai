import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Db } from "@focal-ai/db";
import { ensureUser } from "../auth/users";

/** OAuth access tokens are JWTs, longer than the extension's session tokens. */
function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S{1,4096})$/i.exec(req.headers.get("authorization") ?? "");
  return m?.[1] ?? null;
}

/** AuthKit is the OAuth authorization server for the hosted MCP endpoint. */
export function authkitIssuer(): string | null {
  const raw = process.env.WORKOS_AUTHKIT_DOMAIN?.trim();
  if (!raw) return null;
  return (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, "");
}

/** Public origin of this deployment, honouring the proxy's forwarded headers. */
export function publicOrigin(req: Request): string {
  const configured = process.env.FOCAL_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const mcpResourceUrl = (req: Request) => `${publicOrigin(req)}/mcp`;
export const protectedResourceMetadataUrl = (req: Request) => `${publicOrigin(req)}/.well-known/oauth-protected-resource/mcp`;

export function protectedResourceMetadata(req: Request) {
  const issuer = authkitIssuer();
  return {
    resource: mcpResourceUrl(req),
    authorization_servers: issuer ? [issuer] : [],
    bearer_methods_supported: ["header"],
    resource_name: "focal",
    resource_documentation: `${publicOrigin(req)}/connect`,
  };
}

/** 401 that points MCP clients at the OAuth discovery document (RFC 9728). */
export function mcpUnauthorized(req: Request, error?: "invalid_token"): Response {
  const params = [`resource_metadata="${protectedResourceMetadataUrl(req)}"`];
  if (error) params.unshift(`error="${error}"`);
  return Response.json(
    { error: { code: "UNAUTHORIZED", message: "Sign in to focal to use this server." } },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${params.join(", ")}` } },
  );
}

/** 503 when the token can't be checked right now, so clients retry with it instead of discarding it. */
export function mcpUnavailable(): Response {
  return Response.json(
    { error: { code: "UNAVAILABLE", message: "Sign-in is unavailable right now. Try again shortly." } },
    { status: 503, headers: { "Retry-After": "30" } },
  );
}

/**
 * jose `error.code`s that mean the token itself is bad (401). Codes, not class
 * names, because names don't survive minification. Anything else (a JWKS
 * fetch error, ERR_JWKS_TIMEOUT, the identity provider being down) is transient.
 */
const TOKEN_INVALID_CODES = new Set([
  "ERR_JWT_EXPIRED",
  "ERR_JWT_INVALID",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWS_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JOSE_NOT_SUPPORTED",
]);

let jwks: { issuer: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;
function jwksFor(issuer: string) {
  if (jwks?.issuer !== issuer) jwks = { issuer, set: createRemoteJWKSet(new URL(`${issuer}/oauth2/jwks`)) };
  return jwks.set;
}

/** Audiences a focal MCP token may carry: the MCP resource, or the focal app when no resource indicator is set up. */
function allowedAudiences(req: Request): string[] {
  const extra = (process.env.MCP_ALLOWED_AUDIENCES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [mcpResourceUrl(req), process.env.WORKOS_CLIENT_ID ?? "", ...extra].filter(Boolean);
}

/**
 * The token's claims, or null when the token is invalid. Throws when it can't
 * be checked (JWKS unreachable, timeout, identity provider down) so the route
 * answers 503 rather than telling the client to throw a good token away.
 */
export async function verifyAccessToken(req: Request, token: string): Promise<JWTPayload | null> {
  const issuer = authkitIssuer();
  if (!issuer) return null;
  try {
    const { payload } = await jwtVerify(token, jwksFor(issuer), { issuer });
    const aud = typeof payload.aud === "string" ? [payload.aud] : (payload.aud ?? []);
    if (aud.length === 0 || !aud.some((a) => allowedAudiences(req).includes(a))) return null;
    return payload.sub ? payload : null;
  } catch (e) {
    if (process.env.MCP_AUTH_DEBUG) console.error(e);
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === "string" && TOKEN_INVALID_CODES.has(code)) return null;
    throw e;
  }
}

const KNOWN_CLIENTS: [RegExp, string][] = [
  [/claude|anthropic/i, "claude"],
  [/chatgpt|openai/i, "chatgpt"],
  [/cursor/i, "cursor"],
  [/codex/i, "codex"],
  [/windsurf|codeium/i, "windsurf"],
  [/vscode|visual studio code|copilot/i, "vscode"],
];

/** Short client name for activity attribution ("via claude"), from the token's client id or the user agent. */
export function clientLabel(claims: JWTPayload | null, userAgent: string | null): string {
  const clientId = [claims?.client_id, claims?.azp].find((v): v is string => typeof v === "string" && v.length > 0);
  for (const hint of [clientId, userAgent]) {
    if (!hint) continue;
    const known = KNOWN_CLIENTS.find(([re]) => re.test(hint));
    if (known) return known[1];
  }
  if (clientId && /^https?:\/\//.test(clientId)) {
    try {
      return new URL(clientId).hostname.replace(/^www\./, "").slice(0, 40);
    } catch {
      /* fall through */
    }
  }
  return "assistant";
}

export interface McpCaller {
  userId: string;
  client: string;
  scopes: string[];
}

const userIds = new Map<string, string>();

async function userForWorkosId(db: Db, workosId: string): Promise<string | null> {
  const cached = userIds.get(workosId);
  if (cached) return cached;
  let user = await db.users.byAuthId("workos", workosId);
  if (!user && process.env.WORKOS_API_KEY) {
    const { WorkOS } = await import("@workos-inc/node");
    // Only a 404 means the user is gone; any other WorkOS failure is an outage (503), not a bad token.
    const remote = await new WorkOS(process.env.WORKOS_API_KEY).userManagement.getUser(workosId).catch((e: unknown) => {
      if ((e as { status?: unknown } | null)?.status === 404) return null;
      throw e;
    });
    if (remote?.email) user = await ensureUser(db, { id: workosId, email: remote.email });
  }
  if (user) userIds.set(workosId, user.id);
  return user?.id ?? null;
}

/**
 * Resolves the MCP caller from an AuthKit access token, or from an extension
 * session token for clients that only support a static bearer header. Throws
 * when the caller can't be checked right now; the route answers 503.
 */
export async function resolveMcpCaller(req: Request, db: Db): Promise<McpCaller | "missing" | "invalid"> {
  const token = bearer(req);
  if (!token) return "missing";
  const ua = req.headers.get("user-agent");
  if (token.startsWith("fx_")) {
    const session = await db.extensionSessions.resolve(token);
    return session ? { userId: session.userId, client: clientLabel(null, ua), scopes: [] } : "invalid";
  }
  const claims = await verifyAccessToken(req, token);
  if (!claims?.sub) return "invalid";
  const userId = await userForWorkosId(db, claims.sub);
  if (!userId) return "invalid";
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  return { userId, client: clientLabel(claims, ua), scopes };
}

export function __resetMcpAuthForTests() {
  userIds.clear();
  jwks = null;
}
