import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonVariants } from "@/components/ui/button";
import { authEnabled } from "@/lib/server/auth/config";

const STEPS = [
  {
    title: "Tell focal what you like",
    body: "Chat about anything you love — music, films, TV, restaurants, hotels, books, podcasts, games, brands, places to travel, people you follow. focal saves exact matches and asks when it isn't sure.",
  },
  {
    title: "Browse as usual",
    body: "On restaurant, hotel, film, TV, music, book, podcast, game, shopping and travel lists, the extension lifts the clear matches to the top and says why.",
  },
  {
    title: "Stay in control",
    body: "Every change is in your activity feed with undo. Pick sites to skip, approve hard rules, and export or delete everything.",
  },
];

export default function Home() {
  // Without sign-in configured (local dev), onboarding runs for the dev viewer directly.
  const start = authEnabled() ? "/sign-in?returnTo=%2Fonboarding" : "/onboarding";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-4 py-16">
        <section className="flex max-w-2xl flex-col gap-5">
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">The web, rendered for you.</h1>
          <p className="text-lg text-muted">
            focal re-orders the lists you already browse so the things you care about come first. Same site, same data,
            your ordering, powered by Qloo&apos;s taste graph.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={start} className={buttonVariants({ size: "lg" })}>
              Get started
            </Link>
            <Link href="/connect" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Install the extension
            </Link>
          </div>
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-4">
          <h2 id="how" className="text-sm font-medium uppercase tracking-wide text-muted">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-5">
                <span className="text-xs font-medium text-accent">Step {i + 1}</span>
                <h3 className="text-base font-semibold text-ink">{step.title}</h3>
                <p className="text-sm text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
