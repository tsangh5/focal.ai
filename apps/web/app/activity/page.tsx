import { Suspense } from "react";
import { connection } from "next/server";
import { ActivityList } from "@/components/account/ActivityList";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/server/auth/pageGate";

async function Gate() {
  await connection();
  await requireViewer("/activity");
  return <ActivityList />;
}

export default function ActivityPage() {
  return (
    <>
      <SiteHeader active="/activity" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <Gate />
        </Suspense>
      </main>
    </>
  );
}
