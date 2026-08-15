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
 * Nothing in CI catches it: Playwright's Chromium runs `en-US`, which is
 * exactly the server's answer, so the mismatch only exists on a reader's
 * machine. It was found by opening the members page in a real browser and
 * reading the console.
 *
 * Pinning is a stand-in for internationalisation, not a rejection of it. When
 * this product grows a locale of its own, this function is the one place that
 * has to learn about it — which is the other reason it is not three copies of
 * the same six lines.
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
   * `members.spec.ts`'s `en-GB` block cannot catch this one either: CI's
   * Chromium runs UTC, so it agrees with the Worker. `format-date.test.ts`
   * re-imports this module under `TZ=Pacific/Kiritimati` instead, which is the
   * only place the two zones actually disagree.
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
