import { describe, it, expect, vi } from "vitest";
import type { EmailMessage, EmailSender } from "@starter/email";
import { createAuth } from "../server";

/**
 * These assert on `auth.options` rather than on live HTTP because the settings
 * under test ARE the security boundary — audit #2 is a configuration defect,
 * not a code defect. A change to any of them should fail loudly here.
 */

function fakeSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: async (message) => {
      sent.push(message);
    },
  };
}

function build(email: EmailSender = fakeSender()) {
  return createAuth({
    db: {} as never,
    secret: "x".repeat(32),
    baseURL: "http://localhost:5173",
    email,
  });
}

const USER = { email: "user@example.com", name: "User" };
const URL_WITH_CALLBACK = "http://localhost:5173/api/auth/verify-email?token=t0ken&callbackURL=%2F";

describe("createAuth — email verification", () => {
  it("should refuse sign-in until the address is verified", () => {
    expect(build().options.emailAndPassword?.requireEmailVerification).toBe(true);
  });

  it("should send a verification email on sign-up", () => {
    expect(build().options.emailVerification?.sendOnSignUp).toBe(true);
  });

  it("should sign the user in once they follow the link", () => {
    expect(build().options.emailVerification?.autoSignInAfterVerification).toBe(true);
  });

  it("should deliver the verification link to the registering address", async () => {
    const email = fakeSender();
    await build(email).options.emailVerification?.sendVerificationEmail?.(
      { user: USER as never, url: URL_WITH_CALLBACK, token: "t0ken" },
      undefined as never,
    );

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe(USER.email);
    expect(email.sent[0].text).toContain(URL_WITH_CALLBACK);
  });

  it("should deliver the reset link to the requesting address", async () => {
    const email = fakeSender();
    await build(email).options.emailAndPassword?.sendResetPassword?.(
      { user: USER as never, url: URL_WITH_CALLBACK, token: "t0ken" },
      undefined as never,
    );

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe(USER.email);
    expect(email.sent[0].subject.toLowerCase()).toContain("reset");
  });

  it("should propagate a transport failure rather than report a delivery that did not happen", async () => {
    const failing: EmailSender = { send: vi.fn(async () => Promise.reject(new Error("502"))) };

    await expect(
      build(failing).options.emailVerification?.sendVerificationEmail?.(
        { user: USER as never, url: URL_WITH_CALLBACK, token: "t0ken" },
        undefined as never,
      ),
    ).rejects.toThrow("502");
  });
});

describe("createAuth — account linking (audit #2)", () => {
  const linking = () => build().options.account?.accountLinking;

  it("should allow linking so one person is not split across providers", () => {
    expect(linking()?.enabled).toBe(true);
  });

  it("should trust no provider by name", () => {
    // `trustedProviders` means "link even when the provider says the address is
    // UNVERIFIED". Both providers report verification honestly, so naming one
    // here would discard that signal and reopen the pre-hijacking vector.
    expect(linking()?.trustedProviders).toEqual([]);
  });

  it("should refuse to link into a local account that has not proven its address", () => {
    expect(linking()?.requireLocalEmailVerified).toBe(true);
  });

  it("should refuse to link an identity carrying a different address", () => {
    expect(linking()?.allowDifferentEmails).toBe(false);
  });
});
