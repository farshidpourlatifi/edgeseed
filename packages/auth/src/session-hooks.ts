import type { BetterAuthOptions } from "better-auth";
import type { Database } from "@starter/db";
import { resolveMembership } from "./helpers/org-store";

/**
 * Give every new session an active organization.
 *
 * Better Auth 1.6.26 sets `session.activeOrganizationId` in exactly three
 * places — create-organization, accept-invitation and set-active — and in none
 * of them at sign-in (`plugins/organization/routes/*.mjs`, the only callers of
 * `adapter.setActiveOrganization`). So a returning member signed in with it
 * `null`, and every org-scoped read had nothing to key on.
 *
 * This is the fix, and the only one. The sidebar switcher used to paper over it
 * by displaying `organizations[0]` — which claimed an organization was active
 * when none was, checkmark and all. That fallback is gone (`dashboard.tsx`), so
 * a session this hook does not reach now reads "Select organization" rather
 * than a guess.
 *
 * The organization chosen is the oldest membership, which is the row
 * `listOrganizations` returns first. Nothing here decides authorization: it
 * selects a default view, and each reader re-checks membership at the point it
 * reads.
 *
 * A user with no memberships returns **nothing at all** rather than an explicit
 * `undefined` — `createWithHooks` spreads whatever `data` it is handed over the
 * row (`db/with-hooks.mjs`), so a returned key would be a key written.
 */
export function sessionDatabaseHooks(db: Database): BetterAuthOptions["databaseHooks"] {
  return {
    session: {
      create: {
        before: async (session) => {
          const membership = await resolveMembership(db, {
            userId: session.userId,
            organizationId: null,
          });

          if (!membership) return;
          return { data: { activeOrganizationId: membership.organizationId } };
        },
      },
    },
  };
}
