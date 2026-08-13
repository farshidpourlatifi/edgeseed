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
  layout("routes/dashboard.tsx", [
    route("dashboard", "routes/dashboard._index.tsx"),
    route("dashboard/settings", "routes/dashboard.settings.tsx"),
  ]),
] satisfies RouteConfig;
