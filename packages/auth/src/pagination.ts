/**
 * How many rows a bounded organization list reads at once.
 *
 * **A cost decision, not a layout one.** D1 bills rows scanned, so the number
 * that bounds the members page is the same number that has to bound every other
 * door onto the same data — `/api/v1/organization/*` and the MCP list tools
 * both read through the stores in `helpers/org-store.ts`, and a surface asking
 * for more rows per request would make the identical data more expensive to
 * read through the other one. Twenty keeps a read inside one screen's worth of
 * rows for an organization of any size; the pager is what reaches the rest.
 *
 * **A leaf with no imports, and it has to stay one.**
 * `apps/web/app/lib/pagination.ts` re-exports it into the browser bundle, so
 * reaching it through the package index instead would drag better-auth into the
 * client for the sake of one integer. Same rule, same reason, as
 * `invitation.ts` and `helpers/roles.ts`.
 */
export const PAGE_SIZE = 20;
