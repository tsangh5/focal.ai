import { Suspense } from "react";
import { connection } from "next/server";
import { ProfileEditor } from "@/components/account/ProfileEditor";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/server/auth/pageGate";

async function Gate() {
  await connection();
  await requireViewer("/profile");
  return <ProfileEditor />;
}

export default function ProfilePage() {
  return (
    <>
      <SiteHeader active="/profile" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Your taste</h1>
          <p className="text-sm text-muted">What focal ranks with. Change how much you like something, remove it, or approve suggested rules.</p>
        </div>
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <Gate />
        </Suspense>
      </main>
    </>
  );
}
