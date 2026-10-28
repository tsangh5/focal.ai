# Browser tests

Playwright tests for the website, its APIs, the hosted MCP server and the unpacked extension running in Chromium.

```sh
docker run -d -p 5432:5432 -e POSTGRES_USER=focal -e POSTGRES_PASSWORD=focal postgres:17-alpine
# or any Postgres: set DATABASE_URL if it isn't postgres://focal:focal@localhost:5432/focal
pnpm --filter @focal-ai/e2e exec playwright install chromium   # once
pnpm e2e                           # both configs below
pnpm --filter @focal-ai/e2e e2e:dev
pnpm --filter @focal-ai/e2e e2e:auth
```

Each run builds the extension against `http://localhost:3000`, migrates the database and starts two servers:

- `next dev` on port 3000, with mock Qloo and Jev and every API key blanked, so runs are free and repeatable. Its log goes to `e2e/.logs/`.
- `sites/server.mjs` on port 4567: small copies of Yelp, Letterboxd, Gmail and example.org. The extension's browser maps those hostnames to it.

Ports 3000 and 4567 must be free. Each run clears `apps/web/.next/dev` first: a stale Turbopack dev cache can make open pages reload over and over, which breaks tests at random.

| Config | Mode | Covers |
| --- | --- | --- |
| `playwright.dev.config.ts` | Local dev: `FOCAL_DEV_SESSION=1`, sign-in off, the `dev@localhost` account | API routes, MCP with real `fx_` sessions, the extension on fixture pages (reorder, labels, Why, feedback, infinite scroll, single-page navigation, skip rules, popup), the website pages |
| `playwright.auth.config.ts` | Sign-in on, with placeholder WorkOS credentials | Signed-out redirects and 401s, the sign-in failure page, OAuth metadata errors. Never reaches WorkOS |

`tests/dev/zz-rate-limits.spec.ts` runs last on purpose: it uses up the dev account's request budget for a minute.

Notes:

- Chrome derives an unpacked extension's id from its folder path. `servers.ts` computes it and passes it to the website as `NEXT_PUBLIC_FOCAL_EXTENSION_ID`.
- Keep test titles ASCII. Playwright names each test's browser profile folder after the title.
- Failures keep a trace and a screenshot in `e2e/test-results/`. Open a trace with `pnpm --filter @focal-ai/e2e exec playwright show-trace <path>`.
