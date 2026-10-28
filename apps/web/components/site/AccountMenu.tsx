"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogIn, LogOut, MessageCircle, Plug, Settings, Sparkles, UserRound } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Me = { signedIn: false } | { signedIn: true; email: string };

export function AccountMenu({ className }: { className?: string }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/me")
      .then((res) => (res.ok ? (res.json() as Promise<Me>) : { signedIn: false as const }))
      .catch(() => ({ signedIn: false as const }))
      .then((next) => live && setMe(next));
    return () => {
      live = false;
    };
  }, []);

  if (!me) return <span className={cn("h-7 w-[72px] animate-pulse rounded-lg bg-surface-2", className)} aria-hidden />;

  if (!me.signedIn) {
    // Only reached after the client-side fetch, so `window` is available.
    const path = window.location.pathname;
    const returnTo = path && path !== "/" ? `?returnTo=${encodeURIComponent(path)}` : "";
    return (
      <a href={`/sign-in${returnTo}`} className={cn(buttonVariants({ size: "sm" }), className)}>
        <LogIn data-icon="inline-start" />
        Sign in
      </a>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-w-[220px]", className)}
        aria-label="Account menu"
      >
        <UserRound data-icon="inline-start" />
        <span className="truncate">{me.email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{me.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/chat" />}>
          <MessageCircle />
          Chat
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/profile" />}>
          <Sparkles />
          Your taste
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/connect" />}>
          <Plug />
          Connect extension
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form method="post" action="/sign-out">
          <DropdownMenuItem render={<button type="submit" className="w-full" />}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
