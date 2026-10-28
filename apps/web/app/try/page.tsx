"use client";

import { useEffect, useState } from "react";
import type { RankedCandidate, RenderPlan } from "@focal-ai/core";
import { PasteList } from "@/components/paste/PasteList";
import { ProfilePanel } from "@/components/profile/ProfilePanel";
import { RightRail } from "@/components/shell/RightRail";
import { TopBar, type TopBarTab } from "@/components/shell/TopBar";
import { RenderSurface } from "@/components/surface/RenderSurface";
import { getHealth, rankPage } from "@/lib/client/api";
import { useProfile } from "@/lib/client/store";
import type { DemoPage, HealthResponse, RankMeta, RankResponse, SurfaceMode } from "@/lib/client/types";

const STEPS = [
  {
    title: "Add a few things you like",
    body: "Use the panel on the left. Search for a band, restaurant, film or brand and add it. Two or three is enough to see the difference.",
  },
  {
    title: "Open any list page in another tab",
    body: "A restaurant search, a film chart, a hotel list, a bookshop category — anything that lists real-world things by name.",
  },
  {
    title: "Copy the names into the box below",
    body: "One per line, up to 50. Just the names: focal resolves each one against Qloo and leaves anything it cannot identify exactly where it was.",
  },
  {
    title: "Press Focus",
    body: "The list re-orders around your taste, and the Inspector on the right shows the exact Qloo request and the reason each item moved.",
  },
];

export default function TryPage() {
  return <TryApp />;
}

function TryApp() {
  const [pastePage, setPastePage] = useState<DemoPage | null>(null);
  const [response, setResponse] = useState<RankResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SurfaceMode>("original");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const { profile, setProfile } = useProfile();

  const tabs: TopBarTab[] = [{ id: "paste", label: "Your list", count: pastePage?.candidates.length ?? 0 }];

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  function handlePasteReady(next: DemoPage) {
    setPastePage(next);
    setResponse(null);
    setMode("original");
    setError(null);
  }

  const canFocus =
    pastePage !== null &&
    pastePage.candidates.length > 0 &&
    profile.seeds.some((seed) => seed.polarity === "like") &&
    !busy;

  async function handleFocus() {
    if (!canFocus || pastePage === null) return;
    setBusy(true);
    setError(null);
    try {
      const ranked = await rankPage({ page: pastePage, profile });
      setResponse(ranked);
      setMode("focal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ranking failed");
    } finally {
      setBusy(false);
    }
  }

  function handleReset() {
    setResponse(null);
    setMode("original");
    setError(null);
  }

  function handleApplyAgent(result: { ranked: RankedCandidate[]; plan: RenderPlan; meta: RankMeta }) {
    setResponse({ ranked: result.ranked, plan: result.plan, meta: result.meta });
    setMode("focal");
    setError(null);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        tabs={tabs}
        pageId="paste"
        onPageChange={() => undefined}
        mode={mode}
        onModeChange={setMode}
        hasResponse={response !== null}
        canFocus={canFocus}
        busy={busy}
        onFocus={() => void handleFocus()}
        onReset={handleReset}
        health={health}
        seedCount={profile.seeds.length}
      />

      <main className="mx-auto grid w-full max-w-[1400px] gap-4 px-4 py-4 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <ProfilePanel profile={profile} onProfileChange={setProfile} />

        <div className="flex min-w-0 flex-col gap-4">
          {error !== null ? (
            <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">
              <p className="text-sm font-medium text-danger">{error}</p>
              <p className="mt-1 text-xs text-muted">
                Check that QLOO_API_KEY is set (or QLOO_MOCK=1 for local demo data).
              </p>
            </div>
          ) : null}

          {pastePage === null ? (
            <>
              <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-lg font-semibold text-ink">Try focal on a real list</h1>
                  <p className="text-sm text-muted">
                    This is the same ranking the extension runs on a page, without installing anything. Bring a list
                    from any site.
                  </p>
                </div>
                <ol className="flex flex-col gap-3">
                  {STEPS.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-muted tabular-nums">
                        {i + 1}
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-sm font-medium text-ink">{step.title}</p>
                        <p className="text-xs leading-relaxed text-muted">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted">
                  Only the names and the city string leave your browser. The page you copied from is never read.
                </p>
              </section>
              <PasteList onReady={handlePasteReady} />
            </>
          ) : (
            <RenderSurface page={pastePage} response={response} mode={mode} busy={busy} />
          )}
        </div>

        {pastePage !== null ? (
          <RightRail
            page={pastePage}
            response={response}
            error={error}
            busy={busy}
            profile={profile}
            onProfileChange={setProfile}
            onApply={handleApplyAgent}
          />
        ) : (
          <aside className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface p-4 lg:sticky lg:top-[76px] lg:self-start">
            <h2 className="text-sm font-semibold text-ink">Inspector</h2>
            <p className="text-xs text-muted">
              Once you paste a list, this shows exactly what focal sent to Qloo and why each item moved.
            </p>
          </aside>
        )}
      </main>
    </div>
  );
}
