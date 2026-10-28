"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ProfileEntry, Strength } from "@focal-ai/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { approveRule, getProfile, removeEntry, setStrength } from "@/lib/client/account";

const STRENGTHS: Strength[] = ["love", "like", "dislike"];

export function typeLabel(type: string): string {
  const short = type.replace(/^urn:entity:/, "").replace(/_/g, " ");
  return short === "videogame" ? "video game" : short;
}

export function sourceLabel(source: string): string {
  if (source === "manual") return "you";
  if (source === "chat") return "focal chat";
  if (source === "page") return "on a page";
  if (source.startsWith("mcp:")) return `via ${source.slice(4)}`;
  return source;
}

/** "added by you", "added via Claude", "added on a page". */
function addedBy(source: string): string {
  const label = sourceLabel(source);
  return label.startsWith("via ") || label.startsWith("on ") ? `added ${label}` : `added by ${label}`;
}

function Row({
  entry,
  busy,
  onStrength,
  onRemove,
  onApprove,
}: {
  entry: ProfileEntry;
  busy: boolean;
  onStrength: (s: Strength) => void;
  onRemove: () => void;
  onApprove?: () => void;
}) {
  const detail =
    entry.kind === "thing"
      ? [typeLabel(entry.type), entry.disambiguation].filter(Boolean).join(" · ")
      : entry.kind === "vibe"
        ? "vibe"
        : "hard rule";
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-0" data-entry={entry.name} data-kind={entry.kind}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">{entry.kind === "rule" ? `Never ${entry.name}` : entry.name}</span>
        <span className="truncate text-xs text-muted">
          {detail} · {addedBy(entry.source)}
        </span>
      </div>
      {entry.kind !== "rule" ? (
        <select
          aria-label={`How much you like ${entry.name}`}
          value={entry.strength}
          disabled={busy}
          onChange={(e) => onStrength(e.target.value as Strength)}
          className="h-7 rounded-md border border-line bg-surface-2 px-2 text-xs text-ink"
        >
          {STRENGTHS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : null}
      {onApprove ? (
        <Button size="sm" disabled={busy} onClick={onApprove}>
          Approve
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove} aria-label={`Remove ${entry.name}`}>
        Remove
      </Button>
    </li>
  );
}

function Section({ title, description, entries, children }: { title: string; description: string; entries: ProfileEntry[]; children: (e: ProfileEntry) => React.ReactNode }) {
  if (entries.length === 0) return null;
  return (
    <Card data-section={title}>
      <CardHeader>
        <CardTitle>
          {title} <Badge variant="secondary">{entries.length}</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul>{entries.map(children)}</ul>
      </CardContent>
    </Card>
  );
}

/** The signed-in user's taste profile: change strengths, remove entries and approve pending rules. */
export function ProfileEditor() {
  const [entries, setEntries] = useState<ProfileEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setEntries((await getProfile()).entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your profile");
    }
  }, []);

  useEffect(() => {
    let live = true;
    getProfile()
      .then((p) => live && setEntries(p.entries))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load your profile"));
    return () => {
      live = false;
    };
  }, []);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  if (!entries) return <Skeleton className="h-64 w-full rounded-xl" />;

  const pending = entries.filter((e) => e.kind === "rule" && e.status === "pending");
  const rules = entries.filter((e) => e.kind === "rule" && e.status === "active");
  const things = entries.filter((e) => e.kind === "thing");
  const vibes = entries.filter((e) => e.kind === "vibe");
  const row = (e: ProfileEntry, approve = false) => (
    <Row
      key={e.id}
      entry={e}
      busy={busy}
      onStrength={(s) => void act(() => setStrength(e.id, s))}
      onRemove={() => void act(() => removeEntry(e.id))}
      onApprove={approve ? () => void act(() => approveRule(e.id)) : undefined}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing saved yet</CardTitle>
            <CardDescription>Tell focal a few things you love and they will show up here.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/chat" className={buttonVariants({ size: "sm" })}>
              Open chat
            </Link>
          </CardContent>
        </Card>
      ) : null}
      <Section title="Rules waiting for you" description="Assistants can suggest hard rules; they only hide anything once you approve them." entries={pending}>
        {(e) => row(e, true)}
      </Section>
      <Section
        title="Things"
        description="Places, films, TV, music, books, podcasts, games, brands, destinations and people."
        entries={things}
      >
        {(e) => row(e)}
      </Section>
      <Section title="Vibes" description="Styles and qualities that nudge every ranking." entries={vibes}>
        {(e) => row(e)}
      </Section>
      <Section title="Hard rules" description="Matching items are folded away on every site, with a Show button." entries={rules}>
        {(e) => row(e)}
      </Section>
    </div>
  );
}
