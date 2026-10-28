// Sign-in configured with placeholder WorkOS credentials: redirects and signed-out refusals; no real sign-in completes.
import { test, expect, type Page } from "@playwright/test";

const WORKOS_AUTHORIZE = /^https:\/\/api\.workos\.com\/user_management\/authorize\?/;

async function signInRequest(page: Page, path: string): Promise<{ signIn: string; authorize: string }> {
  const signIn = page.waitForRequest((r) => new URL(r.url()).pathname === "/sign-in");
  const authorize = page.waitForRequest((r) => WORKOS_AUTHORIZE.test(r.url()));
  page.goto(path).catch(() => {}); // the WorkOS hop itself is not under test
  return { signIn: (await signIn).url(), authorize: (await authorize).url() };
}

test.describe("signed-out visitors are sent to WorkOS sign-in", () => {
  for (const [path, returnTo] of [
    ["/chat", "/chat"],
    ["/profile", "/profile"],
    ["/activity", "/activity"],
    ["/settings", "/settings"],
    ["/onboarding", "/onboarding"],
    ["/why/3f1c1f8e-0000-4000-8000-000000000000", "/why/3f1c1f8e-0000-4000-8000-000000000000"],
    ["/connect", null],
  ] as const) {
    test(`${path} → /sign-in → WorkOS authorize`, async ({ page }) => {
      const { signIn, authorize } = await signInRequest(page, path);
      if (returnTo) expect(new URL(signIn).searchParams.get("returnTo")).toBe(returnTo);
      const a = new URL(authorize);
      expect(a.searchParams.get("client_id")).toBe("client_e2e_test");
      expect(a.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
      expect(a.searchParams.get("code_challenge_method")).toBe("S256");
    });
  }

  test("the extension popup's Sign in link goes to WorkOS too", async ({ page }) => {
    const { authorize } = await signInRequest(page, "/sign-in?from=extension");
    expect(authorize).toMatch(WORKOS_AUTHORIZE);
  });
});

test.describe("APIs refuse signed-out callers", () => {
  test("me, extension hand-off, chat and page API", async ({ request }) => {
    expect(await (await request.get("/api/me")).json()).toEqual({ signedIn: false });
    expect((await request.post("/api/extension/session")).status()).toBe(401);
    expect((await request.post("/api/chat", { data: { messages: [{ role: "user", content: "hi" }] } })).status()).toBe(401);
    // Dev sessions are off: an arbitrary bearer token is not a session.
    expect((await request.post("/api/page/rank", { headers: { authorization: "Bearer anything" }, data: {} })).status()).toBe(401);
    for (const path of ["/api/profile", "/api/activity", "/api/settings", "/api/account"]) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
    expect((await request.post("/api/feedback", { data: {} })).status()).toBe(401);
  });

  test("OAuth protected-resource metadata names the AuthKit issuer", async ({ request }) => {
    expect(await (await request.get("/.well-known/oauth-protected-resource")).json()).toMatchObject({
      resource: "http://localhost:3000/mcp",
      authorization_servers: ["https://example-e2e.authkit.app"],
    });
  });
});

test.describe("error handling", () => {
  test("an auth callback without a code sends the visitor to a retry page", async ({ request }) => {
    const res = await request.get("/auth/callback", { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(res.headers().location).toBe("http://localhost:3000/sign-in/failed");
  });

  test("authorization-server metadata answers 502 when AuthKit is unreachable", async ({ request }) => {
    const res = await request.get("/.well-known/oauth-authorization-server");
    expect(res.status()).toBe(502);
  });
});
