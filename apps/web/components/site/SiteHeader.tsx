import Image from "next/image";
import Link from "next/link";
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
      <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-2">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="" width={22} height={22} aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight text-ink">focal.ai</span>
        </Link>
        <nav className="flex items-center gap-0.5" aria-label="Site">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active === link.href ? "page" : undefined}
              className={
                active === link.href
                  ? "rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink"
                  : "rounded-md px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
              }
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
