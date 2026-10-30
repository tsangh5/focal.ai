"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TasteTag {
  name: string;
  affinity?: number;
}
interface ContextResponse {
  tags: TasteTag[];
  summary: string | null;
  reason?: string;
}

export function TasteContext() {
  const [data, setData] = useState<ContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/taste-context", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not read your taste context.");
        return (await res.json()) as ContextResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read your taste context.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-destructive">{error}</p>;

  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-6 w-2/3 rounded-md" />
      </div>
    );
  }

  if (!data.summary && data.tags.length === 0) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">Taste context</h2>
        <p className="text-xs text-muted">How Qloo reads your tastes together.</p>
      </div>

      {data.summary ? <p className="text-sm leading-relaxed text-ink">{data.summary}</p> : null}

      {data.tags.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Qloo tags</h3>
          <ul className="flex flex-wrap gap-1.5">
            {data.tags.map((tag) => (
              <li
                key={tag.name}
                className={cn(
                  "rounded-full border border-line px-2 py-0.5 text-xs",
                  (tag.affinity ?? 0) > 0.99 ? "bg-accent/10 text-accent" : "text-muted",
                )}
              >
                {tag.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

    </section>
  );
}
