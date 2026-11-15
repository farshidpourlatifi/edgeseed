/**
 * Product-owned: the starter ships this file once and does not edit it again,
 * so changing it never conflicts with a starter update.
 *
 * The route module rendered at `/dashboard`, as a path relative to `app/`. To
 * replace the home, put your module in `app/product/` and name it here.
 *
 * The module renders inside the dashboard layout, which supplies the sidebar
 * and the first-run organization card. Its loader must call `requireUser`
 * itself: the layout loader is not a security boundary, and
 * `tests/e2e/loader-guards.spec.ts` requests this module without its parent.
 *
 * No imports here: `app/routes.ts` and Playwright both load this file in Node.
 */
export const DASHBOARD_HOME_ROUTE = "routes/dashboard._index.tsx";
