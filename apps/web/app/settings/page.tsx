import { Suspense } from "react";
import { connection } from "next/server";
import { NeverRunList } from "@/components/account/NeverRunList";
import { AccountData, SkipSites } from "@/components/account/SiteSettings";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled } from "@/lib/server/auth/config";
import { requireViewer } from "@/lib/server/auth/pageGate";

async function Gate() {
  await connection();
  await requireViewer("/settings");
  return (
    <>
      <SkipSites extensionId={process.env.NEXT_PUBLIC_FOCAL_EXTENSION_ID ?? ""} />
      <NeverRunList />
      <AccountData signOutAvailable={authEnabled()} />
    </>
  );
}

export default function SettingsPage() {
  return (
    <>
      <SiteHeader active="/settings" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <Gate />
        </Suspense>
      </main>
    </>
  );
}
