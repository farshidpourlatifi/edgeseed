import { describe, it, expect, vi } from "vitest";
import { createLoggerSender } from "../logger-sender";
import type { EmailLogger } from "../sender";

const MESSAGE = {
  to: "user@example.com",
  subject: "Verify your email",
  html: "<p>https://app.test/verify?token=secret</p>",
  text: "https://app.test/verify?token=secret",
};

function fakeLogger(): EmailLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), warn: vi.fn() };
}

describe("createLoggerSender", () => {
  it("should log the body at info when the body is included", async () => {
    const logger = fakeLogger();
    await createLoggerSender({ logger, includeBody: true }).send(MESSAGE);

    expect(logger.info).toHaveBeenCalledWith("email.send.logged", {
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      body: MESSAGE.text,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should warn without the body when the body is excluded", async () => {
    const logger = fakeLogger();
    await createLoggerSender({ logger, includeBody: false }).send(MESSAGE);

    expect(logger.warn).toHaveBeenCalledWith("email.send.dropped", {
      subject: MESSAGE.subject,
      reason: "RESEND_API_KEY or EMAIL_FROM is not set",
    });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("should never log the action link when the body is excluded", async () => {
    const logger = fakeLogger();
    await createLoggerSender({ logger, includeBody: false }).send(MESSAGE);

    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("token=secret");
  });

  it("should never log the recipient when the body is excluded", async () => {
    const logger = fakeLogger();
    await createLoggerSender({ logger, includeBody: false }).send(MESSAGE);

    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(MESSAGE.to);
  });

  it("should resolve rather than throw when no provider is configured", async () => {
    const logger = fakeLogger();
    await expect(
      createLoggerSender({ logger, includeBody: false }).send(MESSAGE),
    ).resolves.toBeUndefined();
  });
});
