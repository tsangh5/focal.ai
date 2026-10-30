"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteAccount, getSites, saveSites, type SiteLists } from "@/lib/client/account";
import { sendToExtension } from "@/lib/client/extension";

/** The extension also refreshes from the server; this just makes a change take effect right away. */
async function pushToExtension(extensionId: string, sites: SiteLists): Promise<void> {
  await sendToExtension(extensionId, { type: "focal:settings", settings: sites });
}

function HostList({ hosts, action, onAction, busy, empty }: { hosts: string[]; action: string; onAction: (h: string) => void; busy: boolean; empty: string }) {
  if (hosts.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul>
      {hosts.map((h) => (
        <li key={h} className="flex items-center gap-3 border-b border-line py-2 last:border-0" data-host={h}>
          <span className="flex-1 truncate text-sm text-ink">{h}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction(h)} aria-label={`${action} ${h}`}>
            {action}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Sites to skip (editable here and during onboarding). */
export function SkipSites({ extensionId }: { extensionId: string }) {
  const [sites, setSites] = useState<SiteLists | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getSites()
      .then((s) => live && setSites(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load your settings"));
    return () => {
      live = false;
    };
  }, []);

  async function save(next: Partial<SiteLists>) {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveSites(next);
      setSites(saved);
      await pushToExtension(extensionId, saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!sites) return <Skeleton className="h-40 w-full rounded-xl" />;

  function add(e: React.FormEvent) {
    e.preventDefault();
    const host = draft.trim();
    if (!host || !sites) return;
    setDraft("");
    void save({ skipSites: [...sites.skipSites, host] });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Sites focal is on for</CardTitle>
          <CardDescription>
            focal is off everywhere until you turn it on. When a page has a list it could sort, it offers to enable
            itself for that site; nothing is read or sent until you accept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HostList
            hosts={sites.siteOn}
            action="Turn off"
            busy={busy}
            empty="None yet. focal will offer when it finds a list it can sort."
            onAction={(h) => void save({ siteOn: sites.siteOn.filter((s) => s !== h) })}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sites to skip</CardTitle>
          <CardDescription>
            focal never reads or changes these sites. It already never runs on banking, health, government, email, messaging,
            file storage, password managers, sign-in and payment pages.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form onSubmit={add} className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. reddit.com"
              aria-label="Site to skip"
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-muted"
            />
            <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
              Add
            </Button>
          </form>
          <HostList
            hosts={sites.skipSites}
            action="Remove"
            busy={busy}
            empty="You aren't skipping any sites."
            onAction={(h) => void save({ skipSites: sites.skipSites.filter((s) => s !== h) })}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Offers you declined</CardTitle>
          <CardDescription>Sites where you said &ldquo;not now&rdquo;. focal will not offer again unless you turn it back on.</CardDescription>
        </CardHeader>
        <CardContent>
          <HostList
            hosts={sites.siteOff}
            action="Turn back on"
            busy={busy}
            empty="None."
            onAction={(h) => void save({ siteOff: sites.siteOff.filter((s) => s !== h) })}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** Export everything, or delete the account. */
export function AccountData({ signOutAvailable }: { signOutAvailable: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signOut = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function remove() {
    setError(null);
    try {
      await deleteAccount();
      if (signOutAvailable) signOut.current?.submit();
      else {
        router.push("/");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the account");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>Your profile is yours: download it as JSON, or delete your account and everything in it.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <a href="/api/account" download="focal-export.json" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Download my data
          </a>
          {confirming ? (
            <>
              <Button size="sm" variant="destructive" onClick={() => void remove()}>
                Yes, delete everything
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
              Delete my account
            </Button>
          )}
        </div>
        <form ref={signOut} method="post" action="/sign-out" hidden />
      </CardContent>
    </Card>
  );
}
