import { describe, it, expect, vi } from "vitest";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AuthEnv } from "../middleware";
import { getSession, requireSession } from "../helpers/session";

function fakeContext(sessionResult: unknown) {
  const getSessionMock = vi.fn().mockResolvedValue(sessionResult);
  const headers = new Headers({ cookie: "session=abc" });
  const c = {
    get: vi.fn().mockReturnValue({ api: { getSession: getSessionMock } }),
    req: { raw: { headers } },
  } as unknown as Context<AuthEnv>;
  return { c, getSessionMock, headers };
}

describe("getSession", () => {
  it("resolves the session from the auth api using the request headers", async () => {
    const session = { user: { id: "u1" } };
    const { c, getSessionMock, headers } = fakeContext(session);

    await expect(getSession(c)).resolves.toBe(session);
    expect(getSessionMock).toHaveBeenCalledWith({ headers });
  });

  it("returns null when unauthenticated", async () => {
    const { c } = fakeContext(null);
    await expect(getSession(c)).resolves.toBeNull();
  });
});

describe("requireSession", () => {
  it("returns the session when authenticated", async () => {
    const session = { user: { id: "u1" } };
    const { c } = fakeContext(session);
    await expect(requireSession(c)).resolves.toBe(session);
  });

  // Must be an HTTPException, not a bare Response: Hono's compose() only routes
  // Error instances to the error handler, so a Response escapes as a 500.
  it("throws a 401 HTTPException when unauthenticated", async () => {
    const { c } = fakeContext(null);
    try {
      await requireSession(c);
      expect.unreachable("requireSession should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HTTPException);
      expect((thrown as HTTPException).status).toBe(401);
    }
  });

  it("carries a JSON body the client can read", async () => {
    const { c } = fakeContext(null);
    try {
      await requireSession(c);
      expect.unreachable("requireSession should have thrown");
    } catch (thrown) {
      const res = (thrown as HTTPException).getResponse();
      expect(res.headers.get("content-type")).toBe("application/json");
      await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    }
  });
});
