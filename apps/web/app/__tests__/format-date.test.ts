import { describe, it, expect, vi } from "vitest";
import { formatDate, formatDateOrNever } from "../lib/format-date";

/**
 * The bug this closes was a real hydration failure on `/dashboard/members`: the
 * Worker rendered "Aug 15, 2026" and a British browser rendered "15 Aug 2026",
 * so React discarded the server's markup for that subtree.
 *
 * **Every case here can fail, and that is recent.** For most of this file's
 * life the locale cases could not: vitest ran under the machine's locale, and
 * on `en-US` — CI, and the Workers runtime — a pinned formatter and a
 * locale-dependent one produce byte-identical output, so they passed against
 * both. They held the *shape* closed and nothing more, and the preamble said so
 * rather than overclaiming.
 *
 * `vitest.config.ts` now pins the suite to `en-GB` and `America/Los_Angeles`,
 * both of which the Worker is not, so the process disagrees with production on
 * both axes and every assertion below has something to catch. Counted by
 * mutating the seam and running this file:
 *
 * - dropping the **locale** fails six cases;
 * - dropping the **`timeZone` option** fails two — the re-import case, which
 *   would otherwise be measuring against its own starting state, and the
 *   early-instant case below it;
 * - **changing** the zone to some other zone fails one, and which one depends
 *   on the direction. An eastern zone trips the re-import case, whose instant
 *   is late in the UTC day; a western zone trips the early-instant case. That
 *   is the reason for keeping both rather than one: a single instant only
 *   catches a move in one direction.
 *
 * The pin is worth understanding before trusting it. `LC_ALL` is ignored by the
 * process that sets it — Node fixes its default locale at startup — and works
 * only because vitest runs test files in **forked** workers that read the
 * inherited environment as they boot. Setting it inside a test does nothing.
 *
 * The e2e suite carries the other half: it drives every page in an `en-GB`
 * browser, and `members.spec.ts` asserts React reports no hydration mismatch.
 * That one was seen red against the original implementation.
 */

const TIMESTAMP = "2026-08-15T09:30:00.000Z";
/** Late enough in UTC that anywhere east of it is already on the next day. */
const LATE_TIMESTAMP = "2026-08-15T23:30:00.000Z";
/** Early enough in UTC that anywhere west of it is still on the previous day. */
const EARLY_TIMESTAMP = "2026-08-15T03:00:00.000Z";

describe("formatDate", () => {
  it("renders an ISO timestamp as a short date", () => {
    expect(formatDate(TIMESTAMP)).toBe("Aug 15, 2026");
  });

  it("differs from what another locale would render, which is why it is pinned", () => {
    const british = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(TIMESTAMP));

    expect(british).toBe("15 Aug 2026");
    expect(formatDate(TIMESTAMP)).not.toBe(british);
  });

  /**
   * The zone half, and unlike everything above it this one **can** fail: the
   * module is re-imported with the process in UTC+14, which is what the
   * formatter would read if `timeZone` were left off. `23:30Z` is already the
   * next day there, so an unpinned formatter answers "Aug 16, 2026".
   *
   * `vi.resetModules()` matters because the formatter is built once at module
   * load — setting `TZ` after the first import would change nothing.
   */
  it("pins the zone, so a timestamp near midnight cannot land on two dates", async () => {
    const original = process.env.TZ;

    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14, the furthest ahead there is.
      vi.resetModules();
      const { formatDate: inKiritimati } = await import("../lib/format-date");

      // Sanity: the process really did move, so the case is not vacuous.
      expect(new Date(LATE_TIMESTAMP).getDate()).toBe(16);
      expect(inKiritimati(LATE_TIMESTAMP)).toBe("Aug 15, 2026");
    } finally {
      process.env.TZ = original;
      vi.resetModules();
    }
  });
});

describe("formatDateOrNever", () => {
  it("formats a timestamp like `formatDate`", () => {
    expect(formatDateOrNever(TIMESTAMP)).toBe("Aug 15, 2026");
  });

  it("says Never rather than leaving the column blank", () => {
    expect(formatDateOrNever(null)).toBe("Never");
  });
});

/**
 * The deny-path test for a piece of **configuration**, and the unit-suite twin
 * of `tests/e2e/hostile-environment.spec.ts`.
 *
 * `vitest.config.ts` pins this suite west of UTC so it disagrees with the
 * Worker. That pin is invisible: delete the line and every case in this file
 * still passes, because a correctly pinned formatter answers the same string in
 * any zone — while the re-import case above quietly stops proving anything,
 * since it would then be moving from UTC to UTC+14 rather than across the
 * Worker's own zone. A configuration guard needs a test for the state where
 * somebody removed the configuration, like every other guard here.
 *
 * **The zone is restated rather than imported from the config on purpose.** A
 * shared constant would move with the edit that removed the pin and assert
 * nothing; the duplication is the mechanism, not an oversight.
 */
describe("the unit suite runs somewhere the Worker does not", () => {
  it("is pinned west of UTC, and not to the Worker's own zone", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Los_Angeles");
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe("UTC");
  });

  it("is pinned to a locale the Worker does not answer", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().locale).toBe("en-GB");
    expect(Intl.DateTimeFormat().resolvedOptions().locale).not.toBe("en-US");
  });

  /**
   * The materiality check for the locale half, and the reason the cases at the
   * top of this file are guards rather than shape assertions: an unpinned
   * formatter here really does answer something else.
   */
  it("makes an unpinned formatter render differently from the seam", () => {
    const unpinned = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(TIMESTAMP));

    expect(unpinned).toBe("15 Aug 2026");
    expect(unpinned).not.toBe(formatDate(TIMESTAMP));
  });

  /**
   * The disagreement has to move a calendar day to be worth anything — a zone
   * a few minutes off UTC would satisfy the case above and catch nothing.
   *
   * West of UTC the shift runs backwards, which is why this uses the early
   * instant and the e2e twin uses the late one: `Pacific/Kiritimati` pushes
   * 23:30Z onto the *next* day, `America/Los_Angeles` pulls 03:00Z back onto
   * the *previous* one. Between them both directions are covered.
   */
  it("puts an early-UTC timestamp on the previous day", () => {
    expect(new Date(EARLY_TIMESTAMP).getDate()).toBe(14);
    expect(new Date(EARLY_TIMESTAMP).getUTCDate()).toBe(15);
  });

  /** And the seam is unmoved by all of it — that is the whole point of pinning it. */
  it("does not change what the seam renders", () => {
    expect(formatDate(EARLY_TIMESTAMP)).toBe("Aug 15, 2026");
  });
});
