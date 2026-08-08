import { test, expect } from "@playwright/test";

/**
 * Header assertions against the running app, so a middleware that stops being
 * mounted fails here rather than in production. The unit tests in
 * `apps/web/server/__tests__/security-headers.test.ts` cover the policy's
 * contents; this covers it actually reaching the wire.
 *
 * See `docs/security-audit.md` #5 and #14.
 */

test("login page ships the security headers", async ({ request }) => {
  const res = await request.get("/login");
  const headers = res.headers();

  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("every response carries a fresh CSP nonce", async ({ request }) => {
  const nonceOf = async () => {
    const csp = (await request.get("/login")).headers()["content-security-policy"];
    return /'nonce-([^']+)'/.exec(csp)?.[1];
  };

  const first = await nonceOf();
  expect(first).toBeTruthy();
  expect(await nonceOf()).not.toBe(first);
});

test("the CSP never admits unsafe-inline for scripts", async ({ request }) => {
  const csp = (await request.get("/login")).headers()["content-security-policy"];
  const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? "";

  expect(scriptSrc).not.toContain("unsafe-inline");
  expect(scriptSrc).not.toContain("unsafe-eval");
});

/**
 * The assertion that matters most and is easiest to lose: a CSP that blocks the
 * hydration scripts does not error, it just leaves a dead page. Interacting
 * with a client-only control proves React actually attached.
 */
test("the CSP does not block hydration", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15000 });

  // Radix only opens this once React has hydrated.
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.getByRole("menuitem", { name: "Light" })).toBeVisible();

  expect(violations).toEqual([]);
});

test("api responses for a signed-out caller are not marked no-store", async ({ request }) => {
  const res = await request.get("/api/v1/health");
  expect(res.headers()["cache-control"]).toBeUndefined();
});
