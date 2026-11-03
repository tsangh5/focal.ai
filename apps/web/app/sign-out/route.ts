import { headers } from "next/headers";
import { authDisabledResponse, authEnabled } from "@/lib/server/auth/config";

/**
 * Absolute origin of this deployment, from the proxy's forwarded headers.
 * Mirrors `publicOrigin` in lib/server/mcp/auth.ts.
 */
async function origin(): Promise<string> {
  const configured = process.env.FOCAL_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function POST(): Promise<Response> {
  if (!authEnabled()) return authDisabledResponse();
  const { signOut } = await import("@workos-inc/authkit-nextjs");
  // WorkOS needs an absolute returnTo. A relative "/" is ignored, and it falls
  // back to the dashboard's App Homepage URL — which, when that is unset,
  // fails the logout with `app-homepage-url-not-found` rather than signing the
  // user out.
  await signOut({ returnTo: await origin() });
  return new Response(null, { status: 204 });
}
