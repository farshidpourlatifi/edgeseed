/**
 * "Is anything already holding this port?" — the pre-flight both the boot check
 * and the e2e MCP Worker run before spawning a server of their own.
 *
 * Its own file rather than a corner of `boot-check.ts`, for two reasons: that
 * file states it holds *pure* helpers, and `src/lib/**` is what
 * `stryker.config.json` mutates. A guard whose deny path no test would notice
 * is not a guard, and this one's deny path is the whole point of it.
 */

import { connect } from "node:net";

/**
 * Resolves `true` when something is listening, `false` only when the connection
 * is explicitly refused.
 *
 * **A TCP connect, not an HTTP request.** An HTTP probe reads its own timeout as
 * "nothing there", so a *wedged* listener — one holding the port and never
 * answering, which is what an interrupted run leaves behind — reads as a free
 * port and gets adopted. Measured: the `fetch(...).catch(() => false)` shape
 * this replaced reports `false` against a socket that accepts and never speaks.
 *
 * **The unknown case fails closed**, per the first rule in AGENTS.md. Only
 * `ECONNREFUSED` means free; a timeout, `EACCES`, or anything else means
 * occupied. A loopback connect that neither completes nor is refused is not a
 * free port, whatever else it is — and the cost of being wrong in that
 * direction is a confusing green run against somebody else's process, against
 * a re-run that says exactly what to stop.
 *
 * **`host` is not optional and must not be defaulted.** It has to be the host
 * the *caller* will address, which is why both call sites derive it from their
 * own URL rather than passing a literal. Pinning this to `127.0.0.1` while the
 * consumer addressed `localhost` is a defect that already shipped once: an
 * orphan bound IPv6-only on `::1` was invisible to the guard, the suite bound
 * `127.0.0.1` beside it, and the requests then went to the orphan — the
 * IPv6-only hazard AGENTS.md documents for 5173, landing on 8788. Passing a
 * name (rather than an address) lets Node's happy-eyeballs try both families,
 * so either orphan is seen.
 */
export function portOccupied(host: string, port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const settle = (occupied: boolean) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(true));
    socket.once("error", (error: NodeJS.ErrnoException) => settle(error.code !== "ECONNREFUSED"));
  });
}

/**
 * The host a URL addresses, for handing to `portOccupied`.
 *
 * Exists so a call site cannot state the host twice and let the two drift —
 * the guard probes whatever the consumer is about to talk to, by construction.
 */
export function hostOf(url: string): string {
  // `URL.hostname` keeps the brackets around an IPv6 literal — `[::1]` — and
  // that string is not something `connect()` can resolve. No call site produces
  // such a URL today; this is here so the helper cannot answer wrongly and
  // silently if one ever does, since the failure mode would be an unrefused
  // connection read as "occupied" on every run.
  return new URL(url).hostname.replace(/^\[|\]$/g, "");
}
