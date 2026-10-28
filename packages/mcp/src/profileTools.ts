/**
 * Profile tools shared by the website chat and the hosted MCP server, so both
 * follow the same write rules (spec §5.9, §5.10): save only on one clear match,
 * return choices when ambiguous, rules start pending, every write attributed.
 */
import {
  addEntry,
  removeEntry,
  selectSignals,
  summarizeProfile,
  type ActivityEvent,
  type EntrySource,
  type InsightType,
  type ProfileV2,
} from "@focal-ai/core";
import type { QlooClient, QlooEntityType } from "@focal-ai/qloo";

export const TYPES = ["place", "destination", "movie", "tv_show", "book", "artist", "brand", "podcast", "videogame", "person"] as const;
export const STRENGTHS = ["love", "like", "dislike"] as const;
export type ShortType = (typeof TYPES)[number];

export interface ProfileToolContext {
  qloo: QlooClient;
  /** Who the writes are attributed to: `chat` or `mcp:<client>`. */
  actor: EntrySource;
  getProfile(): ProfileV2;
  /** Persists one write; throws on conflict. */
  commit(next: ProfileV2, event: ActivityEvent): Promise<void>;
  events: ActivityEvent[];
}

export const normalizeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const toType = (t: string): InsightType => `urn:entity:${t}` as InsightType;
const isType = (t: string | undefined): t is ShortType => !!t && TYPES.includes(t as ShortType);
const isStrength = (s: string | undefined): s is (typeof STRENGTHS)[number] => !!s && STRENGTHS.includes(s as (typeof STRENGTHS)[number]);
type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function save(ctx: ProfileToolContext, input: Parameters<typeof addEntry>[1]) {
  const { profile, event } = addEntry(ctx.getProfile(), input, ctx.actor);
  await ctx.commit(profile, event);
  ctx.events.push(event);
  return event;
}

async function resolveTag(ctx: ProfileToolContext, query: string, tagId?: string) {
  const { tags } = await ctx.qloo.searchTags({ query, take: 5 });
  if (tagId) {
    const picked = tags.find((t) => t.id === tagId);
    return picked ? { match: picked } : { choices: tags };
  }
  const exact = tags.filter((t) => normalizeName(t.name) === normalizeName(query));
  return exact.length === 1 ? { match: exact[0]! } : { choices: tags };
}

function tasteSummary(profile: ProfileV2) {
  const count = (pred: (e: ProfileV2["entries"][number]) => boolean) => profile.entries.filter(pred).length;
  return {
    things: count((e) => e.kind === "thing"),
    vibes: count((e) => e.kind === "vibe"),
    active_rules: count((e) => e.kind === "rule" && e.status === "active"),
    pending_rules: count((e) => e.kind === "rule" && e.status === "pending"),
    summary: summarizeProfile(profile) || "empty",
  };
}

async function recommend(ctx: ProfileToolContext, type: ShortType, city: string | undefined, take: number) {
  const profile = ctx.getProfile();
  const signals = selectSignals(profile, toType(type));
  if (signals.entities.length === 0 && signals.tags.length === 0) {
    return { results: [], note: "The profile has no likes yet. Add a few things first." };
  }
  const disliked = new Set(profile.entries.filter((e) => e.strength === "dislike").map((e) => e.qlooId));
  const known = new Set(profile.entries.map((e) => e.qlooId));
  const { entities } = await ctx.qloo.insights({
    resultType: toType(type) as QlooEntityType,
    signalEntityIds: signals.entities.map((s) => s.id),
    signalTagIds: signals.tags.map((s) => s.id),
    ...(city ? { locationQuery: city } : {}),
    take: take + known.size,
  });
  return {
    based_on: [...signals.entities, ...signals.tags].map((s) => s.name),
    results: entities
      .filter((s) => !disliked.has(s.entity.entityId) && !known.has(s.entity.entityId))
      .slice(0, take)
      .map((s) => ({ name: s.entity.name, disambiguation: s.entity.disambiguation, affinity: Math.round((s.affinity ?? 0) * 100) / 100 })),
  };
}

/** Executes one profile tool call. Write rules live here, not in the prompt. */
export async function runProfileTool(ctx: ProfileToolContext, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "search_entities": {
      const query = str(args.query);
      const type = str(args.type);
      if (!query || !isType(type)) return { error: "query and a valid type are required" };
      const { entities } = await ctx.qloo.search({ query, types: [toType(type) as QlooEntityType], location: str(args.city), take: 5 });
      return { results: entities.map((e) => ({ entity_id: e.entityId, name: e.name, disambiguation: e.disambiguation })) };
    }
    case "add_thing": {
      const thingName = str(args.name);
      const type = str(args.type);
      const strength = str(args.strength);
      if (!thingName || !isType(type) || !isStrength(strength)) return { error: "name, a valid type and strength are required" };
      const { entities } = await ctx.qloo.search({ query: thingName, types: [toType(type) as QlooEntityType], location: str(args.city), take: 5 });
      const ofType = entities.filter((e) => e.subtype === toType(type) || !e.subtype);
      const entityId = str(args.entity_id);
      const exact = entityId
        ? ofType.filter((e) => e.entityId === entityId)
        : ofType.filter((e) => normalizeName(e.name) === normalizeName(thingName));
      if (exact.length !== 1) {
        return {
          saved: false,
          reason: exact.length === 0 && !entityId ? "no exact match" : "ambiguous",
          choices: ofType.map((e) => ({ entity_id: e.entityId, name: e.name, disambiguation: e.disambiguation })),
          instruction: "Ask the user which one they mean, then call add_thing again with entity_id.",
        };
      }
      const e = exact[0]!;
      const event = await save(ctx, {
        kind: "thing",
        qlooId: e.entityId,
        name: e.name,
        type: toType(type),
        strength,
        source: ctx.actor,
        ...(e.disambiguation ? { disambiguation: e.disambiguation } : {}),
      });
      return { saved: true, name: e.name, disambiguation: e.disambiguation, strength, event_id: event.id };
    }
    case "add_vibe":
    case "propose_rule": {
      const query = str(name === "add_vibe" ? args.vibe : args.rule);
      if (!query) return { error: "missing text" };
      const strength = name === "add_vibe" ? str(args.strength) : "never";
      if (name === "add_vibe" && !isStrength(strength)) return { error: "invalid strength" };
      const found = await resolveTag(ctx, query, str(args.tag_id));
      if (!("match" in found) || !found.match) {
        return {
          saved: false,
          choices: found.choices.map((t) => ({ tag_id: t.id, name: t.name })),
          instruction: "Ask the user which one fits, then call again with tag_id.",
        };
      }
      const tag = found.match;
      const event =
        name === "add_vibe"
          ? await save(ctx, { kind: "vibe", qlooId: tag.id, name: tag.name, strength: strength as (typeof STRENGTHS)[number], source: ctx.actor })
          : await save(ctx, { kind: "rule", qlooId: tag.id, name: tag.name, source: ctx.actor });
      return name === "add_vibe"
        ? { saved: true, vibe: tag.name, strength, event_id: event.id }
        : { saved: true, rule: tag.name, status: "pending", note: "The user must approve this rule on their focal profile page.", event_id: event.id };
    }
    case "remove_entry": {
      const target = str(args.name);
      if (!target) return { error: "missing name" };
      const kind = str(args.kind);
      const matches = ctx
        .getProfile()
        .entries.filter((e) => normalizeName(e.name) === normalizeName(target) && (!kind || e.kind === kind));
      if (matches.length !== 1) {
        return {
          removed: false,
          choices: matches.map((m) => ({ name: m.name, kind: m.kind })),
          ...(matches.length > 1 ? { instruction: "Several entries share this name; call remove_entry again with kind." } : {}),
        };
      }
      const { profile, event } = removeEntry(ctx.getProfile(), matches[0]!.id, ctx.actor);
      await ctx.commit(profile, event);
      ctx.events.push(event);
      return { removed: true, name: matches[0]!.name, event_id: event.id };
    }
    case "read_profile":
      return { profile: summarizeProfile(ctx.getProfile()) || "empty" };
    case "taste_summary":
      return tasteSummary(ctx.getProfile());
    case "recommend": {
      const type = str(args.type);
      if (!isType(type)) return { error: "a valid type is required" };
      const take = typeof args.take === "number" ? Math.min(Math.max(Math.trunc(args.take), 1), 20) : 8;
      return recommend(ctx, type, str(args.city), take);
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
