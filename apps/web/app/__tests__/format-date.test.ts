import { describe, it, expect, vi } from "vitest";
import { formatDate, formatDateOrNever } from "../lib/format-date";

/**
 * The bug this closes was a real hydration failure on `/dashboard/members`: the
 * Worker rendered "Aug 15, 2026" and a British browser rendered "15 Aug 2026",
 * so React discarded the server's markup for that subtree.
 *
 * **These cases cannot catch a revert on their own, and pretending otherwise
 * would be worse than saying so.** vitest runs under the machine's locale, and
 * on `en-US` — CI, and the Workers runtime — a pinned formatter and a
 * locale-dependent one produce identical output. What they do hold closed is
 * the *shape*: the exact string, and the fact that a different locale really
 * would render something else, so the pin is not decoration.
 *
 * The guard that can fail is in `members.spec.ts`, which drives the page in an
 * `en-GB` browser and asserts React reports no hydration mismatch. That one was
 * seen red against the original implementation.
 */

const TIMESTAMP = "2026-08-15T09:30:00.000Z";
/** Late enough in UTC that anywhere east of it is already on the next day. */
const LATE_TIMESTAMP = "2026-08-15T23:30:00.000Z";

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
