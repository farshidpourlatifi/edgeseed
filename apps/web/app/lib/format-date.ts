/**
 * A date, rendered the same way on both sides of hydration.
 *
 * **The locale is pinned, and that is the whole point.** `toLocaleDateString`
 * with `undefined` asks the *runtime* for its locale, and a server-rendered
 * page has two runtimes: the Worker answers `en-US` ("Aug 15, 2026"), while the
 * reader's browser answers whatever they have configured ("15 Aug 2026" on a
 * British machine). React then finds text it did not render, throws
 * `Hydration failed because the server rendered text…`, and discards the
 * server's markup for that subtree.
 *
 * Nothing in CI caught it, which is how it shipped: Playwright's Chromium ran
 * `en-US`, exactly the server's answer, so the mismatch existed only on a
 * reader's machine. It was found by opening the members page in a real browser
 * and reading the console. The suite now runs pinned to `en-GB`
 * (`playwright.config.ts`), so a repeat of this defect fails in CI instead —
 * `tests/e2e/hostile-environment.spec.ts` is what keeps that pin in place.
 *
 * Pinning is a stand-in for internationalisation, not a rejection of it. When
 * this product grows a locale of its own, this function is the one place that
 * has to learn about it — which is the other reason it is not three copies of
 * the same six lines.
 *
 * `docs/adr/004-time-and-timezones.md` is the convention this module is the
 * seam for, and it names this file as the only one. It also carries the
 * upgrade path — a cookie holding zone and locale together, feeding
 * server-side `Intl` through here — and the reason client-only formatting of
 * an SSR'd date is rejected rather than deferred.
 */
const FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  /**
   * The zone is pinned for the same reason the locale is, and it is the half
   * that survives a locale fix. An unpinned formatter reads the *runtime's*
   * zone: the Worker is UTC and the reader's browser is wherever they are, so
   * `2026-08-15T23:30:00Z` renders as the 15th on the server and the 16th in
   * Berlin — one calendar day apart, hydration discarded again.
   *
   * This half was blind for longer than the locale half. An `en-GB` browser
   * still ran UTC, so it agreed with the Worker on the zone no matter what it
   * did with the locale, and only `format-date.test.ts` — which re-imports this
   * module under `TZ=Pacific/Kiritimati` — could see a difference at all. The
   * e2e suite now runs at UTC+14 and the unit suite at UTC-7/-8
   * (`playwright.config.ts`, `vitest.config.ts`), so both directions of the day
   * boundary are covered and neither suite agrees with the Worker any more.
   *
   * The cost is honest and worth naming: a reader west of UTC sees the UTC
   * calendar day, so something created at 6pm in Los Angeles reads as the next
   * day. Rendering a *timestamp* in the reader's own zone is a client-only
   * concern (`suppressHydrationWarning`, or an effect after mount) and the day
   * something needs that, it belongs here rather than inlined at a call site.
   */
  timeZone: "UTC",
});

/** An ISO timestamp as a short date. */
export function formatDate(value: string): string {
  return FORMAT.format(new Date(value));
}

/** The same, for a column that may be empty — "Never" reads better than a blank. */
export function formatDateOrNever(value: string | null): string {
  return value ? formatDate(value) : "Never";
}
