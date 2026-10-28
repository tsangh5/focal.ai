# Deployment — focal.ai

> Status (2026-10-18): focal.ai is **not deployed anywhere yet**, and the Qloo hackathon key has not arrived. This is the deployment plan plus the exact verification steps to run once credentials and a host exist. The `Dockerfile` (repo root) and the smoke script (`scripts/smoke-prod.ts`) are **provided in the repo**. Nothing in this document claims a deployment has happened.

## 1. What gets deployed

| Component | Runs on | Notes |
| --- | --- | --- |
| Studio (`apps/web`) | Vercel (primary) or any Node 22+ container (fallback) | Next.js 16 App Router; the only HTTP surface; holds `QLOO_API_KEY` server-side. Hosts the MCP endpoint at `/mcp`. |
| Database (Neon Postgres) | Neon | Accounts, profiles, activity, extension sessions and caches. `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED` for migrations); without it the site runs unsigned, dev-only paths. |
| Local MCP server (`packages/mcp`) | Your own machine, stdio only | Development variant — the production endpoint is the hosted `/mcp` above. See `packages/mcp/README.md`. |

## 2. Primary target: Vercel

### 2.1 Repo access (read first)

Pushing to `tsangh5/focal.ai` is **pending push access** — all work exists as local commits. Options, in order of preference:

1. Push once access is granted, then import `tsangh5/focal.ai`.
2. Fork the repo to an account you control and import the fork (works identically).
3. Deploy without GitHub: `vercel login`, then `vercel deploy` from the repo root on this machine (the CLI uploads the local tree; add `--prod` to promote).

### 2.2 Import and project settings

1. Vercel dashboard → Add New → Project → import the repo (or run `vercel` in the repo root for a local deploy). Framework preset auto-detects Next.js.
2. Monorepo settings — two configurations; **try A first**:
   - **A** — Root Directory `apps/web`, and enable **"Include files outside the Root Directory in the Build Step"** (Settings → Build and Deployment). Required because the app imports `@focal-ai/core` and `@focal-ai/qloo` as workspace TypeScript source (`transpilePackages` in `apps/web/next.config.ts`).
   - **B** — Root Directory repo root, Build Command `pnpm --filter @focal-ai/web build`. Use this if A fails workspace resolution. Do not set an Output Directory (Next.js default).
3. Node: 22+ (root `engines`; `.nvmrc` pins 24). pnpm 12.4.2 comes from the `packageManager` field — the install command stays `pnpm install`.
4. Set environment variables (2.3), then Deploy.

### 2.3 Environment variables

Server-side only. Set for Production (and Preview if you use it).

| Variable | Required | Notes |
| --- | --- | --- |
| `QLOO_API_KEY` | **Yes in production** | Server-only; sent upstream as `X-Api-Key`; never returned by any route (`/api/health` exposes a boolean only). |
| `QLOO_API_BASE` | No | Defaults to `https://hackathon.api.qloo.com`. Hackathon keys work only against this host. |
| `ANTHROPIC_API_KEY` | No | Reserved for optional LLM features; **no code path reads it today**. Safe to omit. |
| `QLOO_MOCK` | **Must NOT be set** | `1` serves labeled fixture data; a deployed demo showing `MOCK DATA` fails the judged demo. |

### 2.4 Post-deploy verification

1. Open the deployment URL — the Studio should load; once a real key is present the status pill reads "Qloo connected".
2. `curl https://<deploy>/api/health` → expect `{"ok":true,"hasQlooKey":true,"dataSource":"live"}`.
   - `hasQlooKey:false` → the key is missing on this environment; `dataSource:"mock"` → `QLOO_MOCK` is set (remove it and redeploy).
3. Smoke script (`scripts/smoke-prod.ts`): `SMOKE_BASE_URL=https://<deploy> pnpm smoke` — expected to exit 0. It prints one PASS/FAIL/WARN line per check (health, search, rank, agent policy + discovery, secret hygiene) and exits 1 on any failure. Against a mock deployment it warns instead of failing, so a clean live run should show no mock warnings. `SMOKE_BASE_URL` defaults to `http://localhost:3210` when unset.
4. If the key has not arrived yet (current state): deploy anyway to validate plumbing — health will show `hasQlooKey:false` and ranking returns a "key not configured" server error until the key is added and the app redeployed.

## 3. Fallback: Docker (any container host)

The repo root carries a `Dockerfile` for hosting the Studio on Fly.io, Render, or any container platform (Next.js standalone output on Node 24, port 3000; the Qloo key is passed at run time, never baked into the image):

```bash
docker build -t focal-web .
docker run -p 3000:3000 -e QLOO_API_KEY=your_key focal-web
# keyless local demo (labeled fixtures): docker run -p 3000:3000 -e QLOO_MOCK=1 focal-web
```

Verify exactly as in 2.4 against `http://localhost:3000` (same `/api/health` check). Fly.io and Render use the same image, env vars, and health check.

Running without Docker: `pnpm build` then `QLOO_API_KEY=your_key pnpm --filter @focal-ai/web start` on any Node 22+ host.

## 4. Hosted MCP

The website serves a hosted MCP server at `https://<host>/mcp` (Streamable HTTP, `apps/web/app/mcp/route.ts` → `packages/mcp/src/hosted.ts`). Assistants sign in with OAuth via WorkOS AuthKit; extension `fx_` session tokens are also accepted for clients that only support a static bearer. The 9 profile tools, write rules and in-chat widgets: `packages/mcp/README.md` and `docs/tickets.md` (Wave M).

### Environment

Production adds two variables on top of §2.3:

| Variable | Required | Notes |
| --- | --- | --- |
| `WORKOS_AUTHKIT_DOMAIN` | Yes for OAuth | AuthKit domain, e.g. `focal.authkit.app`; the issuer for MCP access tokens. Without it `/mcp` still accepts `fx_` tokens but OAuth clients can't sign in. |
| `FOCAL_PUBLIC_URL` | Yes | Canonical origin (`https://<host>`). Builds the protected-resource metadata, `resource_metadata` challenge and `profile_page` links; forwarded headers are the fallback. |
| `DATABASE_URL` | Yes | `/mcp` returns 503 without a database — profiles live in Postgres. |

### WorkOS setup

In the WorkOS dashboard → **Connect → Configuration**:

1. Enable **Client ID Metadata Documents** (CIMD) and **Dynamic Client Registration** — ChatGPT and claude.ai register as OAuth clients this way.
2. Add `https://<host>/mcp` as a **Resource Indicator** and set it as the default, so access tokens carry `/mcp` in `aud`.
3. Point clients at `https://<host>/mcp`; they discover OAuth via `/.well-known/oauth-protected-resource/mcp` and the `WWW-Authenticate` challenge.

### Verify

- `pnpm smoke` (`SMOKE_BASE_URL=https://<host>`) checks the discovery chain: protected-resource metadata names `<base>/mcp` and an authorization server, `POST /mcp` unauthenticated returns 401 with `resource_metadata`, and the authorization server advertises `S256` plus a registration method.
- **ChatGPT**: `chatgpt.com/plugins` → **+** → Add custom MCP server → name it `focal`, paste the URL, OAuth → Create as a plugin → install, sign in, then `@focal` in a chat.
- **claude.ai**: Settings → Connectors → Add custom connector → name `focal`, paste the URL → Connect and sign in.
- In either client: read the profile, save a thing (an ambiguous name returns choices), propose a rule (stays pending on `/profile`), and `rank_list` — writes show in the activity as "via chatgpt" / "via claude" and are undoable there.

The local stdio server (`pnpm --filter @focal-ai/mcp start`) stays for development only; without `QLOO_API_KEY` it still starts and `QLOO_MOCK=1` serves local fixtures.

## 5. Operational notes

- **Rate limits** are in-process, per instance — 30 req/min on `/api/qloo/search`, 20 req/min on `/api/qloo/rank`, keyed by the first `x-forwarded-for` hop. Fine for demo scale; counters reset on restart/redeploy. A shared store would only matter for multi-instance fairness.
- **Logs contain no taste data and no keys.** Anonymous rank requests carry the profile per request and it's discarded; signed-in profiles persist in Postgres. `meta.qlooRequest` excludes the API key, and route tests assert no key material in responses.
- **No CORS configuration is needed** — the Studio calls its own same-origin route handlers, and `/mcp` speaks bearer-authenticated HTTP, not browser cookies.
- **What leaves the browser at all**: entity name strings, city strings, Qloo entity IDs, and the profile JSON — to our server (Qloo then sees names/city/IDs). No page HTML, no DOM, no form values.
