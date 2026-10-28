"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityEvent, ProfileEntry } from "@focal-ai/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeEvent } from "@/lib/client/chatEvents";

type ProfileActivity = ActivityEvent & { undoneBy?: string | null };

interface ProfileState {
  entries: ProfileEntry[];
  activity: ProfileActivity[];
}

function actorBadge(actor: string): string {
  if (actor === "manual") return "you";
  if (actor === "chat") return "chat";
  if (actor.startsWith("mcp:")) return `via ${actor.slice(4)}`;
  return actor;
}

function strengthOf(e: ProfileEntry): string {
  return e.kind === "rule" ? `never · ${e.status}` : e.strength;
}

export function ProfileManager({ email }: { email: string }) {
  const [state, setState] = useState<ProfileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error();
      setState((await res.json()) as ProfileState);
      setError(null);
    } catch {
      setError("Couldn't load your profile.");
    }
  }, []);

  useEffect(() => {
    let live = true;
    fetch("/api/profile")
      .then((res) => (res.ok ? (res.json() as Promise<ProfileState>) : Promise.reject(new Error())))
      .then((data) => live && setState(data))
      .catch(() => live && setError("Couldn't load your profile."));
    return () => {
      live = false;
    };
  }, []);

  const act = async (key: string, body: Record<string, string>) => {
    setBusy(key);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ProfileState & { error?: { message?: string } };
      if (res.status === 409) {
        setError(data.error?.message ?? "Your profile changed elsewhere; reload and try again.");
        await load();
        return;
      }
      if (!res.ok) {
        setError(data.error?.message ?? "That change is no longer available.");
        return;
      }
      setState(data);
      setError(null);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return <p className="text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }

  const pendingRules = state.entries.filter((e): e is Extract<ProfileEntry, { kind: "rule" }> => e.kind === "rule" && e.status === "pending");
  const things = state.entries.filter((e) => e.kind === "thing");
  const vibes = state.entries.filter((e) => e.kind === "vibe");
  const rules = state.entries.filter((e) => e.kind === "rule");

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">Signed in as {email}.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Waiting for your approval</h2>
        {pendingRules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing waiting. Rules an assistant proposes land here first.</p>
        ) : (
          pendingRules.map((rule) => (
            <Card key={rule.id} size="sm">
              <CardHeader>
                <CardTitle>Never {rule.name}</CardTitle>
                <CardDescription>
                  Proposed <Badge variant="secondary">{actorBadge(rule.source)}</Badge>
                </CardDescription>
                <Button
                  size="sm"
                  disabled={busy === rule.id}
                  onClick={() => void act(rule.id, { action: "approve_rule", entry_id: rule.id })}
                >
                  Approve
                </Button>
              </CardHeader>
            </Card>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Recent changes</h2>
        {state.activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <Card size="sm">
            <CardContent className="flex flex-col divide-y divide-border">
              {state.activity.map((event) => {
                const undoable = !event.undoneBy && event.action !== "undo";
                return (
                  <div key={event.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1 text-sm">{describeEvent(event)}</span>
                    <Badge variant="secondary">{actorBadge(event.actor)}</Badge>
                    {event.undoneBy && <Badge variant="outline">undone</Badge>}
                    {undoable && (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy === event.id}
                        onClick={() => void act(event.id, { action: "undo", event_id: event.id })}
                      >
                        Undo
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your profile</h2>
        {state.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Empty so far — tell chat or an assistant what you love.</p>
        ) : (
          <Card size="sm">
            <CardContent className="flex flex-col gap-3">
              {[
                ["Things", things],
                ["Vibes", vibes],
                ["Rules", rules],
              ].map(([label, list]) =>
                (list as ProfileEntry[]).length === 0 ? null : (
                  <div key={label as string}>
                    <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">{label as string}</p>
                    <ul className="flex flex-col gap-1">
                      {(list as ProfileEntry[]).map((e) => (
                        <li key={e.id} className="flex items-baseline gap-2 text-sm">
                          <span className="flex-1">
                            {e.name}
                            {"disambiguation" in e && e.disambiguation ? (
                              <span className="text-muted-foreground"> · {e.disambiguation}</span>
                            ) : null}
                          </span>
                          <Badge variant="outline">{strengthOf(e)}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
