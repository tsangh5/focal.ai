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
import type {
  DemoPage,
  HealthResponse,
  PageId,
  RankMeta,
  RankResponse,
  SurfaceMode,
} from "@/lib/client/types";
import { BUILT_IN_PAGE_IDS, PAGES } from "@/lib/pages";

const BUILT_IN_TABS: TopBarTab[] = BUILT_IN_PAGE_IDS.map((id) => ({
  id,
  label: PAGES[id].name,
  count: PAGES[id].candidates.length,
}));

export default function Home() {
  return <FocalApp />;
}

function FocalApp() {
  const [pageId, setPageId] = useState<PageId>("tables");
  const [pastePage, setPastePage] = useState<DemoPage | null>(null);
  const [response, setResponse] = useState<RankResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SurfaceMode>("original");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const { profile, setProfile, reset } = useProfile();

  const page: DemoPage | null = pageId === "paste" ? pastePage : PAGES[pageId];

  const tabs: TopBarTab[] = [
    ...BUILT_IN_TABS,
    { id: "paste", label: "Paste", count: pastePage?.candidates.length ?? 0 },
  ];

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  function handlePageChange(id: PageId) {
    setPageId(id);
    setResponse(null);
    setMode("original");
    setError(null);
  }

  function handlePasteReady(next: DemoPage) {
    setPastePage(next);
    setResponse(null);
    setMode("original");
    setError(null);
  }

  const canFocus =
    page !== null &&
    page.candidates.length > 0 &&
    profile.seeds.some((seed) => seed.polarity === "like") &&
    !busy;

  async function handleFocus() {
    if (!canFocus || page === null) return;
    setBusy(true);
    setError(null);
    try {
      const ranked = await rankPage({ page, profile });
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

  function handleApplyAgent(result: {
    ranked: RankedCandidate[];
    plan: RenderPlan;
    meta: RankMeta;
  }) {
    setResponse({ ranked: result.ranked, plan: result.plan, meta: result.meta });
    setMode("focal");
    setError(null);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        tabs={tabs}
        pageId={pageId}
        onPageChange={handlePageChange}
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
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3"
            >
              <p className="text-sm font-medium text-danger">{error}</p>
              <p className="mt-1 text-xs text-muted">
                Check that QLOO_API_KEY is set (or QLOO_MOCK=1 for local demo data).
              </p>
            </div>
          ) : null}

          {page !== null ? (
            <RenderSurface page={page} response={response} mode={mode} busy={busy} />
          ) : (
            <PasteList onReady={handlePasteReady} />
          )}
        </div>

        {page !== null ? (
          <RightRail
            page={page}
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
              Use your list to see exactly what focal.ai sent to Qloo and why each item moved.
            </p>
          </aside>
        )}
      </main>
    </div>
  );
}
