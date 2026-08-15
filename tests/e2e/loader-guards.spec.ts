import { test, expect } from "@playwright/test";

/**
 * Audit #10, tested at the vector rather than at the helper.
 *
 * `requireUser` has unit tests, but those pass whether or not a loader calls it.
 * The defect #10 describes is a **child** loader being fetched directly — React
 * Router's single-fetch `.data` endpoint hits one route's loader without its
 * parent's redirect ever applying. Reverting `dashboard.settings.tsx` to
 * `return { user: null, tokens: [] }` would leave every other test in this repo
 * green, so this is the test that holds the finding closed.
 *
 * The status code is not the assertion. An unauthenticated `.data` request
 * answers **202**, with the redirect encoded in the single-fetch payload —
 * checking for a 302, or merely "not 200", would pass without proving anything.
 */

/**
 * Single fetch resolves every matched loader in one request, and **any** loader
 * redirecting short-circuits the whole payload. So a plain `.data` request is
 * satisfied by the dashboard *layout's* guard, and would keep passing with the
 * child wide open — vacuous for the finding it is meant to hold closed.
 *
 * `?_routes=` is the vector: it asks for one route's loader by id, without its
 * parent. That is the request a child guard has to answer on its own.
 */
const CHILD_ONLY = [
  "/dashboard/settings.data?_routes=routes%2Fdashboard.settings",
  // `_index` guards even though it returns nothing today, because it is the
  // template the next dashboard page is copied from. Without its own
  // child-only case, removing that guard leaves this suite and CI green.
  "/dashboard.data?_routes=routes%2Fdashboard._index",
  // Members reads one tenant's people and invited addresses. Its loader
  // resolves the organization from the session, so an unauthenticated caller
  // has no organization to be scoped to — which is a redirect, not an empty
  // list (#36).
  "/dashboard/members.data?_routes=routes%2Fdashboard.members",
];

const DATA_ROUTES = [
  "/dashboard.data",
  "/dashboard/settings.data",
  "/dashboard/members.data",
  ...CHILD_ONLY,
];

test.describe("dashboard loaders refuse an unauthenticated caller", () => {
  for (const route of DATA_ROUTES) {
    test(`${route} redirects to /login instead of returning data`, async ({ request }) => {
      const res = await request.get(route);
      const body = await res.text();

      expect(body).toContain("SingleFetchRedirect");
      expect(body).toContain("/login");
    });

    test(`${route} leaks no user fields`, async ({ request }) => {
      const body = await (await request.get(route)).text();

      // The shapes these loaders return when they do answer. `organizationId`
      // covers two of them at once: the layout's `activeOrganizationId` and the
      // members loader's own `organizationId`.
      expect(body).not.toContain("emailVerified");
      expect(body).not.toContain("@example.com");
      expect(body).not.toContain("organizationId");
      expect(body).not.toContain("tokens");
    });
  }

  for (const route of ["/dashboard/settings", "/dashboard/members"]) {
    test(`the HTML route ${route} redirects too`, async ({ request }) => {
      const res = await request.get(route, { maxRedirects: 0 });

      expect(res.status()).toBe(302);
      expect(res.headers()["location"]).toContain("/login");
    });
  }
});
