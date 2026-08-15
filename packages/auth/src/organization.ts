import { organization } from "better-auth/plugins";
import { adminAc, defaultAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { APIError } from "better-auth/api";
import { invitationEmail, type EmailSender } from "@starter/email";
import {
  INVITATION_EXPIRES_IN_DAYS,
  INVITATION_EXPIRES_IN_SECONDS,
  invitationAcceptUrl,
} from "./invitation";
import { OWNER_MUST_BE_PROMOTED, ROLES } from "./helpers/roles";

/**
 * The organization plugin's configuration, separated from `createAuth` so it can
 * be asserted on.
 *
 * It cannot be reached through `auth.options`: `organization()` captures its
 * argument in closures and the plugin object it returns exposes only `id`,
 * `endpoints` and `schema` (`plugins/organization/organization.mjs`). So the
 * only way to test the invitation sender — which is a *security-relevant piece
 * of configuration*, in the same class as everything `auth-config.test.ts`
 * covers — is to build the object here and hand it to both.
 *
 * Separate from `invitation.ts` on purpose. That module is a leaf the **browser
 * bundle** imports through `app/lib/auth-redirects.ts`; this one pulls in
 * better-auth and `@starter/email`, so the two must not merge.
 */
export type OrganizationOptions = Parameters<typeof organization>[0];

export interface OrganizationPluginDeps {
  /** Transport for the invitation mail. Same instance the rest of auth uses. */
  email: EmailSender;
  /**
   * `BETTER_AUTH_URL` — the app origin by definition. The invitation link is
   * absolute and resolved against it, so a reader opening their mail on any
   * device lands on the app rather than the marketing host.
   */
  baseURL: string;
  /** From `@starter/config/product`, so a rename reaches the emails too. */
  productName: string;
}

/**
 * The role table, narrowed from Better Auth's defaults to the matrix in
 * `helpers/roles.ts`.
 *
 * **This is what makes "owner only" true.** `ORG_CAPABILITIES` decides which
 * controls the members page renders, but the page is not the boundary: the
 * browser holds a session cookie and can POST
 * `/api/auth/organization/update-member-role` or `/organization/remove-member`
 * directly. Better Auth answers those from its own access control, and its
 * stock `adminAc` grants `member: ["create", "update", "delete"]` — so with the
 * defaults left in place an admin removes members and rewrites roles whatever
 * the UI offers, and every guard in `apps/web` is one layer above the write.
 * Narrowing here is the guard; `can()` is what the page renders from.
 *
 * `member: ["update"]` and `member: ["delete"]` are consulted in exactly two
 * live places — `updateMemberRole` and `removeMember` in
 * `plugins/organization/routes/crud-members.mjs` — plus the team-member
 * endpoints, which are inert because teams are not enabled. `member: ["create"]`
 * stays: it is checked nowhere in 1.6.26 (`addMember` is `serverOnly` and
 * unguarded), so dropping it would be a change with no meaning attached.
 *
 * **Derived from `adminAc`, not restated.** Spelling the whole statement out
 * would mean an upgrade that adds a resource to Better Auth's admin role
 * silently *denies* it here, which is the failure that reads as a product bug
 * rather than as a version bump. Spreading its statements narrows exactly the
 * one key this repo has an opinion about, and `organization.test.ts` asserts
 * the table and `ORG_CAPABILITIES` still agree.
 *
 * `owner` and `member` are Better Auth's own, unchanged — the matrix asks for
 * nothing of them that the defaults do not already say.
 */
export const ORGANIZATION_ROLES = {
  owner: ownerAc,
  admin: defaultAc.newRole({ ...adminAc.statements, member: ["create"] }),
  member: memberAc,
};

export function organizationOptions(deps: OrganizationPluginDeps): OrganizationOptions {
  return {
    allowUserToCreateOrganization: true,
    creatorRole: "owner",

    /** Narrowed from Better Auth's defaults — see `ORGANIZATION_ROLES`. */
    roles: ORGANIZATION_ROLES,

    organizationHooks: {
      /**
       * Nobody is *invited* as an owner. Becoming one is a promotion, and
       * promotion is owner-only — so it happens to somebody already inside the
       * organization, where the last-owner protections can see it.
       *
       * Better Auth closes only half of this on its own: `crud-invites.mjs`
       * refuses a **non**-owner who asks for `owner`
       * (`YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE`), and lets an owner
       * do it. The role select on the members page offers `member` and `admin`
       * only, but a select is a control, not a boundary.
       *
       * The hook runs after Better Auth's own permission and role-name checks
       * and before the row is written (`beforeCreateInvitation`). It is **not**
       * reached on the resend path, which returns earlier — that costs nothing,
       * because a resend carries the stored role and no owner invitation can
       * exist for it to carry.
       */
      beforeCreateInvitation: async ({ invitation }) => {
        const roles = invitation.role.split(",").map((role) => role.trim());
        if (roles.includes(ROLES.owner)) {
          throw new APIError("FORBIDDEN", {
            code: OWNER_MUST_BE_PROMOTED,
            message: "Invite this person as a member or an admin, then promote them to owner.",
          });
        }
      },
    },

    /** Seven days, and why it is not Better Auth's 48h — see `invitation.ts`. */
    invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,

    /**
     * Pinned `true`, because the default is not `false` — it is *derived*, and
     * the derivation resolves to `false` here.
     * `shouldRequireVerifiedEmailForInvitationIdAction` (`crud-invites.mjs`)
     * returns this option when it is set, and otherwise infers it from how
     * invitation ids are generated: built-in opaque ids are treated as proof
     * enough on their own, so leaving it unset lets an unverified session
     * accept an invitation.
     *
     * `requireEmailVerification` already means a credential account holds no
     * session at all until its address is proven, so this costs nothing there.
     * What it closes is the social path, where the provider decides what
     * `emailVerified` says — the same half of audit #2 that
     * `requireLocalEmailVerified` closes for account linking.
     */
    requireEmailVerificationOnInvitation: true,

    /**
     * Better Auth builds no invitation URL of its own — its JSDoc says so
     * outright, and the handler only ever hands this callback an id.
     *
     * Reached by invite **and resend both**: `/organization/invite-member` with
     * `resend: true` is the same endpoint, reusing the invitation id and only
     * extending `expiresAt`. That is why one prefix in `CLASSIFIERS` covers the
     * pair, and why a resent link is byte-for-byte the link already sent.
     *
     * The recipient comes from `email`, which Better Auth has already
     * lowercased, rather than from `invitation.email` — one source, so a future
     * schema change cannot quietly redirect where mail goes.
     */
    sendInvitationEmail: async ({ id, email, organization: org, inviter }) => {
      await deps.email.send({
        to: email,
        ...invitationEmail({
          url: invitationAcceptUrl(deps.baseURL, id),
          productName: deps.productName,
          organizationName: org.name,
          inviterEmail: inviter.user.email,
          expiresInDays: INVITATION_EXPIRES_IN_DAYS,
        }),
      });
    },
  };
}

/** The configured plugin, ready for `betterAuth({ plugins: [...] })`. */
export function organizationPlugin(deps: OrganizationPluginDeps) {
  return organization(organizationOptions(deps));
}
