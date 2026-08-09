import { test, expect } from "@playwright/test";

/**
 * The hero's shader background fails silently by nature: `@paper-design/shaders`
 * throws from its constructor when WebGL2 is missing, a bad CSP would block the
 * canvas without changing the status code, and a mis-sized container paints
 * nothing. All three leave a 200 and a page that merely looks wrong — so this
 * drives the real browser rather than asserting on a response.
 *
 * **Playwright's headless Chromium has no WebGL2** (no WebGL1 either), so this
 * suite runs the *deny* path of `supportsWebGl2` on every CI run. That is the
 * point: without the guard, the library would throw here and the landing page
 * would render its error boundary instead of the hero. The branch below keeps
 * the spec honest on a headed browser too.
 *
 * `apps/web/app/__tests__/hero-shader.test.ts` covers the colour, speed and
 * support decisions; this covers them reaching the screen.
 */

const heroOf = (page: import("@playwright/test").Page) =>
  page.locator("section").filter({ has: page.getByTestId("hero-background") });

test("the hero renders whether or not the shader can run", async ({ page }) => {
  await page.goto("/");

  // The guard's deny path: no WebGL2 must degrade to the CSS gradient, never to
  // a thrown constructor that takes the page with it.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const background = page.getByTestId("hero-background");
  await expect(background).toBeAttached();

  // The poster is unconditional — it is the server render, and the only
  // composition a browser without WebGL2 ever sees. It is a still of the
  // shader's frame 0, so `cover` and `center` are load-bearing: they are what
  // make it crop the same way the shader does.
  const poster = background.locator(".hero-poster");
  await expect(poster).toHaveCSS("background-image", /^url\("data:image\/webp;base64,/);
  await expect(poster).toHaveCSS("background-size", "cover");
  await expect(poster).toHaveCSS("background-position", "50% 50%");
});

test("the shader canvas mounts exactly when the browser supports WebGL2", async ({ page }) => {
  await page.goto("/");

  const supportsWebGl2 = await page.evaluate(
    () => !!document.createElement("canvas").getContext("webgl2"),
  );
  const canvas = page.getByTestId("hero-background").locator("canvas");

  if (!supportsWebGl2) {
    await expect(canvas).toHaveCount(0);
    return;
  }

  await expect(canvas).toBeAttached();

  // A canvas that mounted but was never sized paints nothing, which is what a
  // broken sizing chain looks like from the outside.
  const surface = await canvas.evaluate((el: HTMLCanvasElement) => ({
    width: el.width,
    height: el.height,
  }));
  expect(surface.width).toBeGreaterThan(0);
  expect(surface.height).toBeGreaterThan(0);
});

test("the background never intercepts clicks meant for the hero CTA", async ({ page }) => {
  await page.goto("/");

  // `pointer-events-none` on a full-bleed overlay is load-bearing: without it
  // the background sits over the CTA and swallows the click.
  await heroOf(page).getByRole("link", { name: "Get Started" }).click();
  await expect(page).toHaveURL(/\/register/);
});
