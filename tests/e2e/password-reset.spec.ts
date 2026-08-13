import { test, expect, type Page } from "@playwright/test";
import { PASSWORD_RESET_REDIRECT } from "../../apps/web/app/lib/auth-redirects";
import { clientIp, markEmailVerified, readPasswordResetToken, waitForHydration } from "./helpers";

/**
 * Forgot-password, end to end — issue #20.
 *
 * The reset endpoints were wired and rate-limited long before any screen used
 * them (`docs/security-audit.md` #2, "Still open from the related gap"), so
 * what is unproven here is the *journey*: that the login page offers a way in,
 * that the emailed link resolves to a page that can use it, and that the token
 * is single-use once it has been spent.
 *
 * **Every describe carries its own client address.** `/request-password-reset`
 * and `/sign-up/email` are both in the strict `mail` class — three per minute
 * per IP — and this file makes seven such calls. One shared address would have
 * the later specs failing with 429s that look nothing like their cause.
 */

const PASSWORD = "originalpassword123";
const NEW_PASSWORD = "replacementpassword456";

/**
 * Better Auth's own reset link, exactly as `sendResetPassword` mints it.
 *
 * `callbackURL` comes from the **real constant**, not a literal. That is what
 * makes this walk a coupling check rather than a decoration: if
 * `PASSWORD_RESET_REDIRECT` and the `reset-password` entry in `routes.ts` ever
 * disagree, production mail 302s to a 404 — and so does this, so the form
 * assertion that follows fails. Hard-coded, the spec would pass through the
 * drift it exists to catch.
 */
function resetLinkFor(token: string) {
  return `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(PASSWORD_RESET_REDIRECT)}`;
}

async function register(page: Page, user: { name: string; email: string }) {
  await page.goto("/register");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible({
    timeout: 15000,
  });
  await waitForHydration(name);

  await name.fill(user.name);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
    timeout: 10000,
  });
}

async function requestReset(page: Page, email: string) {
  await page.goto("/forgot-password");
  const field = page.getByRole("textbox", { name: "Email", exact: true });
  await expect(page.getByRole("button", { name: "Send Reset Link" })).toBeVisible({
    timeout: 15000,
  });
  await waitForHydration(field);

  await field.fill(email);
  await page.getByRole("button", { name: "Send Reset Link" }).click();
}

async function setNewPassword(page: Page, password: string) {
  const field = page.getByLabel("New Password", { exact: true });
  await expect(field).toBeVisible({ timeout: 10000 });
  await waitForHydration(field);

  await field.fill(password);
  await page.getByLabel("Confirm Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Set New Password" }).click();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  const field = page.getByRole("textbox", { name: "Email", exact: true });
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 15000 });
  await waitForHydration(field);

  await field.fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

/* ------------------------------------------------------------------------- */

test.describe("the reset screen refuses a link it cannot use", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("a bare visit gets the dead-link notice, not a password form", async ({ page }) => {
    await page.goto("/reset-password");

    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible({
      timeout: 15000,
    });
    // The point is the absent form: offering one here wastes the reader's time
    // and then answers INVALID_TOKEN, which reads as "my password was rejected".
    await expect(page.getByLabel("New Password", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
  });

  test("better-auth's INVALID_TOKEN redirect gets the same notice", async ({ page }) => {
    await page.goto("/reset-password?error=INVALID_TOKEN");

    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByLabel("New Password", { exact: true })).toHaveCount(0);
  });

  test("an expired token is refused before the form is ever shown", async ({ page }) => {
    // No such verification row exists, which is also what an expired one looks
    // like: better-auth's GET callback treats "missing" and "past expiry"
    // identically and redirects with the same error.
    await page.goto(resetLinkFor("expired-or-never-existed"));

    await expect(page).toHaveURL(/\/reset-password\?error=INVALID_TOKEN/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
  });

  /**
   * Asserts the **sentence**, not merely that an alert appeared.
   *
   * A rejected password and a dead link are both 400, and the first cut of this
   * screen gave them one message — so someone whose password was refused was
   * told to fetch a new link, which could never help. `resetErrorMessage` maps
   * the server's own code, and this is what proves it is wired to the real
   * response rather than to a guess about the status.
   *
   * The password-length codes are deliberately **not** exercised here: the
   * field carries `minLength`/`maxLength`, so a browser cannot submit a value
   * that trips them — Playwright's own `fill` is truncated by `maxLength` too,
   * which is how an earlier version of this test fooled itself into passing a
   * dead-link assertion. They stay covered by
   * `apps/web/app/__tests__/reset-password-errors.test.ts`, and remain reachable
   * in production only if `emailAndPassword.minPasswordLength` is configured
   * away from the attributes the form mirrors.
   */
  test("a forged token reaching the form is refused as a dead link", async ({ page }) => {
    // Straight to the form with a token the server never minted — the vector a
    // client-side-only check would miss.
    await page.goto("/reset-password?token=forged-token-value");

    await setNewPassword(page, NEW_PASSWORD);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText("no longer valid");
    await expect(page).toHaveURL(/\/reset-password/);
  });
});

test.describe("requesting a reset does not confirm whether the address exists", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  test("an address with no account gets the same notice a real one would", async ({ page }) => {
    await requestReset(page, `nobody-${Date.now()}@example.com`);

    // Identical to what the end-to-end spec below sees for a real account. The
    // wording is conditional on purpose — better-auth answers 200 either way
    // and simulates the token work to level the timing, so the UI is the only
    // place left that could leak the answer.
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/If an account exists/)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("a reset carries a user from the login page back into the app", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  const USER = { name: "E2E Reset User", email: `e2e-reset-${Date.now()}@example.com` };
  let token: string;

  test("the login page offers a way in, and the request is accepted", async ({ page }) => {
    await register(page, USER);
    markEmailVerified(USER.email);

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 15000 });
    // The entry point issue #20 is actually about.
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.waitForURL("**/forgot-password", { timeout: 10000 });

    const field = page.getByRole("textbox", { name: "Email", exact: true });
    await waitForHydration(field);
    await field.fill(USER.email);
    await page.getByRole("button", { name: "Send Reset Link" }).click();

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10000,
    });

    token = readPasswordResetToken(USER.email);
    expect(token).toBeTruthy();
  });

  test("the emailed link lands on the app origin with a usable token", async ({
    page,
    baseURL,
  }) => {
    // The real link, driven through better-auth's own GET callback rather than
    // jumping to `/reset-password?token=` — that redirect is what resolves the
    // callback against `BETTER_AUTH_URL`, and it is the whole reason a
    // split-origin deployment lands the reader on the app host.
    await page.goto(resetLinkFor(token));

    await page.waitForURL(`**${PASSWORD_RESET_REDIRECT}?token=${token}`, { timeout: 15000 });
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
    // The form, not the card title — `CardTitle` renders a plain `<div>`, so it
    // carries no heading role to select by. The usable field is the stronger
    // assertion anyway: it is what "a usable token" actually means here.
    await expect(page.getByLabel("New Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set New Password" })).toBeVisible();
  });

  test("the new password is set and signs the user in", async ({ page }) => {
    await page.goto(`${PASSWORD_RESET_REDIRECT}?token=${token}`);
    await setNewPassword(page, NEW_PASSWORD);

    await page.waitForURL("**/login", { timeout: 15000 });

    await signIn(page, USER.email, NEW_PASSWORD);
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    await expect(page.getByRole("heading", { name: "Welcome to your dashboard" })).toBeVisible();
  });

  test("the old password no longer works", async ({ page }) => {
    await signIn(page, USER.email, PASSWORD);

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("the spent token cannot be used a second time", async ({ page }) => {
    // `resetPassword` consumes the verification row, so better-auth's GET
    // callback can no longer find it and refuses before the form renders.
    await page.goto(resetLinkFor(token));

    await expect(page).toHaveURL(/\/reset-password\?error=INVALID_TOKEN/, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
    await expect(page.getByLabel("New Password", { exact: true })).toHaveCount(0);
  });
});

test.describe("a reset revokes the sessions that outlived it", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /**
   * The deny path for `revokeSessionsOnPasswordReset`. Better Auth defaults it
   * to `false`, and with the default a cookie minted before the reset keeps
   * working for its full lifetime — so someone resetting *because* another
   * person is in their account would change the password and change nothing
   * else. Asserted from a second browser context, since that is the shape the
   * attacker's session actually has.
   */
  test("a session from before the reset is dead afterwards", async ({ page, request }) => {
    const user = { name: "E2E Revoke User", email: `e2e-revoke-${Date.now()}@example.com` };

    await register(page, user);
    markEmailVerified(user.email);
    await signIn(page, user.email, PASSWORD);
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Reset from somewhere else entirely — `request` has its own cookie jar.
    await request.post("/api/auth/request-password-reset", {
      data: { email: user.email, redirectTo: PASSWORD_RESET_REDIRECT },
    });
    const token = readPasswordResetToken(user.email);
    const reset = await request.post("/api/auth/reset-password", {
      data: { newPassword: NEW_PASSWORD, token },
    });
    expect(reset.ok()).toBe(true);

    // The still-open browser session must not survive it.
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 15000 });
  });
});

test.describe("a reset is not proof of the address", () => {
  test.use({ extraHTTPHeaders: { "cf-connecting-ip": clientIp() } });

  /**
   * Deliberate, not a gap. Following the link proves inbox control, but
   * `requireEmailVerification` is audit #2's gate and a reset does not widen
   * what satisfies it (`packages/auth/src/server.ts`). The journey still
   * completes — `/login` answers `EMAIL_NOT_VERIFIED` with the verification
   * notice and its resend — it just takes the extra step.
   */
  test("an unverified account still has to verify after resetting", async ({ page, request }) => {
    const user = { name: "E2E Unverified User", email: `e2e-unverified-${Date.now()}@example.com` };

    await register(page, user);
    // Deliberately no markEmailVerified.

    await request.post("/api/auth/request-password-reset", {
      data: { email: user.email, redirectTo: PASSWORD_RESET_REDIRECT },
    });
    const token = readPasswordResetToken(user.email);
    const reset = await request.post("/api/auth/reset-password", {
      data: { newPassword: NEW_PASSWORD, token },
    });
    expect(reset.ok()).toBe(true);

    await signIn(page, user.email, NEW_PASSWORD);

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible({
      timeout: 10000,
    });
    await expect(page).not.toHaveURL(/dashboard/);
  });
});
