import { describe, it, expect, vi } from "vitest";
import { createResendSender } from "../resend";
import { EmailSendError } from "../sender";

const MESSAGE = {
  to: "user@example.com",
  subject: "Verify your email",
  html: "<p>hi</p>",
  text: "hi",
};

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
}

describe("createResendSender", () => {
  it("should post to the Resend emails endpoint when sending", async () => {
    const fetchImpl = okFetch();
    await createResendSender({ apiKey: "re_key", from: "a@b.com", fetchImpl }).send(MESSAGE);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
  });

  it("should authenticate with a bearer token when sending", async () => {
    const fetchImpl = okFetch();
    await createResendSender({ apiKey: "re_key", from: "a@b.com", fetchImpl }).send(MESSAGE);

    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("should send the configured sender and the message fields when sending", async () => {
    const fetchImpl = okFetch();
    await createResendSender({
      apiKey: "re_key",
      from: "Starter <no-reply@example.com>",
      fetchImpl,
    }).send(MESSAGE);

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body).toEqual({
      from: "Starter <no-reply@example.com>",
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
    });
  });

  it("should throw EmailSendError when the provider rejects the send", async () => {
    const fetchImpl = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    const sender = createResendSender({ apiKey: "re_key", from: "a@b.com", fetchImpl });

    await expect(sender.send(MESSAGE)).rejects.toThrow(EmailSendError);
  });

  it("should carry the status and detail when the provider rejects the send", async () => {
    const fetchImpl = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    const sender = createResendSender({ apiKey: "re_key", from: "a@b.com", fetchImpl });

    const error = await sender.send(MESSAGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect((error as EmailSendError).status).toBe(403);
    expect((error as EmailSendError).detail).toBe("domain not verified");
  });

  it("should never put the api key in the error message when the send fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const sender = createResendSender({ apiKey: "re_super_secret", from: "a@b.com", fetchImpl });

    const error = (await sender.send(MESSAGE).catch((e: unknown) => e)) as EmailSendError;
    expect(`${error.message}${error.detail}`).not.toContain("re_super_secret");
  });

  it("should truncate an oversized error body when the provider rejects the send", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(2000), { status: 500 }));
    const sender = createResendSender({ apiKey: "re_key", from: "a@b.com", fetchImpl });

    const error = (await sender.send(MESSAGE).catch((e: unknown) => e)) as EmailSendError;
    expect(error.detail).toHaveLength(500);
  });

  it("should not throw a second error when the failure body cannot be read", async () => {
    const unreadable = {
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error("stream closed")),
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => unreadable);
    const sender = createResendSender({ apiKey: "re_key", from: "a@b.com", fetchImpl });

    const error = (await sender.send(MESSAGE).catch((e: unknown) => e)) as EmailSendError;
    expect(error).toBeInstanceOf(EmailSendError);
    expect(error.detail).toBe("<unreadable response body>");
  });

  it("should resolve without throwing when the provider accepts the send", async () => {
    const sender = createResendSender({ apiKey: "re_key", from: "a@b.com", fetchImpl: okFetch() });
    await expect(sender.send(MESSAGE)).resolves.toBeUndefined();
  });
});
