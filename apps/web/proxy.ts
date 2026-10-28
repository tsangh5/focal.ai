import { NextResponse, type NextRequest } from "next/server";
import { authEnabled } from "@/lib/server/auth/config";

/** AuthKit session refresh for website pages; a no-op until WorkOS is configured. */
export default async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const { authkit, handleAuthkitHeaders } = await import("@workos-inc/authkit-nextjs");
  const { headers } = await authkit(request);
  return handleAuthkitHeaders(request, headers);
}

export const config = {
  matcher: [
    "/connect",
    "/chat",
    "/profile",
    "/activity",
    "/settings",
    "/onboarding",
    "/why/:path*",
    "/sign-in",
    "/sign-out",
    "/auth/:path*",
    "/api/extension/:path*",
    "/api/chat",
    "/api/me",
    "/api/profile/:path*",
    "/api/activity/:path*",
    "/api/settings",
    "/api/account",
    "/api/discover",
    "/api/taste-context",
  ],
};
