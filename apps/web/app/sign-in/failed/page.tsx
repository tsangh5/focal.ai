import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonVariants } from "@/components/ui/button";

export default function SignInFailedPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign-in didn&apos;t finish</h1>
        <p className="text-sm text-muted">
          The sign-in link may have expired or been used already. Nothing was changed; try again.
        </p>
        <div>
          <Link href="/sign-in" className={buttonVariants()}>
            Try signing in again
          </Link>
        </div>
      </main>
    </>
  );
}
