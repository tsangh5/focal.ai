// Runs last in the dev suite: it uses up the dev account's identify budget for a minute.
import { test, expect, type APIResponse } from "@playwright/test";
import { DEV_TOKEN } from "../support";

test("identify allows 30 requests a minute per user, then 429 with Retry-After", async ({ request }) => {
  const body = {
    host: "yelp.com",
    pathPattern: "/search",
    signature: "div.biz",
    cityHints: ["San Francisco"],
    cards: [{ clientId: "c0", snippets: ["Rintaro"], links: [] }],
  };
  let limited: APIResponse | undefined;
  for (let i = 0; i < 40 && !limited; i++) {
    const res = await request.post("/api/page/identify", { headers: { authorization: `Bearer ${DEV_TOKEN}` }, data: body });
    if (res.status() === 429) limited = res;
    else expect(res.status()).toBe(200);
  }
  expect(limited, "never rate limited").toBeTruthy();
  expect(Number(limited!.headers()["retry-after"])).toBeGreaterThan(0);
});
