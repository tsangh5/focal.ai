"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProfileEntry } from "@focal-ai/core";
import { SkipSites } from "@/components/account/SiteSettings";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ConnectExtension } from "@/components/connect/ConnectExtension";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProfile } from "@/lib/client/account";

const STEPS = ["Your taste", "Sites to skip", "Extension", "Try it"] as const;

interface TryLink {
  label: string;
  href: string;
}

/** "Try it now" links matched to what the profile holds; general ones when it's empty. */
export function tryLinks(entries: ProfileEntry[]): TryLink[] {
  const types = new Set(entries.filter((e) => e.kind === "thing" && e.strength !== "dislike").map((e) => (e.kind === "thing" ? e.type : "")));
  const place = entries.find((e) => e.kind === "thing" && e.type === "urn:entity:place" && e.disambiguation);
  const city = place?.kind === "thing" ? place.disambiguation?.split(",").slice(-2)[0]?.trim() : undefined;
  const links: TryLink[] = [];
  if (types.has("urn:entity:place") || types.size === 0) {
    links.push({
      label: city ? `Restaurants in ${city} on Yelp` : "Restaurants on Yelp",
      href: `https://www.yelp.com/search?find_desc=restaurants${city ? `&find_loc=${encodeURIComponent(city)}` : ""}`,
    });
  }
  if (types.has("urn:entity:movie") || types.has("urn:entity:artist") || types.size === 0) {
    links.push({ label: "Popular films on Letterboxd", href: "https://letterboxd.com/films/popular/" });
  }
  if (types.has("urn:entity:tv_show")) links.push({ label: "Most popular TV on IMDb", href: "https://www.imdb.com/chart/tvmeter/" });
  if (types.has("urn:entity:book")) links.push({ label: "Popular books on Goodreads", href: "https://www.goodreads.com/book/popular_by_date" });
  if (types.has("urn:entity:podcast")) links.push({ label: "Top podcasts on Podchaser", href: "https://www.podchaser.com/charts/top-podcasts" });
  if (types.has("urn:entity:destination")) links.push({ label: "Hotels on Booking.com", href: "https://www.booking.com/" });
  if (types.has("urn:entity:videogame")) links.push({ label: "Top sellers on Steam", href: "https://store.steampowered.com/search/?filter=topsellers" });
  return links;
}

/** Account-first onboarding: chat about your taste, pick sites to skip, connect the extension, try it. */
export function Onboarding({ email, extensionId, accounts }: { email: string; extensionId: string; accounts: boolean }) {
  const [step, setStep] = useState(0);
  const [entries, setEntries] = useState<ProfileEntry[]>([]);

  useEffect(() => {
    if (step === 0 || step === 3) void getProfile().then((p) => setEntries(p.entries)).catch(() => {});
  }, [step]);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Onboarding steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={
                  i === step
                    ? "rounded-full bg-accent px-3 py-1 text-xs font-medium text-white"
                    : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"
                }
              >
                {i + 1}. {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === 0 ? <ChatPanel email={email} /> : null}
      {step === 1 ? <SkipSites extensionId={extensionId} /> : null}
      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect the extension</CardTitle>
            <CardDescription>
              Install focal in Chrome, Edge, Brave, Arc or Opera, then connect it to this account so it ranks with your taste.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {accounts ? (
              <ConnectExtension extensionId={extensionId} />
            ) : (
              <p className="text-sm text-muted">Sign-in isn&apos;t configured on this server, so the extension uses the local dev session.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Try it now</CardTitle>
            <CardDescription>Open a list and watch your matches move to the top, each with the reason.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {tryLinks(entries).map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline-offset-4 hover:underline">
                {l.label}
              </a>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep((s) => s + 1)}>{step === 0 && entries.length === 0 ? "Skip for now" : "Next"}</Button>
        ) : (
          <Link href="/profile" className={buttonVariants()}>
            Done
          </Link>
        )}
      </div>
    </div>
  );
}
