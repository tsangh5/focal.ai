import { Suspense } from "react";
import { connection } from "next/server";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled } from "@/lib/server/auth/config";
import { requireViewer } from "@/lib/server/auth/pageGate";

async function Gate() {
  await connection();
  const viewer = await requireViewer("/onboarding");
  return <Onboarding email={viewer.email} extensionId={process.env.NEXT_PUBLIC_FOCAL_EXTENSION_ID ?? ""} accounts={authEnabled()} />;
}

export default function OnboardingPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Set up focal</h1>
          <p className="text-sm text-muted">Four quick steps. You can change everything later.</p>
        </div>
        <Suspense fallback={<Skeleton className="h-[60vh] w-full rounded-xl" />}>
          <Gate />
        </Suspense>
      </main>
    </>
  );
}
