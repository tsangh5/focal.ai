import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { addEntry } from "@focal-ai/core";
import { connect, createDb, migrate, type Db } from "@focal-ai/db";
import { __setDbForTests } from "@/lib/server/db";
import { GET, POST } from "@/app/api/profile/route";

let viewerUserId = "";
vi.mock("@/lib/server/auth/viewer", () => ({
  currentViewer: async () =>
    viewerUserId ? { userId: viewerUserId, email: "viewer@example.com", persisted: viewerUserId !== "dev" } : null,
}));

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const empty = { version: 2 as const, updatedAt: new Date().toISOString(), entries: [] };

describe("profile route without a database", () => {
  beforeAll(() => __setDbForTests(null));
  afterAll(() => __setDbForTests(undefined));

  it("401s without a viewer", async () => {
    viewerUserId = "";
    expect((await GET()).status).toBe(401);
    expect((await post({ action: "approve_rule", entry_id: "x" })).status).toBe(401);
  });

  it("serves an empty feed and 404s unknown targets", async () => {
    viewerUserId = "u1";
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], activity: [] });
    expect((await post({ action: "approve_rule", entry_id: "nope" })).status).toBe(404);
    expect((await post({ action: "undo", event_id: "nope" })).status).toBe(404);
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("profile route in Postgres", () => {
  let db: Db;
  let userId: string;
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = url ? connect(url, { max: 1 }) : null;

  beforeAll(async () => {
    await admin!.unsafe(`CREATE SCHEMA ${schema}`);
    db = createDb(connect(url!, { schema, max: 2 }));
    await migrate(db.sql);
    __setDbForTests(db);
    userId = (await db.users.upsert("viewer@example.com")).id;
    viewerUserId = userId;
  });
  afterAll(async () => {
    viewerUserId = "";
    __setDbForTests(undefined);
    await db.close();
    await admin!.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin!.end();
  });

  it("approves a pending rule as manual and undoes an mcp write", async () => {
    const rule = addEntry(empty, { kind: "rule", qlooId: "urn:tag:chain", name: "chain", source: "mcp:chatgpt" }, "mcp:chatgpt");
    await db.profile.commit(userId, rule.event as never, 0);
    const add = addEntry(
      { ...empty, entries: [rule.event.after!] },
      { kind: "thing", qlooId: "Q-rin", name: "Rintaro", type: "urn:entity:place", strength: "love", source: "mcp:chatgpt" },
      "mcp:chatgpt",
    );
    await db.profile.commit(userId, add.event as never, 1);

    const approved = await post({ action: "approve_rule", entry_id: rule.event.entryId });
    expect(approved.status).toBe(200);
    const body = (await approved.json()) as { entries: { id: string; status?: string }[]; activity: { actor: string; action: string }[] };
    expect(body.entries.find((e) => e.id === rule.event.entryId)?.status).toBe("active");
    expect(body.activity[0]).toMatchObject({ actor: "manual", action: "approve" });
    expect((await post({ action: "approve_rule", entry_id: rule.event.entryId })).status).toBe(404);

    const undone = await post({ action: "undo", event_id: add.event.id });
    expect(undone.status).toBe(200);
    const after = (await undone.json()) as { entries: { name: string }[]; activity: { action: string; undoes?: string; actor: string }[] };
    expect(after.entries.some((e) => e.name === "Rintaro")).toBe(false);
    expect(after.activity[0]).toMatchObject({ action: "undo", actor: "manual", undoes: add.event.id });

    expect((await post({ action: "undo", event_id: add.event.id })).status).toBe(404);
    const [undoRecord] = await db.profile.activity(userId, { limit: 1 });
    expect((await post({ action: "undo", event_id: undoRecord!.id })).status).toBe(404);
  });

  it("409s on a stale profile version", async () => {
    const rule = addEntry(empty, { kind: "rule", qlooId: "urn:tag:y", name: "y", source: "mcp:claude" }, "mcp:claude");
    const version = (await db.profile.load(userId)).version;
    await db.profile.commit(userId, rule.event as never, version);
    const orig = db.profile.load;
    db.profile.load = async (u: string) => ({ ...(await orig(u)), version: version - 1 });
    const res = await post({ action: "approve_rule", entry_id: rule.event.entryId });
    db.profile.load = orig;
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "CONFLICT", message: expect.stringContaining("reload") } });
  });
});
