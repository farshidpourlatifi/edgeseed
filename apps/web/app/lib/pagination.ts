/**
 * Page-window arithmetic for bounded lists.
 *
 * Pure and separate from the loader that uses it because the loader has no unit
 * target — every off-by-one here (an offset that skips a row, a "Next" link on
 * the last page, `?members=0` reading backwards) is invisible in a rendered
 * page with three members in it and obvious in a table of cases.
 */

/**
 * Rows per page, for every list on the members page.
 *
 * D1 bills rows scanned, so the number is a cost decision rather than a layout
 * one: 20 keeps a page's read inside one screen's worth of rows for an
 * organization of any size, and the pager is what reaches the rest.
 */
export const PAGE_SIZE = 20;

export interface Pager {
  /** 1-based, and always within `[1, pageCount]`. */
  page: number;
  /** At least 1 — an empty list is "page 1 of 1", not "page 1 of 0". */
  pageCount: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * A `?page=`-style parameter as a page number.
 *
 * Anything that is not a whole number ≥ 1 — absent, empty, `0`, `-3`, `2.5`,
 * `abc`, `1e3` — reads as page 1. Refusing rather than coercing matters
 * because the value becomes an `OFFSET`: `-1` would otherwise ask D1 for a
 * negative offset, and `2.5` for a fractional one.
 */
export function readPage(value: string | null | undefined): number {
  if (!value) return 1;
  if (!/^\d+$/.test(value)) return 1;

  const page = Number(value);
  return page >= 1 ? page : 1;
}

/** Rows to skip to reach `page`. */
export function offsetFor(page: number, pageSize: number = PAGE_SIZE): number {
  return (page - 1) * pageSize;
}

/** How many pages `total` rows fill, never fewer than one. */
export function pageCountFor(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The state a pager renders from, given the page asked for and what came back. */
export function pagerFor(page: number, total: number, pageSize: number = PAGE_SIZE): Pager {
  const pageCount = pageCountFor(total, pageSize);
  const current = Math.min(page, pageCount);

  return {
    page: current,
    pageCount,
    total,
    hasPrevious: current > 1,
    hasNext: current < pageCount,
  };
}

export interface PageRequest {
  /** Search parameter carrying this list's page number. */
  param: string;
  /** What the caller asked for, already through `readPage`. */
  requested: number;
  /** What the data says exists. */
  pageCount: number;
}

/**
 * The same URL with every over-shooting page parameter pulled back to the last
 * real page — or `null` when nothing needs correcting.
 *
 * `?members=99` on a three-page list would otherwise render an empty list under
 * a pager reading "page 99 of 3", which is a page that lies about itself.
 * Redirecting costs one extra round trip in a case only a hand-edited URL or a
 * shrinking organization reaches, and leaves the address bar true. Every list
 * is corrected in one redirect, so two overshooting parameters cannot bounce
 * the browser twice.
 */
export function correctedPageUrl(url: URL, requests: PageRequest[]): string | null {
  const corrected = new URL(url);
  let changed = false;

  for (const request of requests) {
    if (request.requested <= request.pageCount) continue;

    changed = true;
    if (request.pageCount === 1) corrected.searchParams.delete(request.param);
    else corrected.searchParams.set(request.param, String(request.pageCount));
  }

  return changed ? `${corrected.pathname}${corrected.search}` : null;
}

/** The same URL with one list moved to `page`, for a pager's Previous/Next links. */
export function pageLink(url: URL, param: string, page: number): string {
  const target = new URL(url);

  if (page <= 1) target.searchParams.delete(param);
  else target.searchParams.set(param, String(page));

  return `${target.pathname}${target.search}`;
}
