import { z } from "zod";
import { PAGE_SIZE } from "@starter/auth/pagination";

/**
 * The `limit`/`offset` pair every list tool declares, stated once.
 *
 * Spread into a tool's input shape rather than nested, because the MCP SDK takes
 * a **`ZodRawShape`** — a plain object of field schemas — not a `z.object`. A
 * nested object would show a client one `page` argument with two keys inside it,
 * which is a worse tool signature than two flat optional numbers.
 *
 * The cap is `PAGE_SIZE`, imported rather than restated: D1 bills rows scanned,
 * so an MCP client must not be able to read the same rows in bigger gulps than
 * `/api/v1/organization/*` or the members page can. `.max()` **refuses** rather
 * than clamps, matching the API — a caller asking for 100 rows is told no, not
 * quietly handed 20 and left to believe there were only 20.
 */
export const pageArgs = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(PAGE_SIZE)
    .default(PAGE_SIZE)
    .describe(`Rows to return, 1–${PAGE_SIZE}.`),
  offset: z.number().int().min(0).default(0).describe("Rows to skip before this page."),
};

/** What a tool handler receives once `pageArgs` has been applied. */
export interface PageArgs {
  limit: number;
  offset: number;
}

/**
 * The window a handler should read with.
 *
 * The SDK applies the zod defaults before calling the handler, so this is a
 * belt-and-braces read rather than the only bound — but a tool registered
 * without its schema, or a future SDK that stops parsing, would otherwise reach
 * D1 with `undefined` limits and read the whole table.
 */
export function pageWindow(args: Partial<PageArgs> | undefined): PageArgs {
  return { limit: args?.limit ?? PAGE_SIZE, offset: args?.offset ?? 0 };
}
