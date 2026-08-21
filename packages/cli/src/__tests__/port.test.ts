import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { hostOf, portOccupied } from "../lib/port";

/**
 * Real sockets, not a mock. The whole value of this guard is what the operating
 * system does with a half-open port, and a stubbed `connect` would assert only
 * that the code calls the function it obviously calls.
 */
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** Listen on an OS-assigned port and return it. */
function listen(host: string, onConnection: () => void = () => {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(onConnection);
    servers.push(server);
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/** A port nothing holds: take one, then give it back. */
async function freePort(): Promise<number> {
  const server = createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe("portOccupied", () => {
  it("reports a listening port as occupied", async () => {
    const port = await listen("127.0.0.1");
    await expect(portOccupied("127.0.0.1", port)).resolves.toBe(true);
  });

  /**
   * The deny path. `ECONNREFUSED` is the *only* answer that frees the port, so
   * flipping that comparison inverts the guard — and every other test here
   * still passes, because they all assert the occupied direction.
   */
  it("reports a refused connection as free", async () => {
    await expect(portOccupied("127.0.0.1", await freePort())).resolves.toBe(false);
  });

  /**
   * The case the HTTP probe this replaced could not see: a listener that
   * accepts and never answers, which is what an interrupted run leaves.
   *
   * It is caught at **connect**, not by the timeout — a wedged listener still
   * completes the TCP handshake; it is the HTTP *response* that never arrives,
   * which is why the old `fetch` shape timed out and read the port as free.
   * Stating the mechanism because the first version of this test named the
   * wrong one, and a test that misdescribes what it proves is worse than none.
   */
  it("sees a wedged listener, which completes the handshake and then says nothing", async () => {
    const port = await listen("127.0.0.1", () => {
      /* accept, then say nothing at all */
    });
    await expect(portOccupied("127.0.0.1", port, 300)).resolves.toBe(true);
  });

  /**
   * The timeout branch, which is what stops the probe hanging forever on an
   * address that neither answers nor refuses. `192.0.2.1` is TEST-NET-1
   * (RFC 5737): reserved for documentation, routed nowhere, so the SYN goes
   * unanswered rather than being refused.
   *
   * The assertion is the *contract* — fail closed — rather than the branch, so
   * it also holds on a machine with no outbound route, where the attempt errors
   * with `ENETUNREACH` instead. Both are "not ECONNREFUSED", and both must mean
   * occupied.
   */
  it("fails closed when a connection neither completes nor is refused", async () => {
    await expect(portOccupied("192.0.2.1", 80, 250)).resolves.toBe(true);
  });

  /**
   * The regression that shipped: probing `127.0.0.1` while the consumer
   * addressed `localhost` made an IPv6-only orphan invisible. Passing the name
   * lets happy-eyeballs try both families.
   */
  it("sees an IPv6-only listener when given a hostname", async ({ skip }) => {
    let port: number;
    try {
      port = await listen("::1");
    } catch {
      skip("no IPv6 loopback on this machine");
      return;
    }
    await expect(portOccupied("localhost", port)).resolves.toBe(true);
  });

  it("does not see an IPv6-only listener through the IPv4 literal", async ({ skip }) => {
    let port: number;
    try {
      port = await listen("::1");
    } catch {
      skip("no IPv6 loopback on this machine");
      return;
    }
    // Not a wish, a fact — and the reason `host` is derived from the consumer's
    // own URL rather than written out at the call site.
    await expect(portOccupied("127.0.0.1", port)).resolves.toBe(false);
  });
});

describe("hostOf", () => {
  it("takes the host the consumer will actually address", () => {
    expect(hostOf("http://localhost:8788")).toBe("localhost");
    expect(hostOf("http://127.0.0.1:8791/api/v1/health")).toBe("127.0.0.1");
  });

  it("unwraps an IPv6 literal, which is not a connectable host string", () => {
    expect(hostOf("http://[::1]:8788/")).toBe("::1");
  });
});
