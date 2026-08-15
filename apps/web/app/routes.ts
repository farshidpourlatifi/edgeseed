import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("forgot-password", "routes/forgot-password.tsx"),
  // Path is `PASSWORD_RESET_REDIRECT` in `app/lib/auth-redirects.ts`; the
  // emailed link resolves against it, so the two must not drift.
  // `tests/e2e/password-reset.spec.ts` fails if they do.
  route("reset-password", "routes/reset-password.tsx"),
  // Path is `INVITATION_ACCEPT_PATH`, owned by `@starter/auth/invitation` and
  // re-exported from `app/lib/auth-redirects.ts`. The invitation email links
  // straight here, so a drift between the two is a link that 404s in a mailbox
  // where nothing can report it — `tests/e2e/invitations.spec.ts` walks the
  // constant for exactly that reason.
  route("accept-invitation", "routes/accept-invitation.tsx"),
  layout("routes/dashboard.tsx", [
    route("dashboard", "routes/dashboard._index.tsx"),
    route("dashboard/members", "routes/dashboard.members.tsx"),
    route("dashboard/settings", "routes/dashboard.settings.tsx"),
  ]),
  // The catch-all, kept last for readability rather than for correctness.
  // Declaration order does **not** decide what matches: React Router ranks
  // branches by specificity and `computeScore` docks a splat by `splatPenalty`
  // (-2), so a static route declared below this line still wins its own path.
  // Verified by moving this entry to the top and watching `/login` render as
  // itself. Reordering therefore fixes nothing — if a page is being swallowed,
  // the cause is elsewhere.
  //
  // It sees browser paths, and that is enforced rather than assumed.
  // `/api/auth/**` and `/api/v1/*` are answered by Hono in `server/index.ts`
  // first, and a hostname this Worker was not configured for is refused above
  // that again (`server/origins.ts`). The adapter installs React Router *after*
  // the Hono app, so anything Hono leaves unanswered arrives here — which is
  // why `apiApp` ends in a terminal `all("*")` returning JSON. Without it an
  // authenticated miss on an unknown `/api/v1` path served an API client this
  // page.
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
