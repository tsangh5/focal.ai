/**
 * Production smoke test — runs against any deployment URL.
 *
 *   pnpm smoke                                        # defaults to http://localhost:3210
 *   SMOKE_BASE_URL=https://your-deploy.vercel.app pnpm smoke
 *
 * Prints one line per check (`PASS/FAIL/WARN — name — detail`) and a final
 * summary, then exits 1 when any check failed. Never prints secrets — only
 * booleans such as hasQlooKey.
 */

const BASE_URL = (process.env.SMOKE_BASE_URL?.trim() || "http://localhost:3210").replace(/\/+$/, "");

// Real Fugazi entity id from packages/qloo/fixtures/entities.json (mock fixture
// mirroring Qloo's public docs) — used as the single "like" seed for ranking.
const FUGAZI_ENTITY_ID = "7F2A9C05-4E81-4D3B-9A6F-B2C7E013D948";
const ENTITY_PLACE_TYPE = "urn:entity:place";

let passed = 0;
let failed = 0;
let warnings = 0;
let mockMode = false;

function pass(name: string, detail: string): void {
  passed += 1;
  console.log(`PASS — ${name} — ${detail}`);
}

function fail(name: string, detail: string): void {
  failed += 1;
  console.log(`FAIL — ${name} — ${detail}`);
}

function warn(name: string, detail: string): void {
  warnings += 1;
  console.log(`WARN — ${name} — ${detail}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

async function request(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; raw: string; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  return { status: response.status, raw, body };
}

async function postJson(path: string, payload: unknown): Promise<{ status: number; raw: string; body: unknown }> {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Page fields shared by the rank and agent calls. */
function pageFields() {
  return {
    pageId: "smoke-prod",
    pageType: ENTITY_PLACE_TYPE,
    locationQuery: "San Francisco",
  };
}

function profile() {
  const now = new Date().toISOString();
  return {
    version: 1 as const,
    updatedAt: now,
    seeds: [
      {
        entityId: FUGAZI_ENTITY_ID,
        name: "Fugazi",
        subtype: "urn:entity:artist",
        disambiguation: "Washington, D.C.",
        polarity: "like" as const,
        weight: 1,
        source: "searched" as const,
        addedAt: now,
      },
    ],
    rules: [],
  };
}

function candidates() {
  return [
    { clientId: "c-0", name: "Rintaro", locationText: "San Francisco", originalIndex: 0 },
    { clientId: "c-1", name: "State Bird Provisions", locationText: "San Francisco", originalIndex: 1 },
    { clientId: "c-2", name: "Absolutely Not A Real Venue", locationText: "San Francisco", originalIndex: 2 },
  ];
}

async function checkHealth(): Promise<void> {
  const name = "health";
  try {
    const { status, body } = await request("/api/health");
    const root = asRecord(body);
    if (status !== 200) {
      fail(name, `GET /api/health — HTTP ${status}`);
      return;
    }
    if (root?.ok !== true) {
      fail(name, `GET /api/health — ok !== true`);
      return;
    }
    const hasQlooKey = root.hasQlooKey === true;
    const dataSource = typeof root.dataSource === "string" ? root.dataSource : "unknown";
    mockMode = dataSource === "mock";
    const detail = `HTTP 200, ok=true, hasQlooKey=${hasQlooKey}, dataSource=${dataSource}`;
    if (!hasQlooKey && dataSource === "mock") {
      warn(name, `${detail} — mock mode (no Qloo key set, serving fixture data)`);
      return;
    }
    pass(name, detail);
  } catch (error) {
    fail(name, errorMessage(error));
  }
}

async function checkSearch(): Promise<void> {
  const name = "search";
  try {
    const { status, body } = await postJson("/api/qloo/search", { query: "Rintaro" });
    if (status !== 200) {
      fail(name, `POST /api/qloo/search — HTTP ${status}`);
      return;
    }
    const entities = asRecord(body)?.entities;
    if (!Array.isArray(entities)) {
      fail(name, "POST /api/qloo/search — entities is not an array");
      return;
    }
    if (mockMode && entities.length === 0) {
      fail(name, "mock mode but Rintaro returned 0 entities");
      return;
    }
    pass(name, `HTTP 200, entities=${entities.length}${mockMode ? " (mock mode)" : ""}`);
  } catch (error) {
    fail(name, errorMessage(error));
  }
}

async function checkRank(): Promise<void> {
  const name = "rank";
  try {
    const { status, body } = await postJson("/api/qloo/rank", {
      ...pageFields(),
      candidates: candidates(),
      profile: profile(),
    });
    if (status !== 200) {
      fail(name, `POST /api/qloo/rank — HTTP ${status}`);
      return;
    }
    const root = asRecord(body);
    const ranked = root?.ranked;
    if (!Array.isArray(ranked) || ranked.length !== 3) {
      fail(name, `ranked.length=${Array.isArray(ranked) ? ranked.length : "not an array"} (expected 3)`);
      return;
    }
    const meta = asRecord(root?.meta);
    const qlooRequest = asRecord(meta?.qlooRequest);
    if (qlooRequest?.path !== "/v2/insights") {
      fail(name, `meta.qlooRequest.path=${JSON.stringify(qlooRequest?.path)} (expected /v2/insights)`);
      return;
    }
    if (mockMode) {
      const entries = ranked.map(asRecord);
      const rintaro = entries.find((entry) => entry?.clientId === "c-0");
      if (rintaro?.affinityPct !== 93) {
        fail(name, `mock mode: Rintaro affinityPct=${JSON.stringify(rintaro?.affinityPct)} (expected 93)`);
        return;
      }
      if (meta?.unresolved !== 1) {
        fail(name, `mock mode: meta.unresolved=${JSON.stringify(meta?.unresolved)} (expected 1)`);
        return;
      }
    }
    const liveNote = mockMode ? " (mock mode)" : " (structure only, live mode)";
    pass(name, `HTTP 200, ranked=3, qlooRequest.path=/v2/insights${liveNote}`);
  } catch (error) {
    fail(name, errorMessage(error));
  }
}

async function checkAgent(message: string, expectedKind: "policy" | "discovery"): Promise<void> {
  const name = expectedKind === "policy" ? "agent policy" : "agent discovery";
  try {
    const { status, body } = await postJson("/api/agent", {
      message,
      ...pageFields(),
      candidates: candidates(),
      profile: profile(),
    });
    if (status !== 200) {
      fail(name, `POST /api/agent ("${message}") — HTTP ${status}`);
      return;
    }
    const result = asRecord(asRecord(body)?.result);
    if (result?.kind !== expectedKind) {
      fail(name, `result.kind=${JSON.stringify(result?.kind)} (expected "${expectedKind}")`);
      return;
    }
    pass(name, `HTTP 200, result.kind=${expectedKind}`);
  } catch (error) {
    fail(name, errorMessage(error));
  }
}

/** MCP OAuth discovery: protected-resource metadata, the 401 challenge, and the authorization server. */
async function checkMcp(): Promise<void> {
  const name = "mcp oauth";
  try {
    const meta = await request("/.well-known/oauth-protected-resource/mcp");
    const pr = asRecord(meta.body);
    const servers = Array.isArray(pr?.authorization_servers) ? (pr.authorization_servers as unknown[]).filter((s) => typeof s === "string" && s.length > 0) : [];
    if (meta.status !== 200 || pr?.resource !== `${BASE_URL}/mcp`) {
      fail(name, `protected-resource — HTTP ${meta.status}, resource=${JSON.stringify(pr?.resource)}`);
      return;
    }
    if (servers.length === 0) {
      warn(name, "no authorization_servers — OAuth is not configured on this deployment");
      return;
    }

    const unauthenticated = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: AbortSignal.timeout(15000),
    });
    const challenge = unauthenticated.headers.get("www-authenticate") ?? "";
    if (unauthenticated.status !== 401 || !challenge.includes("resource_metadata=")) {
      fail(name, `POST /mcp unauthenticated — HTTP ${unauthenticated.status}, WWW-Authenticate=${JSON.stringify(challenge)}`);
      return;
    }

    const asMeta = await fetch(`${servers[0]}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(15000) });
    const asBody = asRecord(await asMeta.json().catch(() => undefined));
    const methods = Array.isArray(asBody?.code_challenge_methods_supported) ? (asBody.code_challenge_methods_supported as unknown[]) : [];
    const registration = typeof asBody?.registration_endpoint === "string" || asBody?.client_id_metadata_document_supported === true;
    if (asMeta.status !== 200 || !methods.includes("S256") || !registration) {
      fail(
        name,
        `authorization-server — HTTP ${asMeta.status}, S256=${methods.includes("S256")}, registration_endpoint=${typeof asBody?.registration_endpoint === "string"}, client_id_metadata_document_supported=${JSON.stringify(asBody?.client_id_metadata_document_supported)}`,
      );
      return;
    }
    pass(name, `resource=${JSON.stringify(pr.resource)}, 401 challenge advertises metadata, AS=${servers[0]} supports S256 + registration`);
  } catch (error) {
    fail(name, errorMessage(error));
  }
}

async function checkSecretHygiene(): Promise<void> {
  const name = "secret hygiene";
  const markers = ["X-Api-Key", "hackathon.api.qloo.com"];
  try {
    const { status, raw } = await request("/");
    if (status !== 200) {
      fail(name, `GET / — HTTP ${status}`);
      return;
    }

    const srcs = [...raw.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    const origin = new URL(BASE_URL).origin;
    const sameOrigin = new Set<string>();
    for (const src of srcs) {
      try {
        const url = new URL(src, BASE_URL);
        if (url.origin === origin) sameOrigin.add(url.toString());
      } catch {
        // Malformed src — nothing to fetch.
      }
    }

    let scannedChunks = 0;
    let skippedChunks = 0;
    const hits: string[] = [];
    const scan = (label: string, text: string) => {
      for (const marker of markers) {
        if (text.includes(marker)) hits.push(`${marker} in ${label}`);
      }
    };

    scan("/", raw);
    for (const url of sameOrigin) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const text = await response.text();
        scannedChunks += 1;
        scan(new URL(url).pathname, text);
      } catch {
        skippedChunks += 1;
      }
    }

    if (hits.length > 0) {
      fail(name, `found ${hits.join("; ")}`);
      return;
    }
    const skippedNote = skippedChunks > 0 ? `, ${skippedChunks} unfetchable (best-effort)` : "";
    pass(name, `scanned / + ${scannedChunks} script chunk(s)${skippedNote}, no X-Api-Key or hackathon.api.qloo.com`);
  } catch (error) {
    fail(name, errorMessage(error));
  }
}

console.log(`Production smoke test against ${BASE_URL}`);

await checkHealth();
await checkSearch();
await checkRank();
await checkAgent("hide sponsored", "policy");
await checkAgent("find me something similar", "discovery");
await checkMcp();
await checkSecretHygiene();

console.log("");
console.log(`${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  process.exit(1);
}
