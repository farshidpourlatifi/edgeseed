import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * What a clone's landing page actually renders — the acceptance criterion of
 * issue #32, and the one thing no other test in this repo can reach.
 *
 * `repo.test.ts` proves `repoLinks("")` is `null`, which says nothing about
 * JSX: a component that hardcoded an `<a href="https://github.com/...">` would
 * pass it, and would pass the e2e specs too, since those run against a checkout
 * whose `PRODUCT_REPO_URL` is set and so cannot tell a derived link from a
 * literal one. This renders the components with the constant mocked empty —
 * the state every freshly stamped clone is in — and asserts the affordances
 * are gone.
 *
 * `.test.ts` with `createElement` rather than `.test.tsx` on purpose: the root
 * vitest config collects only `.test.ts`, and `stryker.config.json` excludes
 * `.react-router` from its crawl on the strength of that (AGENTS.md, issue
 * #30). Rendering to a string needs no DOM, so no jsdom environment either.
 *
 * Covers four of the five affordance sites: the hero's button and clone
 * command, the footer link, and getting-started's clone step. The fifth —
 * `site-header.tsx`'s button — sits inside a Radix `Sheet` whose open state is
 * component-local, so it is not in the static markup and cannot be reached
 * from here. It is covered instead by "the mobile menu's repository button
 * follows the same rule" in `tests/e2e/landing-layout.spec.ts`, which opens the
 * menu in a real browser.
 */

/**
 * The default 5s is not enough for the *first* render in this file.
 *
 * `vi.resetModules()` forces a real import of the landing component graph —
 * radix-ui, lucide, the shader package and a CSS file — and the cold transform
 * of that graph costs about a second on an idle machine and several under the
 * contention of the full suite. Every later render reuses Vite's transform
 * cache and takes milliseconds, so this buys headroom for one specific,
 * understood cost rather than papering over a slow test.
 */
vi.setConfig({ testTimeout: 30_000 });

const REAL_REPO_URL = "https://github.com/acme/acme-cloud";

async function renderLanding(repoUrl: string): Promise<string> {
  vi.resetModules();
  vi.doMock("@starter/config/product", () => ({
    PRODUCT_NAME: "Acme Cloud",
    PRODUCT_SLUG: "acme-cloud",
    MCP_SERVER_NAME: "Acme Cloud MCP",
    PRODUCT_REPO_URL: repoUrl,
  }));

  // Imported after the mock is registered — `repo.ts` reads the constant at
  // module scope, so the registry has to be reset for each state.
  const [{ Hero }, { SiteHeader }, { SiteFooter }, { GettingStarted }] = await Promise.all([
    import("../components/landing/hero"),
    import("../components/landing/site-header"),
    import("../components/landing/site-footer"),
    import("../components/landing/getting-started"),
  ]);

  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Hero),
      createElement(SiteHeader),
      createElement(SiteFooter),
      createElement(GettingStarted),
    ),
  );
}

afterEach(() => {
  vi.doUnmock("@starter/config/product");
  vi.resetModules();
});

describe("a clone that declares no repository", () => {
  it("renders no link to any repository at all", async () => {
    const html = await renderLanding("");

    expect(html).not.toContain("github.com");
    // Every remaining href is in-page or in-app. Asserting on hrefs rather than
    // on the string "http://", which legitimately appears in SVG `xmlns`
    // attributes and in the "Boots the app at http://localhost:5173" copy.
    expect(html).not.toMatch(/href="https?:\/\//);
  });

  it("renders no clone command for anyone to copy", async () => {
    const html = await renderLanding("");

    expect(html).not.toContain("git clone");
  });

  it("drops the clone step and renumbers the rest", async () => {
    const html = await renderLanding("");

    expect(html).toContain("Running locally in 3 commands");
    expect(html).not.toContain("Clone the repository");
    expect(html).toContain("Make it yours");
  });

  it("still renders the sections it owns", async () => {
    const html = await renderLanding("");

    // The affordances are absent, not the page — a blank render would pass
    // every assertion above for the wrong reason.
    expect(html).toContain("Get Started");
    expect(html).toContain("Acme Cloud");
    expect(html.length).toBeGreaterThan(1000);
  });
});

describe("a product that declares a repository", () => {
  it("links to it and to nothing else", async () => {
    const html = await renderLanding(REAL_REPO_URL);

    expect(html).toContain(`href="${REAL_REPO_URL}"`);
    // Every outbound link on the page is that one repository — this is what
    // catches a second, hardcoded URL sitting beside the derived one.
    const outbound = [...html.matchAll(/href="(https?:\/\/[^"]*)"/g)].map((m) => m[1]);
    expect(outbound.length).toBeGreaterThan(0);
    expect([...new Set(outbound)]).toEqual([REAL_REPO_URL]);
  });

  it("builds every clone command from that same URL", async () => {
    const html = await renderLanding(REAL_REPO_URL);

    const clones = [...html.matchAll(/git clone ([^\s<]+)/g)].map((m) => m[1]);
    expect(clones.length).toBeGreaterThan(0);
    expect([...new Set(clones)]).toEqual([REAL_REPO_URL]);
  });

  it("restores the clone step and the count with it", async () => {
    const html = await renderLanding(REAL_REPO_URL);

    expect(html).toContain("Running locally in 4 commands");
    expect(html).toContain("Clone the repository");
  });

  // The reason `repoLinks` may interpolate without quoting: a URL the rule
  // rejects never reaches the page in the first place.
  it("renders nothing for a URL that could not be pasted safely", async () => {
    const html = await renderLanding("https://github.com/acme/$(whoami)");

    expect(html).not.toContain("git clone");
    expect(html).not.toContain("whoami");
  });

  it("renders nothing for a URL carrying a credential", async () => {
    const html = await renderLanding("https://user:token@github.com/acme/acme");

    expect(html).not.toContain("token");
    expect(html).not.toContain("git clone");
  });
});

/**
 * The demo-video section is product-owned, and its absence is the point.
 *
 * The film is EdgeSeed-branded footage no rename can rewrite, so the section
 * renders only when the product declares one via `PRODUCT_DEMO_VIDEO` — cleared
 * by `init:product`. A component that hardcoded the `<video>` would pass
 * `landing-demo.test.ts` (which only tests the helper), so this renders the
 * component against a mocked-empty constant — the same thing this file does for
 * the repository affordances, and the only check that catches a gate the
 * component forgets to apply (issue #32).
 */
async function renderDemo(demoVideo: string): Promise<string> {
  vi.resetModules();
  vi.doMock("@starter/config/product", () => ({
    PRODUCT_NAME: "Acme Cloud",
    PRODUCT_SLUG: "acme-cloud",
    MCP_SERVER_NAME: "Acme Cloud MCP",
    PRODUCT_REPO_URL: "",
    PRODUCT_DEMO_VIDEO: demoVideo,
  }));

  const { DemoVideo } = await import("../components/landing/demo-video");
  return renderToStaticMarkup(createElement(DemoVideo));
}

describe("a product that declares no demo film", () => {
  it("renders no demo section at all", async () => {
    expect(await renderDemo("")).toBe("");
  });
});

describe("a product that declares a demo film", () => {
  it("renders the section, its source and its poster", async () => {
    const html = await renderDemo("/demo.mp4");

    expect(html).toContain("Watch it go from clone to deployed");
    expect(html).toContain('src="/demo.mp4"');
    expect(html).toContain('poster="/demo-poster.webp"');
  });
});
