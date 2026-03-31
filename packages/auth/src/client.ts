import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

/** Create a browser-side auth client */
export function createBetterAuthClient(baseURL?: string) {
  return createAuthClient({
    baseURL,
    plugins: [organizationClient()],
  });
}

export type AuthClient = ReturnType<typeof createBetterAuthClient>;
