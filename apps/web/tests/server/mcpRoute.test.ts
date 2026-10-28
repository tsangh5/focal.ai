import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { connect, createDb, migrate, type Db } from "@focal-ai/db";
import type { QlooClient, QlooEntity } from "@focal-ai/qloo";
import { __setDbForTests } from "@/lib/server/db";
import { __resetMcpAuthForTests, clientLabel } from "@/lib/server/mcp/auth";
import { __resetRateLimitForTests } from "@/lib/server/rateLimit";
import { POST } from "@/app/mcp/route";
import { GET as protectedResource } from "@/app/api/oauth/protected-resource/route";

const entity = (id: string, name: string, subtype: string) => ({ entityId: id, name, subtype, tagIds: [], tagNames: [], raw: null }) as QlooEntity;
vi.mock("@/lib/server/qloo", () => ({
  getQlooClient: (): QlooClient =>
    ({
      search: async ({ query }: { query: string }) => ({
        entities: query.toLowerCase() === "rintaro" ? [entity("Q-rin", "Rintaro", "urn:entity:place")] : [],
        durationMs: 1,
        raw: null,
      }),
      searchTags: async () => ({ tags: [], raw: null }),
      insights: async () => ({ entities: [], durationMs: 1, raw: null }),
      getEntities: async () => ({ entities: [], raw: null }),
    }) as unknown as QlooClient,
  dataSource: () => "mock",
}));

const workos = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    userManagement = { getUser: workos.getUser };
  },
}));

const ISSUER = "https://focal-test.authkit.app";
const RESOURCE = "http://localhost/mcp";
const CHALLENGE = 'Bearer error="invalid_token", resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"';

function mcpRequest(token: string | null, body: unknown, headers: Record<string, string> = {}) {
  return new Request(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const toolCall = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("MCP discovery and auth", () => {
  let privateKey: CryptoKey;
  let jwk: JWK;
  const fakeDb = {
    users: { byAuthId: vi.fn(async () => ({ id: "u1", email: "a@b.c" })) },
    extensionSessions: { resolve: vi.fn(async () => null) },
    profile: { load: vi.fn(async () => ({ version: 0, entries: [] })), commit: vi.fn() },
  } as unknown as Db;

  beforeAll(async () => {
    process.env.WORKOS_AUTHKIT_DOMAIN = "focal-test.authkit.app";
    process.env.WORKOS_CLIENT_ID = "client_test";
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === `${ISSUER}/oauth2/jwks` ? jwksReply() : realFetch(input, init),
    );
    __setDbForTests(fakeDb);
  });
  let jwksReply: () => Promise<Response> = async () => Response.json({ keys: [jwk] });
  afterEach(() => {
    jwksReply = async () => Response.json({ keys: [jwk] });
    vi.restoreAllMocks();
    __resetMcpAuthForTests();
    __resetRateLimitForTests();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    __setDbForTests(undefined);
    delete process.env.WORKOS_AUTHKIT_DOMAIN;
  });

  const sign = (claims: Record<string, unknown>, issuer = ISSUER) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setSubject("user_w1").setIssuedAt().setExpirationTime("5m").sign(privateKey);

  it("publishes protected-resource metadata pointing at AuthKit", async () => {
    const res = await protectedResource(new Request("http://localhost/.well-known/oauth-protected-resource"));
    expect(await res.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER] });
  });

  it("challenges a request without a token", async () => {
    const res = await POST(mcpRequest(null, toolCall("read_profile", {})));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("accepts an AuthKit token for this resource and rejects foreign ones", async () => {
    const ok = await POST(mcpRequest(await sign({ aud: RESOURCE }), toolCall("read_profile", {})));
    expect(ok.status).toBe(200);
    expect(fakeDb.users.byAuthId).toHaveBeenCalledWith("workos", "user_w1");

    const wrongAud = await POST(mcpRequest(await sign({ aud: "https://other.example/mcp" }), toolCall("read_profile", {})));
    expect(wrongAud.status).toBe(401);
    expect(wrongAud.headers.get("www-authenticate")).toContain('error="invalid_token"');

    const wrongIssuer = await POST(mcpRequest(await sign({ aud: RESOURCE }, "https://evil.authkit.app"), toolCall("read_profile", {})));
    expect(wrongIssuer.status).toBe(401);
  });

  it("answers 401 invalid_token to expired, garbage and badly signed tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ aud: RESOURCE })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER)
      .setSubject("user_w1")
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 1800)
      .sign(privateKey);
    const otherKey = (await generateKeyPair("RS256")).privateKey;
    const forged = await new SignJWT({ aud: RESOURCE }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setSubject("user_w1").setExpirationTime("5m").sign(otherKey);
    const unknownKey = await new SignJWT({ aud: RESOURCE }).setProtectedHeader({ alg: "RS256", kid: "k9" }).setIssuer(ISSUER).setSubject("user_w1").setExpirationTime("5m").sign(otherKey);
    for (const token of [expired, "not-a-jwt", "e30.e30.c2ln", forged, unknownKey]) {
      const res = await POST(mcpRequest(token, toolCall("read_profile", {})));
      expect(res.status, token).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
    }
  });

  it("rejects a token with no audience", async () => {
    const res = await POST(mcpRequest(await sign({}), toolCall("read_profile", {})));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
  });

  it.each([
    ["the JWKS fetch fails", async () => Promise.reject(new TypeError("fetch failed"))],
    ["the JWKS fetch times out (ERR_JWKS_TIMEOUT)", async () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["AuthKit answers 502", async () => new Response("bad gateway", { status: 502 })],
  ])("answers 503 with Retry-After, not 401, when %s", async (_why, reply) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    jwksReply = reply;
    const res = await POST(mcpRequest(await sign({ aud: RESOURCE }), toolCall("read_profile", {})));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(await res.json()).toMatchObject({ error: { code: "UNAVAILABLE" } });
    expect(logged).toHaveBeenCalled();
  });

  it("answers 503 when WorkOS is down for a new user, 401 when WorkOS says the user is gone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const byAuthId = vi.mocked(fakeDb.users.byAuthId);
    process.env.WORKOS_API_KEY = "sk_test";
    try {
      byAuthId.mockResolvedValueOnce(null);
      workos.getUser.mockRejectedValueOnce(Object.assign(new Error("bad gateway"), { status: 502 }));
      const down = await POST(mcpRequest(await sign({ aud: RESOURCE }), toolCall("read_profile", {})));
      expect(down.status).toBe(503);
      expect(down.headers.get("retry-after")).toBe("30");

      byAuthId.mockResolvedValueOnce(null);
      workos.getUser.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
      const gone = await POST(mcpRequest(await sign({ aud: RESOURCE }), toolCall("read_profile", {})));
      expect(gone.status).toBe(401);
      expect(gone.headers.get("www-authenticate")).toBe(CHALLENGE);
    } finally {
      delete process.env.WORKOS_API_KEY;
    }
  });

  it("names the client for attribution", () => {
    expect(clientLabel({ client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata" }, null)).toBe("claude");
    expect(clientLabel(null, "openai-mcp/1.0.0")).toBe("chatgpt");
    expect(clientLabel({ client_id: "https://example.dev/client.json" }, "node")).toBe("example.dev");
    expect(clientLabel(null, null)).toBe("assistant");
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("MCP writes in Postgres", () => {
  let db: Db;
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = url ? connect(url, { max: 1 }) : null;

  beforeAll(async () => {
    await admin!.unsafe(`CREATE SCHEMA ${schema}`);
    db = createDb(connect(url!, { schema, max: 2 }));
    await migrate(db.sql);
    __setDbForTests(db);
  });
  afterAll(async () => {
    __setDbForTests(undefined);
    await db.close();
    await admin!.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin!.end();
  });

  it("attributes a write to the assistant and leaves it undoable", async () => {
    const user = await db.users.upsert(`mcp-${randomUUID()}@example.com`);
    const { token } = await db.extensionSessions.issue(user.id);
    const res = await POST(mcpRequest(token, toolCall("add_thing", { name: "Rintaro", type: "place", strength: "love" }), { "user-agent": "Claude-User" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { content: { text: string }[] } };
    expect(JSON.parse(body.result.content[0]!.text)).toMatchObject({ saved: true });

    const [event] = await db.profile.activity(user.id);
    expect(event).toMatchObject({ actor: "mcp:claude", action: "add" });
    const { entries } = await db.profile.load(user.id);
    expect(entries[0]).toMatchObject({ name: "Rintaro", source: "mcp:claude" });
  });
});
