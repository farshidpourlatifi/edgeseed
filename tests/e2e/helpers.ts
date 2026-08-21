import { execSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Address D1 by its **binding**, never by `database_name` — the name is
 * `<slug>-db` and `init:product` rewrites it, so a suite naming the starter's
 * database goes red in every clone. Same constant, same reason, as
 * `packages/cli/src/lib/d1-binding.ts`; restated rather than imported because
 * this suite deliberately does not depend on `@starter/cli`.
 */
const D1_BINDING = "DB";

/**
 * Mark one address — or a whole batch — verified directly in the local D1.
 *
 * The verification link is a signed token delivered by email, and with no
 * `RESEND_API_KEY` in CI the message is only written to the dev server's log —
 * which a Playwright test cannot read. Flipping the column is the seam that
 * keeps the rest of the journey (register → refused → verified → in) testable.
 *
 * **Take the array form when seeding more than one account.** Every helper in
 * this file spawns `pnpm → wrangler → miniflare`, which costs seconds rather
 * than milliseconds, and a `beforeAll` that calls this once per account pays
 * that toll per account. `members.spec.ts` did, and its hook ran out the 30s
 * Playwright allows a hook the moment a second heavy spec ran ahead of it in
 * CI — a timeout whose aftermath ("browser context closed") reads nothing like
 * its cause.
 *
 * Local-only by construction: same `--local` invocation the seed uses.
 */
export function markEmailVerified(email: string | string[]) {
  const list = (Array.isArray(email) ? email : [email]).map((one) => `'${one}'`).join(", ");

  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--command "UPDATE user SET emailVerified = 1 WHERE email IN (${list})"`,
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
 * Read the pending invitation for `email` out of the local D1.
 *
 * The same seam as `readPasswordResetToken`, for the same reason: the
 * invitation link is delivered by email, and with no `RESEND_API_KEY` the
 * message only reaches the dev server's log, which Playwright cannot read.
 *
 * It returns the **id**, not a URL, on purpose. The spec builds the link from
 * `INVITATION_ACCEPT_PATH` itself — so if that constant and the
 * `accept-invitation` entry in `routes.ts` ever disagree, the spec walks into
 * the branded 404 the same way a real invitee would, and its assertions fail.
 * Returning a ready-made URL here would make that walk decorative.
 *
 * Newest first: nothing purges accepted or expired rows
 * (`docs/security-audit.md` #12), and an address can hold several across a run.
 */
export function readInvitationId(email: string): string {
  const sql =
    `SELECT id FROM invitation WHERE email = '${email.toLowerCase()}' ` +
    `ORDER BY expiresAt DESC LIMIT 1`;

  const output = execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--json --command "${sql}"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  const parsed = JSON.parse(output.slice(output.indexOf("[")));
  const id: string | undefined = parsed?.[0]?.results?.[0]?.id;

  if (!id) {
    throw new Error(
      `No invitation for ${email}. The invite either never reached better-auth ` +
        `or it was rejected — check the response of the invite-member call.`,
    );
  }

  return id;
}

/**
 * Force an invitation into a terminal state, directly in the local D1.
 *
 * Expiry is unreachable from a browser inside one test run — the window is
 * seven days. Writing the column is the same shortcut `markEmailVerified`
 * takes, and it exercises the real refusal — better-auth reads `status` and
 * `expiresAt` on every accept, so the screen under test is reached the way
 * production reaches it.
 *
 * Revocation *is* reachable now (`member-actions.spec.ts` drives the real
 * control), so `revokeInvitation` below is a shortcut rather than the only way
 * in — use it when a spec needs a revoked invitation to exist before testing
 * something else, not when revoking is the subject.
 */
export function expireInvitation(id: string) {
  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--command "UPDATE invitation SET expiresAt = unixepoch() - 60 WHERE id = '${id}'"`,
    { stdio: "pipe" },
  );
}

/**
 * Pull an invitation's expiry in to an hour from now — still pending, still
 * usable, just closer to the edge.
 *
 * What makes "resend extends the expiry" an assertion rather than a formality.
 * The window is seven days and SQLite stores whole seconds, so an invitation
 * created and resent inside the same second comes back with a byte-identical
 * `expiresAt` and `toBeGreaterThan` fails on a resend that worked perfectly.
 *
 * Deliberately **not** `expireInvitation`: better-auth's `findPendingInvitation`
 * filters expired rows out, so resending past one creates a *second*
 * invitation with a new id — the opposite of what the test is about.
 */
export function shortenInvitation(id: string) {
  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--command "UPDATE invitation SET expiresAt = unixepoch() + 3600 WHERE id = '${id}'"`,
    { stdio: "pipe" },
  );
}

/** Same seam as `expireInvitation`, for the state a revoke would leave behind. */
export function revokeInvitation(id: string) {
  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--command "UPDATE invitation SET status = 'canceled' WHERE id = '${id}'"`,
    { stdio: "pipe" },
  );
}

/**
 * An invitation's `status` and `expiresAt`, straight from D1.
 *
 * What proves a **resend** did what better-auth says it does: the row keeps its
 * id and only `expiresAt` moves, so the link already in somebody's mailbox goes
 * on working. Read from the database rather than from the screen because the
 * page renders a date and the window is seven days — resending twice on the
 * same day moves the column without moving a pixel.
 *
 * It is also how a revoke is asserted, since `status = 'canceled'` is the whole
 * of what changes and the row simply leaves the pending list afterwards.
 */
export function invitationRow(id: string): { status: string; expiresAt: number } {
  const output = execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--json --command "SELECT status, expiresAt FROM invitation WHERE id = '${id}'"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  const row = JSON.parse(output.slice(output.indexOf("[")))?.[0]?.results?.[0];
  if (!row) throw new Error(`No invitation ${id} in the local D1.`);

  return { status: row.status, expiresAt: Number(row.expiresAt) };
}

/**
 * The row id of the organization with `slug`, or `null` when there is none.
 *
 * For organizations the product created rather than the seed helpers: better-auth
 * mints the id, so `e2e-org-<slug>` — the shape `giveOrganization` writes and
 * every helper below derives — is simply wrong for them, and a test that guessed
 * it would read an absent row as "not a member" and pass for the wrong reason.
 *
 * The slug is the handle a spec already controls, since the create dialog takes
 * it, so this is the one lookup that turns a driven flow back into an id the
 * API and MCP deny paths can aim at.
 */
export function organizationIdOf(slug: string): string | null {
  const output = execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--json --command "SELECT id FROM organization WHERE slug = '${slug}'"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  return JSON.parse(output.slice(output.indexOf("[")))?.[0]?.results?.[0]?.id ?? null;
}

/**
 * `email`'s role in the organization with `organizationId`, or `null` when they
 * are not in it.
 *
 * Both halves are assertions this suite needs: a role change is only proven by
 * the column, and a removal is only proven by the row's absence — the list
 * re-rendering without somebody could equally be a pagination accident.
 *
 * Takes an id rather than a slug so it serves organizations the **product**
 * created as well as seeded ones; `memberRole` below is the seeded-slug form.
 */
export function memberRoleIn(email: string, organizationId: string): string | null {
  const sql =
    `SELECT role FROM member WHERE organizationId = '${organizationId}' ` +
    `AND userId = (SELECT id FROM user WHERE email = '${email}')`;

  const output = execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--json --command "${sql}"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  return JSON.parse(output.slice(output.indexOf("[")))?.[0]?.results?.[0]?.role ?? null;
}

/** `memberRoleIn` for a **seeded** organization, whose id is derived from its slug. */
export function memberRole(email: string, slug: string): string | null {
  return memberRoleIn(email, `e2e-org-${slug}`);
}

/** How many organizations `email` belongs to — the assertion a deny path needs. */
export function membershipCount(email: string): number {
  const sql =
    `SELECT COUNT(*) AS n FROM member ` +
    `WHERE userId = (SELECT id FROM user WHERE email = '${email}')`;

  const output = execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--json --command "${sql}"`,
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );

  const parsed = JSON.parse(output.slice(output.indexOf("[")));
  return Number(parsed?.[0]?.results?.[0]?.n ?? -1);
}

/**
 * Give `email` an organization it owns, directly in the local D1.
 *
 * No longer a workaround for a missing flow: the app creates organizations for
 * real as of issue #34, and `organizations.spec.ts` drives that path from the
 * product surface with no seeding at all — which is the epic's acceptance
 * criterion. This stays because it is *faster*. A spec that merely needs an org
 * to exist before testing something else should write the rows rather than
 * spend a dialog round trip on scenery.
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
 * Blank `activeOrganizationId` on every one of `email`'s sessions.
 *
 * The state a session carries when nothing has selected an organization for it:
 * better-auth writes the column in create-organization, accept-invitation and
 * set-active only, and `sessionDatabaseHooks` writes it at sign-in — so a
 * session minted before that hook existed, or one whose organization was
 * deleted, holds `null` while the account plainly has organizations.
 *
 * Unreachable through the product inside one run, which is the whole reason it
 * is written directly: the same seam `markEmailVerified` and `expireInvitation`
 * use, and for the same reason.
 */
export function clearActiveOrganization(email: string) {
  const sql =
    `UPDATE session SET activeOrganizationId = NULL ` +
    `WHERE userId = (SELECT id FROM user WHERE email = '${email}')`;

  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local --command "${sql}"`,
    { stdio: "pipe" },
  );
}

/**
 * Point every one of `email`'s sessions at a specific organization.
 *
 * The session hook picks the *oldest* membership, and two seeded rows written
 * in the same second are tied — so a spec that needs to know which organization
 * is active says so rather than betting on the tie-break.
 */
export function setActiveOrganization(email: string, slug: string) {
  const sql =
    `UPDATE session SET activeOrganizationId = 'e2e-org-${slug}' ` +
    `WHERE userId = (SELECT id FROM user WHERE email = '${email}')`;

  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local --command "${sql}"`,
    { stdio: "pipe" },
  );
}

/**
 * Delete `email`'s membership of a seeded organization, leaving their session
 * still naming it.
 *
 * That combination is what better-auth's `removeMember` actually produces: it
 * clears the active organization of the person *doing* the removing, and never
 * of the person removed (`plugins/organization/routes/crud-members.mjs`). The
 * removed user goes on holding a session that names an organization they can no
 * longer read, until they sign in again.
 *
 * Written directly rather than driven, even though the removal UI now exists:
 * reaching this state through the product needs two signed-in people and a
 * removal in the *other* one's session, which is the two-user lifecycle spec
 * (#40). Deleting the row rather than nulling the session is the point —
 * nulling it would produce the state the *foreign key* already produces on
 * organization delete, which is a different and already-correct path.
 */
export function removeMembership(email: string, slug: string) {
  const sql =
    `DELETE FROM member WHERE organizationId = 'e2e-org-${slug}' ` +
    `AND userId = (SELECT id FROM user WHERE email = '${email}')`;

  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local --command "${sql}"`,
    { stdio: "pipe" },
  );
}

/**
 * Add `email` to an existing seeded organization, in a role of its own.
 *
 * `giveOrganization` makes an owner; this is what a second person looks like.
 * Same `--local` D1 write, same derived `e2e-org-<slug>` id, and
 * `INSERT OR IGNORE` so a re-run is a no-op rather than a duplicate membership.
 */
export function giveMembership(email: string, slug: string, role: "owner" | "admin" | "member") {
  const orgId = `e2e-org-${slug}`;
  const sql =
    `INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt) ` +
    `SELECT '${orgId}-member-${role}-' || id, '${orgId}', id, '${role}', unixepoch() ` +
    `FROM user WHERE email = '${email}';`;

  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local --command "${sql}"`,
    { stdio: "pipe" },
  );
}

/**
 * Fill a seeded organization with `count` synthetic members.
 *
 * Pagination cannot be tested with three people in an organization, and
 * registering twenty accounts through the API would spend most of a suite's
 * wall-clock on scenery — and would charge twenty sign-ups to the credentials
 * rate-limit class for rows nobody ever signs in as. These users exist only to
 * be listed: no password, no session, no account row.
 *
 * The addresses are `<prefix>-NN@example.com`, which keeps them inside the
 * pattern `loader-guards.spec.ts` asserts is absent from an unauthenticated
 * response.
 */
export function fillOrganization(slug: string, prefix: string, count: number) {
  const orgId = `e2e-org-${slug}`;
  const rows = Array.from({ length: count }, (_, index) => {
    const id = `${prefix}-${String(index).padStart(2, "0")}`;
    // Distinct, increasing `createdAt`s. The list is ordered by that column, and
    // a page boundary drawn through a block of ties is where a row gets served
    // on both pages or neither — a flake that would read as a pagination bug.
    const at = `unixepoch() + ${index + 1}`;
    return (
      `INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt) ` +
      `VALUES ('${id}', 'Filler ${index}', '${id}@example.com', 1, ${at}, ${at}); ` +
      `INSERT OR IGNORE INTO member (id, organizationId, userId, role, createdAt) ` +
      `VALUES ('${orgId}-${id}', '${orgId}', '${id}', 'member', ${at});`
    );
  });

  execSync(
    `pnpm --filter @starter/web exec wrangler d1 execute ${D1_BINDING} --local ` +
      `--command "${rows.join(" ")}"`,
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

/**
 * React's hydration errors, in both the forms it emits them. The prose
 * appears in development; a production build replaces it with a URL carrying
 * the code. `watchForHydrationFailures` below explains why both matter.
 */
const HYDRATION_ERROR = /hydrat|react\.dev\/errors\/(418|422|423|425)\b/i;

/**
 * Collect hydration failures reported by the browser for the rest of the test.
 *
 * **The suite-wide `locale`/`timezoneId` pins in `playwright.config.ts` make a
 * hydration mismatch *possible* to observe; they do not make it observable.**
 * React reports one by logging an error and re-rendering the subtree on the
 * client, so a page whose spec asserts nothing about the rendered value — and
 * installs no listener — goes on passing while the server's markup is thrown
 * away. Pinning without watching only moves where the bug hides.
 *
 * So a spec driving a page that renders a date installs this and asserts the
 * result is empty. Two pages qualify today, `/dashboard/members` and
 * `/dashboard/settings`, and both do; `tests/e2e/CLAUDE.md` carries the rule for
 * the next one.
 *
 * Call it **before** navigating — Playwright delivers only what is emitted while
 * a listener is attached, and hydration happens on first paint.
 *
 * **Read the result only after React has attached**, via `waitForHydration` on
 * something in the tree. `goto` and `reload` resolve at the `load` event, which
 * is earlier: read there and the list is empty because React has not run yet,
 * so the assertion passes on a page that is about to throw its markup away.
 * Both specs using this made that mistake first, and it is invisible — the
 * guard reports success rather than reporting nothing.
 *
 * It is deliberately not a global fixture. Several specs drive 401, 403 and 429
 * paths on purpose, and those log console errors of their own; failing every
 * test on any console error would turn deliberate deny-path coverage into noise
 * and get the fixture disabled. Filtering at the point of assertion keeps the
 * signal narrow enough to stay switched on.
 *
 * **The filter has to match the minified form too, and that is not paranoia.**
 * React spells these errors out only in development. In a production build it
 * logs a URL instead — `https://react.dev/errors/418?args[]=…` — in which the
 * word "hydration" does not appear anywhere. The e2e suite runs against
 * `react-router dev` today, so the prose form is what arrives; the day someone
 * points `webServer` at a built preview, a word-only filter would match nothing
 * and both watched pages would lose the guard silently, keeping only the shape
 * assertions and only for the dates those name. Matching the codes as well
 * costs one alternation and removes that trapdoor.
 *
 * The codes are React's hydration family: 418 (server HTML did not match), 422
 * and 423 (error while hydrating, boundary and root), 425 (text content did not
 * match).
 */
export function watchForHydrationFailures(page: Page): () => string[] {
  const failures: string[] = [];

  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });

  return () => failures.filter((text) => HYDRATION_ERROR.test(text));
}
