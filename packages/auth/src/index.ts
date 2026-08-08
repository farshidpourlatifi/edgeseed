export { createAuth } from "./server";
export type { Auth, CreateAuthOptions } from "./server";
export { createBetterAuthClient } from "./client";
export type { AuthClient } from "./client";
export { authMiddleware } from "./middleware";
export type { AuthEnv } from "./middleware";
export {
  AUTH_RATE_LIMIT_CUSTOM_RULES,
  createRateLimitStorage,
  rateLimitClassFor,
  rateLimitKey,
  RATE_LIMIT_RULES,
} from "./rate-limit";
export type { RateLimitClass, RateLimiters } from "./rate-limit";
export { getSession, requireSession } from "./helpers/session";
export { ROLES, hasRole } from "./helpers/roles";
export type { Role } from "./helpers/roles";
export {
  API_TOKEN_PREFIX,
  extractBearerToken,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  isApiTokenUsable,
} from "./helpers/api-token";
export type { GeneratedApiToken } from "./helpers/api-token";
export { createApiToken, listApiTokens, revokeApiToken } from "./helpers/api-token-store";
export type { ApiTokenSummary } from "./helpers/api-token-store";
export {
  getPrincipal,
  ownedTokenFilter,
  principalMiddleware,
  requireInteractivePrincipal,
  requireOrganization,
  requirePrincipal,
} from "./helpers/principal";
export type { ApiPrincipal, PrincipalEnv } from "./helpers/principal";
