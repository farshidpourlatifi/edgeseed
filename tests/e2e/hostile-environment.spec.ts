import { test, expect } from "@playwright/test";

/**
 * The deny-path test for a piece of **configuration**.
 *
 * `playwright.config.ts` pins the browser to `Pacific/Kiritimati` and `en-GB`
 * so it disagrees with the Worker's UTC/`en-US` on both axes. That pin is what
 * makes every other spec in this suite a standing hydration test — and it is
 * invisible: delete the two lines and all 139 specs still pass, because a
 * correctly pinned formatter renders the same string in every browser. The
 * suite would quietly stop testing the thing it was widened to test.
 *
 * So the pin needs an assertion of its own, and this is it. Every other guard
 * in this repo ships a test for its deny path; a configuration guard is no
 * different, and its deny path is "somebody removed the configuration".
 *
 * **The values below are deliberately restated rather than imported from the
 * config.** A shared constant would move with the edit that removed the pin and
 * assert nothing — the duplication is not an oversight, it is the mechanism. If
 * the pin is ever changed on purpose, both homes change and the diff says so.
 */

/** What `playwright.config.ts` pins, restated on purpose. */
const BROWSER_TIMEZONE = "Pacific/Kiritimati";
const BROWSER_LOCALE = "en-GB";

/** What the Worker is, and what `app/lib/format-date.ts` pins its output to. */
const WORKER_TIMEZONE = "UTC";
const WORKER_LOCALE = "en-US";

/**
 * Late enough in UTC that everywhere east of it is already on the next day —
 * the same instant `format-date.test.ts` uses, for the same reason.
 */
const LATE_UTC_TIMESTAMP = "2026-08-15T23:30:00.000Z";

test.describe("the suite runs somewhere the Worker does not", () => {
  test("the browser's timezone and locale both disagree with the Worker's", async ({ page }) => {
    // `/` is public, already warmed, and needs no session — this asserts the
    // browser context, not the page.
    await page.goto("/");

    const browser = await page.evaluate(() => ({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
    }));

    expect(browser.timeZone).toBe(BROWSER_TIMEZONE);
    expect(browser.locale).toBe(BROWSER_LOCALE);

    // The half that carries the meaning: agreeing with the Worker is the state
    // in which this suite cannot see a locale or zone bug at all.
    expect(browser.timeZone).not.toBe(WORKER_TIMEZONE);
    expect(browser.locale).not.toBe(WORKER_LOCALE);
  });

  /**
   * The disagreement has to be **material**, not merely a different string. A
   * zone one minute off UTC would satisfy the case above while never moving a
   * calendar day, and moving the calendar day is the entire bug class.
   */
  test("the pinned zone puts a late-UTC timestamp on the following day", async ({ page }) => {
    await page.goto("/");

    const localDay = await page.evaluate(
      (timestamp) => new Date(timestamp).getDate(),
      LATE_UTC_TIMESTAMP,
    );

    // 23:30 on the 15th in UTC is 13:30 on the 16th at UTC+14.
    expect(localDay).toBe(16);
    expect(new Date(LATE_UTC_TIMESTAMP).getUTCDate()).toBe(15);
  });
});
