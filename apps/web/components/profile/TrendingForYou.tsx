"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, ImageOff, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DiscoverItem {
  entityId: string;
  name: string;
  type: string;
  affinity?: number;
  disambiguation?: string;
  imageUrl?: string;
  because: string[];
}

interface DiscoverResponse {
  items: DiscoverItem[];
  reason?: string;
  durationMs?: number;
}

/** Every type Qloo ranks, so the UI never implies a shorter list than exists. */
const TABS = [
  { type: "place", label: "Places" },
  { type: "movie", label: "Films" },
  { type: "tv_show", label: "TV" },
  { type: "artist", label: "Music" },
  { type: "book", label: "Books" },
  { type: "podcast", label: "Podcasts" },
  { type: "videogame", label: "Games" },
  { type: "brand", label: "Brands" },
  { type: "destination", label: "Destinations" },
  { type: "person", label: "People" },
] as const;

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TABS.map((t) => [t.type, t.label]));

type TabType = (typeof TABS)[number]["type"];
/** "all" is the default feed: every category, interleaved. */
type FeedType = TabType | "all";

/** Two at a time; the rest are reachable with the arrows. */
const PER_PAGE = 2;
const AUTOPLAY_MS = 5000;

function Card({ item }: { item: DiscoverItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-2">
        {item.imageUrl && !broken ? (
          // Qloo artwork arrives in every shape — tall posters, wide venue
          // photos, square headshots — and a plain object-cover crops faces and
          // book titles. Letterbox with a blurred copy of the same image behind
          // it: the subject is never cut, and the frame still fills. Both tags
          // share one URL, so it is a single network request.
          <>
            <Image
              src={item.imageUrl}
              alt=""
              aria-hidden="true"
              fill
              sizes="(max-width: 640px) 100vw, 320px"
              className="scale-125 object-cover blur-xl saturate-150"
              unoptimized
            />
            <Image
              src={item.imageUrl}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 320px"
              className="object-contain"
              onError={() => setBroken(true)}
              unoptimized
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-muted" aria-hidden="true">
            <ImageOff className="size-5" />
          </div>
        )}
        {/* The feed mixes categories, so each card has to say what it is. */}
        <span className="absolute left-2 top-2 rounded-full bg-canvas/85 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted backdrop-blur-sm">
          {TYPE_LABEL[item.type] ?? item.type}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink">{item.name}</span>
          {item.affinity !== undefined ? (
            <Badge variant="secondary" className="shrink-0 text-[11px] tabular-nums">
              {Math.round(item.affinity * 100)}%
            </Badge>
          ) : null}
        </div>
        {item.disambiguation ? <p className="truncate text-xs text-muted">{item.disambiguation}</p> : null}
        {item.because.length > 0 ? (
          <p className="truncate text-xs text-accent">because you like {item.because.join(" and ")}</p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * One feed's results — a single category, or all ten mixed. Mounted with
 * `key={type}` so changing the filter remounts instead of resetting state
 * inside an effect.
 */
function TrendingPanel({ type, city }: { type: FeedType; city?: string }) {
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);

  const items = data?.items ?? [];
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ type });
    // Send the city for the mixed feed too — the server applies it only to the
    // place-like types, so films and books are unaffected.
    if (city && (type === "all" || type === "place" || type === "destination")) params.set("city", city);
    fetch(`/api/discover?${params}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load recommendations.");
        return (await res.json()) as DiscoverResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load recommendations.");
      });
    return () => {
      cancelled = true;
    };
  }, [type, city]);

  /**
   * Advance every 5s. `page` is a dep so a manual arrow click restarts the
   * window rather than jumping again immediately. Paused on hover and focus,
   * and off entirely for reduced-motion users (WCAG 2.2.2).
   */
  useEffect(() => {
    if (pages <= 1 || paused) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setPage((p) => p + 1), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [pages, paused, page]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="aspect-[16/10] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
        {data.reason === "profile has nothing to go on yet"
          ? "Add a few things you like and recommendations show up here."
          : "Nothing to recommend for this type yet."}
      </p>
    );
  }

  const current = page % pages;
  const shown = items.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  return (
    <div
      className="flex flex-col gap-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Crossfade + slide between pages. `mode="popLayout"` keeps the
          outgoing pair in flow so the grid never collapses mid-transition. */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.ul
          key={current}
          className="grid gap-3 sm:grid-cols-2"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
        >
          {shown.map((item) => (
            <Card key={item.entityId} item={item} />
          ))}
        </motion.ul>
      </AnimatePresence>
      {pages > 1 ? (
        <div className="flex items-center justify-between">
          <span className="text-xs tabular-nums text-muted">
            {current * PER_PAGE + 1}–{Math.min(items.length, current * PER_PAGE + PER_PAGE)} of {items.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              aria-label="Previous"
              onClick={() => setPage((p) => (p - 1 + pages) % pages)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="sm" variant="outline" aria-label="Next" onClick={() => setPage((p) => (p + 1) % pages)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TrendingForYou({ city }: { city?: string }) {
  // Everything, mixed, by default. The filter is opt-in: ten category tabs
  // sitting above the feed imply you have to pick one before anything happens.
  const [type, setType] = useState<FeedType>("all");
  const [filtering, setFiltering] = useState(false);

  function closeFilter() {
    setFiltering(false);
    setType("all");
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Trending for you</h2>
          <p className="text-xs text-muted">
            {type === "all"
              ? "What is popular now across everything you like."
              : `What is popular now in ${TYPE_LABEL[type]?.toLowerCase() ?? type}.`}
          </p>
        </div>
        <Button
          size="sm"
          variant={filtering ? "secondary" : "ghost"}
          aria-expanded={filtering}
          onClick={() => (filtering ? closeFilter() : setFiltering(true))}
        >
          <SlidersHorizontal className="size-3.5" />
          {type === "all" ? "Filter" : TYPE_LABEL[type]}
        </Button>
      </div>

      {filtering ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Category">
          <button
            type="button"
            aria-pressed={type === "all"}
            onClick={() => setType("all")}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
              type === "all" ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink",
            )}
          >
            Everything
          </button>
          {TABS.map((t) => (
            <button
              key={t.type}
              type="button"
              aria-pressed={type === t.type}
              onClick={() => setType(t.type)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                type === t.type ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <TrendingPanel key={type} type={type} city={city} />
    </section>
  );
}
