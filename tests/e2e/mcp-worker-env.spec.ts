import { resolve } from "node:path";

import { test, expect } from "@playwright/test";

import { BOOT_ENV_FILE } from "../../packages/cli/src/lib/boot-check";
import { hostOf, portOccupied } from "../../packages/cli/src/lib/port";
import { MCP_ORIGIN, MCP_PORT, startMcpWorker, stopMcpWorker } from "./mcp-client";

/**
 * The deny path of `startMcpWorker`'s env probe, on the real Worker.
 *
 * A Worker that cannot parse its env still listens and still answers `/`, so
 * readiness alone passed it and the failure arrived minutes later as a locator
 * timeout at the login form, naming nothing. This proves the refusal now comes
 * at start-up, names the rejected key, and leaves nothing listening.
 *
 * The empty env file is what stops `.dev.vars` being loaded — the same file
 * `check:boot` passes for the same reason — so the Worker boots with no secret
 * whatever the machine has configured.
 *
 * No auth endpoint is driven from a browser here, so no `cf-connecting-ip` is
 * needed.
 */
const EMPTY_ENV_FILE = resolve("packages/cli", BOOT_ENV_FILE);

test.describe("an MCP Worker whose env does not parse", () => {
  test("is refused at start-up with the rejected key named", async () => {
    test.setTimeout(120_000);

    await expect(startMcpWorker({ envFile: EMPTY_ENV_FILE })).rejects.toThrow(
      /did not parse[\s\S]*BETTER_AUTH_SECRET/,
    );

    expect(await portOccupied(hostOf(MCP_ORIGIN), MCP_PORT)).toBe(false);
  });

  // Unconditional: a no-op after a refusal, and the net under a Worker that
  // wrongly started.
  test.afterAll(stopMcpWorker);
});
