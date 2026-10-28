import type { BackgroundReply, ContentMessage, FeedbackResponse, IdentifyResponse, RankResponse } from "./api";
import { pathPattern } from "./api";
import { applyPlan, type ApplyHandle, type ApplyOptions } from "./apply/apply";
import { createGate } from "./apply/gate";
import { FOCAL_HOSTS } from "./config";
import { cityHints, detectList, snapshotCards, type DetectedList } from "./detect/detect";
import { checkEligibility } from "./guards/eligibility";
import { applyLayout } from "./layouts/apply";
import { deleteLayout, getLayout, layoutKey, saveLayout } from "./layouts/store";
import { getSettings } from "./storage";
import type { RenderOp, RenderPlan } from "./types";

function send<T>(msg: ContentMessage): Promise<BackgroundReply<T>> {
  return chrome.runtime.sendMessage(msg);
}

let current: ApplyHandle | null = null;
let watcher: MutationObserver | null = null;
let rerunTimer: ReturnType<typeof setTimeout> | undefined;
let firstScheduledAt = 0;
const runTimes: number[] = [];
let generation = 0;
let lastList: { container: Element; cards: Set<Element> } | null = null;
let last: { key: string; hints: string[] } | null = null;
let rejected = new WeakMap<Element, number>();
// After Undo, cards that load later stay untouched too.
let userUndid = false;

// Card ids stay with the element, so a card keeps its id when more load in.
const cardIds = new WeakMap<Element, string>();
let nextCardId = 0;

const RERUN_DELAY_MS = 1000;
const RERUN_MAX_WAIT_MS = 3000;
const MAX_RUNS_PER_MINUTE = 6;

function idFor(el: Element): string {
  let id = cardIds.get(el);
  if (!id) {
    id = `c${nextCardId++}`;
    cardIds.set(el, id);
  }
  return id;
}

function withStableIds(list: DetectedList): DetectedList {
  return { ...list, cards: new Map([...list.cards.values()].map((el) => [idFor(el), el])) };
}

/** Same container, and every card from the last run is still there: more items loaded in. */
function isTopUp(list: DetectedList): boolean {
  if (!lastList || list.container !== lastList.container) return false;
  const now = new Set(list.cards.values());
  return now.size > lastList.cards.size && [...lastList.cards].every((el) => now.has(el));
}

function scheduleRerun(): void {
  const now = Date.now();
  if (rerunTimer === undefined) firstScheduledAt = now;
  else if (now - firstScheduledAt > RERUN_MAX_WAIT_MS) return;
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => {
    rerunTimer = undefined;
    const at = Date.now();
    while (runTimes.length > 0 && at - runTimes[0]! > 60_000) runTimes.shift();
    if (runTimes.length >= MAX_RUNS_PER_MINUTE) return scheduleRerun();
    const list = detectList(document);
    if (!list || sameList(list) || rejected.get(list.container) === list.cards.size) return;
    watcher?.disconnect();
    watcher = null;
    if (isTopUp(list)) return void run(undefined, true);
    current?.undo();
    current = null;
    void run(0);
  }, RERUN_DELAY_MS);
}

function sameList(list: DetectedList): boolean {
  if (!lastList || list.container !== lastList.container || list.cards.size !== lastList.cards.size) return false;
  return [...list.cards.values()].every((el) => lastList!.cards.has(el));
}

function watch(container: Element, cards: Iterable<Element>): void {
  const known = new Set(cards);
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    const added = records.flatMap((r) =>
      [...r.addedNodes].filter((n): n is Element => n.nodeType === 1 && !known.has(n as Element) && !(n as Element).hasAttribute("data-focal")),
    );
    // Keep freshly appended cards after the lifted ones right away; labels follow on the top-up.
    const fresh = added.filter((el) => el.parentElement === container);
    if (fresh.length > 0 && current?.active) current.extend([], new Map(fresh.map((el) => [idFor(el), el])));
    if (added.length > 0 || !container.isConnected) scheduleRerun();
  });
  watcher.observe(container, { childList: true });
  if (container.parentElement) watcher.observe(container.parentElement, { childList: true });
}

function watchPage(): void {
  watcher?.disconnect();
  watcher = new MutationObserver((records) => {
    if (records.some((r) => [...r.addedNodes].some((n) => n.nodeType === 1 && !(n as Element).hasAttribute("data-focal")))) scheduleRerun();
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}

function reject(list: DetectedList): void {
  rejected.set(list.container, list.cards.size);
  watchPage();
}

/**
 * The part of a fresh plan that touches only newly loaded cards: their labels,
 * highlights and folds. Reorders are dropped, so nothing already seen moves.
 */
function topUpOps(plan: RenderPlan, fresh: Set<string>): RenderOp[] {
  const ops: RenderOp[] = [];
  for (const op of plan.ops) {
    if (op.op === "annotate" || op.op === "emphasize") {
      if (fresh.has(op.clientId)) ops.push(op);
    } else if (op.op === "collapse" || op.op === "hide") {
      const clientIds = op.clientIds.filter((id) => fresh.has(id));
      if (clientIds.length > 0) ops.push({ ...op, clientIds, ...(op.op === "collapse" ? { label: op.label.replace(/^\d+/, String(clientIds.length)) } : {}) });
    }
  }
  return ops;
}

/**
 * A rank on a stored layout that resolved nothing means the layout names the
 * wrong snippets. A lookup-budget skip, or a profile with no signals, never got
 * that far; an older server that doesn't report the count can't tell us.
 */
function shouldInvalidateLayout(res: RankResponse): boolean {
  return res.resolvedCount === 0 && !res.resolutionLimited && res.status !== "no_signals";
}

async function run(gateMs?: number, topUp = false): Promise<void> {
  runTimes.push(Date.now());
  const gen = ++generation;
  const settings = await getSettings();
  const eligibility = checkEligibility({
    url: location.href,
    settings,
    incognito: chrome.extension.inIncognitoContext,
    focalHosts: FOCAL_HOSTS,
    document,
  });
  if (!eligibility.eligible) return;

  const detected = detectList(document);
  if (!detected) return watchPage();
  const list = withStableIds(detected);
  const seen = topUp ? (lastList?.cards ?? new Set<Element>()) : new Set<Element>();
  lastList = { container: list.container, cards: new Set(list.cards.values()) };
  watch(list.container, list.cards.values());

  const cards = snapshotCards(list);
  // Apps can change the URL (and its search box) before swapping the list; cards keep the context they came with.
  const key = cards.map((c) => c.snippets[0] ?? "").sort().join("\n");
  const hints = topUp && last ? last.hints : last?.key === key ? last.hints : cityHints(document);
  last = { key, hints };

  const gate = topUp ? null : createGate(list.container as HTMLElement, gateMs);
  const host = location.hostname.replace(/^www\./, "");
  const pattern = pathPattern(location.pathname);
  const layoutId = layoutKey(host, pattern, list.signature);

  // A known layout names the cards here: no identify call, and no snippets leave the page.
  const layout = await getLayout(layoutId);
  const local = layout && applyLayout(layout, cards, hints);
  const identified: BackgroundReply<IdentifyResponse> = local
    ? { ok: true, data: local }
    : await send<IdentifyResponse>({
        type: "identify",
        body: { host, pathPattern: pattern, signature: list.signature, cityHints: hints, cards },
      });
  if (gen !== generation) return gate?.cancel();
  if (!identified.ok || !identified.data.isList || !identified.data.pageType || identified.data.items.length === 0) {
    gate?.cancel();
    if (identified.ok && !topUp) reject(list);
    return;
  }
  if (identified.data.layout) void saveLayout(layoutId, identified.data.layout);

  const ranked = await send<RankResponse>({
    type: "rank",
    body: { host, pathPattern: pattern, pageType: identified.data.pageType, items: identified.data.items },
  });
  if (local && ranked.ok && shouldInvalidateLayout(ranked.data)) void deleteLayout(layoutId);
  if (gen !== generation) return gate?.cancel();
  if (!ranked.ok || !ranked.data.plan) {
    gate?.cancel();
    return;
  }
  const { plan, pageResultId } = ranked.data;
  const options: ApplyOptions = {
    onUndo: () => {
      userUndid = true;
    },
    ...(pageResultId && {
      onWhy: () => void send({ type: "open-why", pageResultId }),
      onFeedback: async (clientId, verdict) => {
        const reply = await send<FeedbackResponse>({ type: "feedback", body: { pageResultId, clientId, verdict } });
        return reply.ok && reply.data.saved;
      },
    }),
  };

  if (topUp) {
    if (userUndid) return;
    const fresh = new Map([...list.cards].filter(([, el]) => !seen.has(el)));
    const ops = topUpOps(plan, new Set(fresh.keys()));
    if (current?.active) current.extend(ops, fresh);
    else if (ops.length > 0) current = applyPlan(list, { ...plan, ops }, options);
    if (pageResultId && current) void send({ type: "page-result", pageResultId, lifted: current.lifted });
    return;
  }

  gate!.ready(() => {
    if (gen !== generation) return;
    current?.undo();
    userUndid = false;
    current = applyPlan(list, plan, options);
    if (pageResultId) void send({ type: "page-result", pageResultId, lifted: current.lifted });
  });
}

let lastHref = location.href;
setInterval(() => {
  if (location.href === lastHref) return;
  lastHref = location.href;
  rejected = new WeakMap();
  scheduleRerun();
}, 1000);

void run();
