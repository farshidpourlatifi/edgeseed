import { redirect } from "react-router";
import type { AppLoadContext } from "react-router";

/**
 * The session, or a redirect to `/login`. Call this in **every** protected
 * loader, including children of the dashboard layout.
 *
 * In React Router v7 a layout loader is not a security boundary. Child loaders
 * run in parallel with their parent rather than after it, and single fetch can
 * be asked for one loader on its own — `/dashboard/settings.data?_routes=routes%2Fdashboard.settings`
 * runs this child without its parent, so the layout's redirect never applies.
 * (A *plain* `.data` request does not show this: any matched loader redirecting
 * short-circuits the whole payload, so the layout covers for the child and the
 * bypass stays invisible.) A child that reads its own data must therefore do its
 * own check. See `docs/security-audit.md` #10.
 *
 * Throws rather than returning null so a caller cannot accidentally continue
 * with no user: a soft `return { user: null }` answers 200 to an
 * unauthenticated request, which is how `dashboard.settings.tsx` used to hide
 * this.
 */
export async function requireUser(context: AppLoadContext, request: Request) {
  // `context.auth` is set by `authMiddleware`; absent means the request never
  // passed through the Hono chain, which is a misconfiguration, not a session.
  if (!context.auth) throw redirect("/login");

  const session = await context.auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/login");

  return session;
}
