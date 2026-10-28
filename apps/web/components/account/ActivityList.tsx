"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getActivity, undoActivity, type ActivityItem } from "@/lib/client/account";
import { describeEvent } from "@/lib/client/chatEvents";
import { sourceLabel } from "./ProfileEditor";

function when(at: string): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Every profile change, who made it, and an Undo for the ones that can still be undone. */
export function ActivityList() {
  const [events, setEvents] = useState<ActivityItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setEvents((await getActivity()).events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load activity");
    }
  }, []);

  useEffect(() => {
    let live = true;
    getActivity()
      .then((r) => live && setEvents(r.events))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load activity"));
    return () => {
      live = false;
    };
  }, []);

  async function undo(id: string) {
    setBusy(id);
    setError(null);
    try {
      await undoActivity(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo that");
    } finally {
      setBusy(null);
    }
  }

  if (!events) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Everything that changed your taste profile, newest first. Assistants can&apos;t change it quietly.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {events.length === 0 ? <p className="text-sm text-muted">No changes yet.</p> : null}
        <ul>
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-0" data-event={e.action}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-ink">{describeEvent(e)}</span>
                <span className="text-xs text-muted">
                  {e.actor === "system" ? "focal" : sourceLabel(e.actor)} · {when(e.at)}
                </span>
              </div>
              {e.undoneBy ? (
                <Badge variant="outline">Undone</Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void undo(e.id)}>
                  {busy === e.id ? "Undoing…" : "Undo"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
