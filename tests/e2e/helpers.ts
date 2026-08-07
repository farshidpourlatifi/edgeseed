import { execSync } from "node:child_process";
import { expect, type Locator } from "@playwright/test";

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
    `pnpm --filter @starter/web exec wrangler d1 execute edgeseed-db --local ` +
      `--command "UPDATE user SET emailVerified = 1 WHERE email = '${email}'"`,
    { stdio: "pipe" },
  );
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
