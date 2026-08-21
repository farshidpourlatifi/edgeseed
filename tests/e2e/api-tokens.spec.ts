import { test, expect } from "@playwright/test";
import {
  clientIp,
  markEmailVerified,
  waitForHydration,
  watchForHydrationFailures,
} from "./helpers";

/**
 * The only cookie-authenticated write in the app, driven through a real browser.
 *
 * It exists because the CSRF guard is easy to get wrong in the direction that
 * looks fine: `hono/csrf` ignored `application/json` entirely, so the write was
 * unprotected while every test passed. The replacement checks all unsafe
 * methods, which means the opposite mistake — refusing a legitimate same-origin
 * write — is now the live risk. Only a real browser sends the headers that
 * distinguish the two, so a unit test cannot cover this.
 *
 * See `docs/security-audit.md` #15.
 */

const USER = {
  name: "E2E Token User",
  email: `e2e-tokens-${Date.now()}@example.com`,
  password: "testpassword123",
};

/**
 * Its own client address, so this file's sign-up and sign-in draw on their own
 * rate-limit budget rather than sharing one with every other spec (`clientIp`
 * in `helpers.ts` explains why the header is needed at all).
 */
test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

test.describe("api tokens", () => {
  test.describe.configure({ mode: "serial" });

  test("creates and revokes a token from the settings page", async ({ page }) => {
    await page.goto("/register");

    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toBeVisible({ timeout: 15000 });
    await waitForHydration(name);

    await name.fill(USER.name);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(USER.email);
    await page.getByLabel("Password", { exact: true }).fill(USER.password);
    await page.getByLabel("Confirm Password", { exact: true }).fill(USER.password);
    await page.getByRole("button", { name: "Create Account" }).click();

    // Verification gates the session, so prove the address then sign in.
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 15000 });
    markEmailVerified(USER.email);

    await page.goto("/login");
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    await waitForHydration(email);
    await email.fill(USER.email);
    await page.getByLabel("Password", { exact: true }).fill(USER.password);
    await page.getByRole("button", { name: "Sign In" }).click();

    // Wait for the session to land before navigating — otherwise `requireUser`
    // on the settings loader redirects straight back to /login.
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    /**
     * `/dashboard/settings` is the **second** page that renders dates through
     * `app/lib/format-date.ts`, and the one the original defect reached without
     * anyone noticing — the members list got the fix and this list kept the bug.
     *
     * The suite-wide `en-GB`/UTC+14 pins make a hydration mismatch here
     * possible to observe; only a listener makes it observed. Without this, a
     * call site reverting to `toLocaleDateString(undefined, …)` would render
     * "15 Aug 2026", React would discard the server's markup, and every
     * assertion in this test would still pass, because none of them look at a
     * date.
     */
    const hydrationFailures = watchForHydrationFailures(page);

    await page.goto("/dashboard/settings");

    const tokenName = page.getByLabel("Token name", { exact: true });
    await expect(tokenName).toBeVisible({ timeout: 15000 });
    await waitForHydration(tokenName);

    // The POST: a same-origin JSON write carrying only the session cookie.
    await tokenName.fill("e2e token");
    await page.getByRole("button", { name: "Create token" }).click();

    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible({ timeout: 15000 });

    // The server's pinned rendering — "Aug 15, 2026", never the "15 Aug 2026"
    // this `en-GB` browser would produce on its own. Asserting the shape is
    // what gives the pin something to catch on this page.
    await expect(page.getByText(/created [A-Z][a-z]{2} \d{1,2}, \d{4}/)).toBeVisible({
      timeout: 15000,
    });
    expect(hydrationFailures()).toEqual([]);

    // The DELETE: a bodyless same-origin write, which sends no content-type.
    await page.getByRole("button", { name: "Dismiss" }).click();
    await page.getByRole("button", { name: "Revoke" }).click();

    await expect(page.getByText("No active tokens.")).toBeVisible({ timeout: 15000 });

    /**
     * The refusal side, driven through `page.request` so it shares the session
     * cookie without being issued by the page itself.
     *
     * It cannot be done with `page.evaluate` + `fetch`: `Sec-Fetch-Site` is a
     * forbidden header name, so page script cannot set it and the browser
     * stamps the true `same-origin` regardless — the guard then correctly allows
     * the request. That unforgeability is precisely why it is the primary
     * signal, and why faking this case has to come from outside the page.
     */
    const foreignOrigin = await page.request.post("/api/v1/tokens", {
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      data: { name: "forged" },
      failOnStatusCode: false,
    });
    expect(foreignOrigin.status()).toBe(403);

    // No origin signal at all — nothing vouched for this write.
    const noSignal = await page.request.post("/api/v1/tokens", {
      headers: { "content-type": "application/json" },
      data: { name: "forged" },
      failOnStatusCode: false,
    });
    expect(noSignal.status()).toBe(403);

    // Neither forged write created anything.
    await page.reload();
    await expect(page.getByText("No active tokens.")).toBeVisible({ timeout: 15000 });
  });
});
