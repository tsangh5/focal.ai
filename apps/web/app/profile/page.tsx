import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { ProfileManager } from "@/components/profile/ProfileManager";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { authEnabled } from "@/lib/server/auth/config";

async function ProfileGate() {
  await connection();
  if (!authEnabled()) notFound();
  const { withAuth } = await import("@workos-inc/authkit-nextjs");
  const { user } = await withAuth();
  if (!user) redirect("/sign-in?returnTo=%2Fprofile");
  return <ProfileManager email={user.email ?? ""} />;
}

export default function ProfilePage() {
  return (
    <>
      <SiteHeader active="/profile" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold">Your profile</h1>
        <Suspense fallback={<Skeleton className="h-[40vh] w-full rounded-xl" />}>
          <ProfileGate />
        </Suspense>
      </main>
    </>
  );
}
