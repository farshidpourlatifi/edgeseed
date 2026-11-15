import { test, expect } from "@playwright/test";

import { DEMO_VIDEO } from "../../apps/web/app/components/landing/demo";
import { NOT_STARTER_LANDING, STARTER_LANDING_MOUNTED } from "./helpers";

/**
 * The landing page's walkthrough film section.
 *
 * The film is the product's to declare, and a freshly stamped clone declares
 * none. So the section's presence is asserted against what this build
 * declares, with the same statements in both states, and everything here
 * reads the film and its poster from that declaration rather than naming
 * files. The tests that need a film to exist are registered only when one is
 * declared; nothing outside those blocks may read a field of the declaration,
 * or this file stops loading in every clone without a film.
 *
 * With a film, two things matter and neither is playback (which is flaky to
 * assert in CI): the `<video>` is wired for lazy, poster-first delivery, and
 * **no video bytes are fetched until the user presses play**. `preload="none"`
 * plus no autoplay is what makes a multi-megabyte asset free to a visitor who
 * scrolls past, so this drives a real browser and inspects the network rather
 * than trusting the attribute alone.
 *
 * `<video>` has no ARIA role Playwright can target, so it is reached by
 * `data-testid` — the sanctioned escape hatch for a role-less element
 * (`tests/e2e/CLAUDE.md`).
 */

test.describe("the demo section on the starter's landing page", () => {
  test.skip(() => !STARTER_LANDING_MOUNTED, NOT_STARTER_LANDING);

  test("the section is on the page exactly when the product declares a film", async ({ page }) => {
    const expected = DEMO_VIDEO ? 1 : 0;

    await page.goto("/");

    // The page rendered, so a count of zero below means absent rather than
    // not there yet.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId("demo-video")).toHaveCount(expected);
    await expect(page.locator("#demo")).toHaveCount(expected);
    await expect(page.getByRole("heading", { name: /clone to deployed/i })).toHaveCount(expected);
  });

  if (DEMO_VIDEO) {
    const film = DEMO_VIDEO;

    test("the demo section renders with a poster-first, lazy-loaded video", async ({ page }) => {
      await page.goto("/");

      await expect(page.getByRole("heading", { name: /clone to deployed/i })).toBeVisible();

      const video = page.getByTestId("demo-video");
      await expect(video).toBeAttached();

      // Poster-first and lazy by construction — the attributes that keep the
      // file off the wire until play.
      await expect(video).toHaveAttribute("poster", film.poster);
      await expect(video).toHaveAttribute("preload", "none");
      // Named for assistive tech, and its source is the film the build declares.
      await expect(video).toHaveAttribute("aria-label", /walkthrough/i);
      await expect(video.locator("source")).toHaveAttribute("src", film.src);

      // The text alternative for anyone who won't press play: one item per beat
      // of the film. A missing list would strand the content behind a control.
      // Scoped by region id, then selected by role — never a structure selector,
      // which couples the test to markup that can change without behaviour
      // (tests/e2e/CLAUDE.md).
      await expect(page.locator("#demo").getByRole("listitem")).toHaveCount(6);
    });

    test("no video bytes are fetched before the user presses play", async ({ page }) => {
      const videoRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === film.src) videoRequests.push(request.url());
      });

      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // The poster may load; the film must not. `preload="none"` + no autoplay
      // is the whole point of the section's delivery model.
      const video = page.getByTestId("demo-video");
      await expect(video).toBeAttached();
      expect(videoRequests).toEqual([]);
    });
  }
});

if (DEMO_VIDEO) {
  const film = DEMO_VIDEO;

  // Outside the landing-page group: the files ship with the build whichever
  // module renders `/`.
  test("the declared film and its poster are actually served", async ({ page }) => {
    // The lazy-load tests stay green even if the film is missing or corrupt —
    // they only read the source and prove nothing is fetched before play. This
    // closes that gap by fetching the asset itself. (Range/seek delivery is
    // Cloudflare's job in production; here the point is that the file exists
    // and serves.)
    const video = await page.request.get(film.src);
    expect(video.status()).toBe(200);
    expect(video.headers()["content-type"]).toContain("video/");
    expect((await video.body()).byteLength).toBeGreaterThan(0);

    const poster = await page.request.get(film.poster);
    expect(poster.status()).toBe(200);
    expect(poster.headers()["content-type"]).toContain("image/webp");
  });
}
