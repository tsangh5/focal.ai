import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";

const LINKS = [
  { href: "/chat", label: "Chat" },
  { href: "/profile", label: "Profile" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
  { href: "/connect", label: "Extension" },
] as const;

export function SiteHeader({ active }: { active?: (typeof LINKS)[number]["href"] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      {/* Phones and small tablets: logo and account on the first row, the links on a second row that scrolls sideways if it must. */}
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <Link href="/" className="flex min-h-8 items-center gap-2">
          <Image src="/logo.svg" alt="" width={22} height={22} aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight text-ink">focal.ai</span>
        </Link>
        <nav
          className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-0.5 scroll-row overflow-x-auto px-3 md:order-none md:mx-0 md:w-auto md:overflow-visible md:px-0"
          aria-label="Site"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active === link.href ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-2 text-xs font-medium md:py-1",
                active === link.href ? "bg-surface-2 text-ink" : "text-muted transition-colors hover:bg-surface hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <AccountMenu className="ml-auto" />
      </div>
    </header>
  );
}
