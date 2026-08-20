import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

/**
 * The local miniflare state directory both Workers share.
 *
 * `apps/mcp`'s `dev` script points at it with `--persist-to ../web/.wrangler/state`
 * so the MCP Worker reads the same D1 the browser just wrote to.
 */
const SHARED_STATE = "apps/web/.wrangler/state/v3";

export default function globalSetup() {
  console.log("Resetting database for e2e tests...");
  execSync("pnpm db:reset", { stdio: "inherit" });

  /*
   * `db:reset` `rm -rf`s `apps/web/.wrangler` and then recreates only `v3/d1`,
   * by applying migrations. Playwright starts both `webServer` entries in
   * parallel afterwards, and miniflare expects `v3/cache` to exist already — so
   * the MCP Worker races the web server for a directory the web server happens
   * to create on its way up, and loses about as often as not. When it loses it
   * dies at boot with `Directory named "cache:storage" not found`, followed by
   * `The Workers runtime failed to start`.
   *
   * Nothing about the resulting failure points here: Playwright's port probe
   * only waits for a socket, so the run proceeds and the MCP spec reports
   * `TypeError: fetch failed` against port 8788 — which names neither the race
   * nor the reset that caused it.
   *
   * Created here rather than in the `webServer` command because that keeps the
   * command a single process: a compound `mkdir && pnpm …` puts a shell between
   * Playwright and wrangler, and a shell that is killed can leave the Worker
   * behind — orphaned dev servers are their own long-running trap in this repo.
   */
  // The leaf, not just `v3/cache`: miniflare looks for the object store inside
  // it, so creating the parent alone leaves the same error.
  mkdirSync(`${SHARED_STATE}/cache/miniflare-CacheObject`, { recursive: true });
}
