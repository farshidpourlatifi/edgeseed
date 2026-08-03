import { describe, it, expect, vi } from "vitest";
import type { Context } from "hono";
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

  it("throws a 401 Response when unauthenticated", async () => {
    const { c } = fakeContext(null);
    try {
      await requireSession(c);
      expect.unreachable("requireSession should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(401);
    }
  });
});
