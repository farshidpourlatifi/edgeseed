import { organization } from "better-auth/plugins";
import { invitationEmail, type EmailSender } from "@starter/email";
import {
  INVITATION_EXPIRES_IN_DAYS,
  INVITATION_EXPIRES_IN_SECONDS,
  invitationAcceptUrl,
} from "./invitation";

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

export function organizationOptions(deps: OrganizationPluginDeps): OrganizationOptions {
  return {
    allowUserToCreateOrganization: true,
    creatorRole: "owner",

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
