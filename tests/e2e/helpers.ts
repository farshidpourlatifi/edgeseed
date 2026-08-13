import { execSync } from "node:child_process";
import { expect, type Locator } from "@playwright/test";

/**
 * Address D1 by its **binding**, never by `database_name` — the name is
 * `<slug>-db` and `init:product` rewrites it, so a suite naming the starter's
 * database goes red in every clone. Same constant, same reason, as
 * `packages/cli/src/lib/d1-binding.ts`; restated rather than imported because
 * this suite deliberately does not depend on `@starter/cli`.
 */
const D1_BINDING = "DB";

/**
 * Mark an address verified directly in the local D1.
 *
 * The verification link is a signed token delivered by email, and with no
 * `RESEND_API_KEY` in CI the message is only written to the dev server's log —
 * which a Playwright test cannot read. Flipping the column is the seam that
 * keeps the rest of the journey (register → refused → verified → in) testable.
 *
 * Local-only by construction: same `--local` invocation the seed uses.
 */
export function markEmailVerified(email: string) {
  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--command "UPDATE user SET emailVerified = 1 WHERE email = '${email}'"`,
    { stdio: "pipe" },
  );
}

/**
 * Read the pending password-reset token for `email` out of the local D1.
 *
 * Same seam as `markEmailVerified`, for the same reason: the reset link is
 * delivered by email, and with no `RESEND_API_KEY` in CI the message only
 * reaches the dev server's log. Without this the whole second half of the
 * journey — follow the link, set a password, sign in with it — is unreachable
 * from a browser.
 *
 * It reads rather than writes, which matters: the test then drives the **real**
 * `GET /api/auth/reset-password/:token` and lets better-auth mint the redirect,
 * so the origin it resolves against and the token's single-use behaviour are
 * exercised rather than simulated. The callback the spec sends comes from
 * `PASSWORD_RESET_REDIRECT` itself — hard-coding it there would let the
 * constant drift away from `routes.ts` with the suite still green.
 *
 * `verification.identifier` is `reset-password:<token>` and `value` is the
 * user id (better-auth `api/routes/password.mjs`), so the row is found by
 * joining back to `user`. Newest first, since nothing purges consumed or
 * expired rows (`docs/security-audit.md` #12) and an address can have several.
 */
export function readPasswordResetToken(email: string): string {
  const sql =
    `SELECT identifier FROM verification ` +
    `WHERE value = (SELECT id FROM user WHERE email = '${email}') ` +
    `AND identifier LIKE 'reset-password:%' ` +
    `ORDER BY expiresAt DESC LIMIT 1`;

  const output = execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--json --command "${sql}"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  // wrangler prefixes the JSON with human-readable lines, so parse from the
  // first bracket rather than trusting the whole of stdout to be JSON.
  const parsed = JSON.parse(output.slice(output.indexOf("[")));
  const identifier: string | undefined = parsed?.[0]?.results?.[0]?.identifier;

  if (!identifier) {
    throw new Error(
      `No pending password-reset token for ${email}. The request either never ` +
        `reached better-auth or the address does not exist in the local D1.`,
    );
  }

  return identifier.replace("reset-password:", "");
}

/**
 * Give `email` an organization it owns, directly in the local D1.
 *
 * The app has no way to create one — that is the whole point of issue #16, and
 * building it is the Organizations epic (#24). But `OrganizationSwitcher`
 * renders nothing until the user has at least one org, so without this seam
 * the switcher and its disabled "Create organization" item are unreachable
 * from a browser and cannot be tested at all.
 *
 * Mirrors the shape `packages/cli/src/db-seed.ts` writes, and is `--local`
 * only for the same reason.
 */
export function giveOrganization(email: string, slug: string, name: string) {
  const orgId = `e2e-org-${slug}`;
  const sql = [
    `INSERT OR IGNORE INTO organization (id, name, slug, createdAt) ` +
      `VALUES ('${orgId}', '${name}', '${slug}', unixepoch());`,
    `INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt) ` +
      `SELECT '${orgId}-member', '${orgId}', id, 'owner', unixepoch() FROM user WHERE email = '${email}';`,
  ].join(" ");

  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local --command "${sql}"`,
    { stdio: "pipe" },
  );
}

/**
 * A client address unique to this call, for `cf-connecting-ip`.
 *
 * Auth rate limiting keys on that header (audit #4, #11), and nothing sets it
 * locally: the dev server runs under Vite, not behind Cloudflare, so without
 * one every request in the suite shares a single bucket and the specs start
 * throttling each other. Sending it simulates what the edge adds — and it is
 * only possible locally, since Cloudflare overwrites the header at the edge.
 *
 * Unique per call, not a constant, because buckets outlive a test run: they
 * live in the dev server's memory, `db:reset` does not touch them, and
 * `reuseExistingServer` keeps that server across local re-runs. A fixed address
 * would make the second run of the day fail.
 *
 * Drawn from the whole of CGNAT space (RFC 6598 reserves `100.64.0.0/10`, so it
 * cannot be mistaken for a real client) rather than the single `/16` this used
 * to sample. That is 4.2 million addresses instead of 65 thousand: with a
 * couple of dozen buckets
 * alive at once across a run and its predecessor, a collision would surface as
 * an unrelated spec failing with a 429 — the kind of once-in-a-thousand-runs
 * flake nobody would connect back to here.
 */
export function clientIp(): string {
  const byte = () => Math.floor(Math.random() * 256);
  // 100.64.x.x through 100.127.x.x — the /10's full second-octet range.
  return `100.${64 + Math.floor(Math.random() * 64)}.${byte()}.${byte()}`;
}

/** Every rate-limit rule uses a 60s window; miniflare aligns it to wall-clock. */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Wait, if needed, until the current rate-limit window has room left to run a
 * counting sequence inside it.
 *
 * Locally the limiter is miniflare's, and it is a **fixed** window keyed on
 * `Math.floor(Date.now() / 60000)` that calls `buckets.clear()` — every key,
 * not just one — the moment that value changes. So a test that fires its
 * eleventh request just after a wall-clock minute boundary counts from zero
 * again and never sees the 429 it is asserting on. It failed exactly that way
 * once before this guard existed.
 *
 * Cheap: it only sleeps in the last few seconds of a window, so most runs pay
 * nothing, and the worst case is `headroomMs`.
 */
export async function awaitRateLimitWindow(headroomMs = 5_000) {
  const remaining = RATE_LIMIT_WINDOW_MS - (Date.now() % RATE_LIMIT_WINDOW_MS);
  if (remaining >= headroomMs) return;
  await new Promise((resolve) => setTimeout(resolve, remaining + 100));
}

/**
 * Resolve once React has hydrated `target`.
 *
 * Server-rendered markup looks interactive long before React attaches to it:
 * the input is visible, enabled and editable, so Playwright's actionability
 * checks pass and it starts filling. If the client takes over mid-action React
 * can replace the node ("element was detached from the DOM, retrying") or reset
 * a controlled input's value, which submits the form with empty fields.
 *
 * React precaches a `__reactFiber$*` key on every DOM node it owns as it
 * hydrates, so that key appearing on a leaf node means the handover reached it.
 * `locator.evaluate` re-resolves the element on each poll, so this is safe even
 * while the node is being swapped out.
 */
export async function waitForHydration(target: Locator, timeout = 15_000) {
  await expect
    .poll(
      () => target.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))),
      { timeout, message: "React never hydrated the element — it is still inert SSR markup" },
    )
    .toBe(true);
}
