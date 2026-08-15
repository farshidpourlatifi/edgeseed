import { test, expect } from "@playwright/test";
import { clientIp, markEmailVerified } from "./helpers";

/**
 * The branded 404 (issue #48), asserted on the two things a browser render
 * cannot tell you apart from a working page.
 *
 * **The status code is the assertion that matters.** A page that says "not
 * found" and answers 200 looks identical in a browser and is wrong for every
 * crawler, monitor and link checker — and it is the exact regression a splat
 * route invites, because the route renders happily whether or not its loader
 * carries `data(null, { status: 404 })`. Dropping that call leaves the visual
 * assertions below green.
 *
 * The path is unique per run so it can never collide with a route somebody
 * adds later, which would turn this into a test of that page instead.
 */
const UNKNOWN_PATH = `/no-such-page-${Date.now().toString(36)}`;

test("an unknown URL answers 404", async ({ request }) => {
  const res = await request.get(UNKNOWN_PATH);

  expect(res.status()).toBe(404);
  // HTML, not the Worker's plain-text origin refusal — that one is a security
  // boundary and deliberately stays unbranded (server/origins.ts).
  expect(res.headers()["content-type"]).toContain("text/html");
});

test("an unknown URL renders the branded page with a working way home", async ({ page }) => {
  await page.goto(UNKNOWN_PATH);

  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page.getByText("404", { exact: true })).toBeVisible();

  const goHome = page.getByRole("link", { name: "Go home" });
  await expect(goHome).toBeVisible();

  await goHome.click();
  await page.waitForURL("**/");
  // The landing page, reached through a document request — `reloadDocument` is
  // what makes this link correct in split-origin mode too (docs/domains.md).
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

test("the 404 page asks not to be indexed", async ({ page }) => {
  await page.goto(UNKNOWN_PATH);

  await expect(page).toHaveTitle(/^404 — /);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
});

/**
 * The API namespace never serves the page — at the **full adapter**, which is
 * the only place this is observable.
 *
 * `hono-react-router-adapter` installs React Router as a middleware *after* the
 * Hono app, so anything the Hono side does not answer reaches the browser splat.
 * An authenticated `/api/v1` miss passes the default-deny guard and matches no
 * route, which put it exactly there until `apiApp` grew a terminal 404. A unit
 * test on `apiApp` cannot see this: React Router is not in that composition.
 *
 * It needs a **real principal** — the anonymous case is answered 401 by the deny
 * guard and never gets far enough to prove anything. Driven through the HTTP API
 * rather than a browser, since a session cookie is a principal and the request
 * fixture carries it across calls.
 */
test.describe("the API namespace never falls through to the page", () => {
  const USER = {
    name: "E2E NotFound User",
    email: `e2e-notfound-${Date.now()}@example.com`,
    password: "testpassword123",
  };

  // Its own client address, or this file's sign-up shares a rate-limit budget
  // with every other spec — `/sign-up/email` allows three a minute (helpers.ts).
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("an authenticated unknown /api/v1 path answers JSON, not the branded page", async ({
    request,
  }) => {
    const signUp = await request.post("/api/auth/sign-up/email", {
      data: USER,
      failOnStatusCode: false,
    });
    expect(signUp.ok()).toBe(true);

    // Verification gates the session (ADR 003), so prove the address first.
    markEmailVerified(USER.email);

    const signIn = await request.post("/api/auth/sign-in/email", {
      data: { email: USER.email, password: USER.password },
      failOnStatusCode: false,
    });
    expect(signIn.ok()).toBe(true);

    // Sanity: the cookie really is a principal, or the miss below would be a
    // vacuous 401 dressed up as a pass.
    const me = await request.get("/api/v1/me", { failOnStatusCode: false });
    expect(me.status()).toBe(200);

    const miss = await request.get("/api/v1/no-such-endpoint", { failOnStatusCode: false });

    expect(miss.status()).toBe(404);
    // The assertion that matters. Status and content type were 404/HTML before
    // the terminal handler too — only the body distinguishes an API answer from
    // the page, which is why this checks the body.
    expect(miss.headers()["content-type"]).toContain("application/json");
    expect(await miss.json()).toEqual({ error: "Not Found" });
  });
});
