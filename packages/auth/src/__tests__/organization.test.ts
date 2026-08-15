import { describe, it, expect, vi } from "vitest";
import { createEmailSender, type EmailMessage, type EmailSender } from "@starter/email";
import { organizationOptions } from "../organization";
import { INVITATION_EXPIRES_IN_SECONDS } from "../invitation";

/**
 * The invitation half of the organization plugin is *configuration*, in the
 * same class as everything `auth-config.test.ts` guards: nothing here is a code
 * path that would fail loudly if it were wrong. A missing
 * `requireEmailVerificationOnInvitation` still serves every request, it just
 * lets an unproven address join an organization.
 *
 * These call `organizationOptions` directly because the plugin does not expose
 * its own configuration — `organization()` captures the argument in closures and
 * the object it returns carries only `id`, `endpoints` and `schema`.
 */

function fakeSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return { sent, send: async (message) => void sent.push(message) };
}

function build(email: EmailSender = fakeSender()) {
  return organizationOptions({
    email,
    baseURL: "https://app.example.com",
    productName: "Starter",
  });
}

/** The shape better-auth hands `sendInvitationEmail` (`crud-invites.mjs`). */
function invitationData(overrides: Partial<{ id: string; email: string }> = {}) {
  return {
    id: overrides.id ?? "inv_abc123",
    role: "member",
    email: overrides.email ?? "invitee@example.com",
    organization: { name: "Northwind Trading", slug: "northwind" },
    inviter: { user: { email: "owner@example.com" } },
    invitation: {},
  } as never;
}

describe("organizationOptions — invitations", () => {
  it("should expire invitations after the pinned window, not better-auth's default", () => {
    expect(build().invitationExpiresIn).toBe(INVITATION_EXPIRES_IN_SECONDS);
  });

  /**
   * The deny path. Unset, better-auth *derives* this from how invitation ids
   * are generated and lands on `false` for our configuration, so the assertion
   * that matters is that it is explicitly on.
   */
  it("should refuse an unverified session before it can accept", () => {
    expect(build().requireEmailVerificationOnInvitation).toBe(true);
  });

  it("should send the invitation to the invited address", async () => {
    const email = fakeSender();
    await build(email).sendInvitationEmail?.(
      invitationData({ email: "invitee@example.com" }),
      undefined as never,
    );

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe("invitee@example.com");
  });

  /**
   * The split-origin trap, at the call site rather than in the URL builder.
   * Better Auth generates no invitation URL, so nothing but this callback puts
   * a link in the message — an omission would send a mail with no way in and
   * report nothing.
   */
  it("should carry an accept link on the app origin", async () => {
    const email = fakeSender();
    await build(email).sendInvitationEmail?.(invitationData({ id: "inv_xyz" }), undefined as never);

    expect(email.sent[0]?.text).toContain("https://app.example.com/accept-invitation?id=inv_xyz");
  });

  it("should name the organization and the inviter, so a stray invitation is recognisable", async () => {
    const email = fakeSender();
    await build(email).sendInvitationEmail?.(invitationData(), undefined as never);

    expect(email.sent[0]?.subject).toContain("Northwind Trading");
    expect(email.sent[0]?.subject).toContain("owner@example.com");
  });

  it("should still create organizations with the creator as owner", () => {
    expect(build().allowUserToCreateOrganization).toBe(true);
    expect(build().creatorRole).toBe("owner");
  });
});

/**
 * The whole chain with no provider configured, which is what a fresh clone and
 * every CI run actually look like.
 *
 * Asserted end to end rather than on `createEmailSender` alone: the transport
 * choice is already covered in `@starter/email`, and what is unproven here is
 * that an invitation reaches it at all — a `sendInvitationEmail` that threw, or
 * one that was never called, would leave the same empty inbox as a missing
 * `RESEND_API_KEY` and only this distinguishes them.
 */
describe("organizationOptions — the no-provider fallback", () => {
  it("should log the accept link instead of sending, when RESEND vars are unset", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const fetchImpl = vi.fn();

    await organizationOptions({
      email: createEmailSender({ logger, environment: "development", fetchImpl }),
      baseURL: "https://app.example.com",
      productName: "Starter",
    }).sendInvitationEmail?.(invitationData({ id: "inv_logged" }), undefined as never);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
    // The body carries the link, which in development IS the delivery
    // mechanism — reading it out of `pnpm dev` is how a local invitation is
    // followed at all.
    expect(logger.info.mock.calls[0]?.[1]?.body).toContain("/accept-invitation?id=inv_logged");
  });

  it("should drop the body outside development, since the link is a live credential", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };

    await organizationOptions({
      email: createEmailSender({ logger, environment: "production", fetchImpl: vi.fn() }),
      baseURL: "https://app.example.com",
      productName: "Starter",
    }).sendInvitationEmail?.(invitationData(), undefined as never);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.warn.mock.calls[0])).not.toContain("accept-invitation");
  });
});
