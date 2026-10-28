import { connection, NextResponse, type NextRequest } from "next/server";
import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";
import { ensureUser } from "@/lib/server/auth/users";
import { getDb } from "@/lib/server/db";

export async function GET(request: NextRequest): Promise<Response> {
  await connection();
  if (!authEnabled()) return authDisabledResponse();
  const { handleAuth } = await import("@workos-inc/authkit-nextjs");
  return handleAuth({
    returnPathname: "/onboarding",
    onSuccess: async ({ user }) => {
      const db = getDb();
      if (db && user.email) await ensureUser(db, { id: user.id, email: user.email });
    },
    // A missing, expired or reused code lands here: send the visitor to a page that lets them retry.
    onError: ({ error }) => {
      console.error("[auth callback]", error instanceof Error ? error.message : error);
      return NextResponse.redirect(new URL("/sign-in/failed", request.url), 303);
    },
  })(request);
}
