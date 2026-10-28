import { notFound, redirect } from "next/navigation";
import { authEnabled } from "./config";
import { currentViewer, type Viewer } from "./viewer";

/**
 * Account pages: the signed-in viewer, else sign-in (returning here), else a
 * 404 when sign-in isn't configured and there is no local dev viewer.
 */
export async function requireViewer(returnTo: string): Promise<Viewer> {
  const viewer = await currentViewer();
  if (viewer) return viewer;
  if (authEnabled()) redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  notFound();
}
