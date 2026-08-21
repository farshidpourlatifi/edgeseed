import { describe, it, expect, vi } from "vitest";
import { formatDate, formatDateOrNever } from "../lib/format-date";

/**
 * The bug this closes was a real hydration failure on `/dashboard/members`: the
 * Worker rendered "Aug 15, 2026" and a British browser rendered "15 Aug 2026",
 * so React discarded the server's markup for that subtree.
 *
 * **The locale cases here cannot catch a revert on their own, and pretending
 * otherwise would be worse than saying so.** vitest runs under the machine's
 * locale, and on `en-US` — CI, and the Workers runtime — a pinned formatter and
 * a locale-dependent one produce identical output. Node fixes its default
 * locale at startup and ignores a later `LANG`, so `vitest.config.ts` cannot
 * pin it the way it pins `TZ`; the comment there explains the asymmetry. What
 * these cases do hold closed is the *shape*: the exact string, and the fact
 * that a different locale really would render something else, so the pin is not
 * decoration.
 *
 * The locale guard that can fail is in the e2e suite, which drives every page
 * in an `en-GB` browser and asserts React reports no hydration mismatch. It was
 * seen red against the original implementation.
 *
 * **The zone half is different: it can fail right here.** `vitest.config.ts`
 * pins this suite to `America/Los_Angeles`, west of UTC, so the process
 * genuinely disagrees with the Worker and the re-import case below is not
 * measuring against its own starting state.
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
