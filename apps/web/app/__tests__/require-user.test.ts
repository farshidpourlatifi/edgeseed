import { describe, it, expect, vi } from "vitest";
import type { AppLoadContext } from "react-router";
import { requireUser } from "../lib/require-user";

/**
 * The deny paths matter more than the allow path here: this helper exists
 * because `dashboard.settings.tsx` used to answer 200 with empty data to an
 * unauthenticated caller (audit #10).
 */

function contextWith(session: unknown): AppLoadContext {
  return {
    auth: { api: { getSession: vi.fn().mockResolvedValue(session) } },
  } as unknown as AppLoadContext;
}

const request = new Request("https://app.example/dashboard/settings");

describe("requireUser", () => {
  it("returns the session when authenticated", async () => {
    const session = { user: { id: "u1" } };
    await expect(requireUser(contextWith(session), request)).resolves.toBe(session);
  });

  it("redirects to /login when there is no session", async () => {
    try {
      await requireUser(contextWith(null), request);
      expect.unreachable("requireUser should have thrown a redirect");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(302);
      expect((thrown as Response).headers.get("location")).toBe("/login");
    }
  });

  // A missing `auth` means the request never went through the Hono chain. That
  // is a misconfiguration, and treating it as "no session" is the safe read.
  it("redirects when auth is absent from the context", async () => {
    try {
      await requireUser({} as AppLoadContext, request);
      expect.unreachable("requireUser should have thrown a redirect");
    } catch (thrown) {
      expect((thrown as Response).status).toBe(302);
    }
  });

  it("never resolves to a null user", async () => {
    await expect(requireUser(contextWith(null), request)).rejects.toBeDefined();
  });

  it("reads the session from the request headers", async () => {
    const context = contextWith({ user: { id: "u1" } });
    await requireUser(context, request);

    expect(context.auth.api.getSession).toHaveBeenCalledWith({ headers: request.headers });
  });
});
