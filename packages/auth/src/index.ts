export { createAuth } from "./server";
export type { Auth, CreateAuthOptions } from "./server";
export { createBetterAuthClient } from "./client";
export type { AuthClient } from "./client";
export { authMiddleware } from "./middleware";
export type { AuthEnv } from "./middleware";
export { getSession, requireSession } from "./helpers/session";
export { ROLES, hasRole } from "./helpers/roles";
export type { Role } from "./helpers/roles";
