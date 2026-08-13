import { createBetterAuthClient } from "@starter/auth/client";

export const authClient = createBetterAuthClient();

/**
 * Where each flow lands lives in `./auth-redirects`, which holds no client and
 * so can be imported by the e2e suite. Import the constants from there.
 */
