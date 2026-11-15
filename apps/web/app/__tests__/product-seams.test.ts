import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { RouteConfigEntry } from "@react-router/dev/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STARTER_LANDING_ROUTE } from "../lib/starter-landing";

// Resolved from this file, not the working directory: Stryker runs the suite
// from a sandbox copy.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function flatten(entries: RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

/**
 * Files importing generated route types (`+types/<module>`) that the route
 * config does not produce for them. Only a mounted module gets generated
 * types, so an import of an un-mounted module's stops typechecking. A file
 * under `routes/_examples/` is flagged for any such import: it is never
 * mounted itself, and the module it borrows from is un-mounted in a clone
 * that swapped it out. Paths are relative to `app/`, with `/`.
 */
function unmountedRouteTypeImports(
  sources: Record<string, string>,
  mounted: readonly string[],
  appDir: string = APP_DIR,
): string[] {
  // React Router's own normalisation: a route file may be written bare,
  // `./`-prefixed or absolute, and all three name the same module.
  const modules = new Set(
    mounted.map((file) =>
      relative(appDir, resolve(appDir, file))
        .split(sep)
        .join("/")
        .replace(/\.[a-z0-9]+$/i, ""),
    ),
  );
  return Object.keys(sources).filter((file) => {
    const imports = [...sources[file].matchAll(/["'](\.[^"']*)\+types\/([^"']+)["']/g)];
    if (file.startsWith("routes/_examples/")) return imports.length > 0;
    return imports.some(
      ([, directory, name]) => !modules.has(posix.join(posix.dirname(file), directory, name)),
    );
  });
}

afterEach(() => {
  vi.doUnmock("../product/dashboard");
  vi.doUnmock("../product/landing");
  vi.resetModules();
});

describe("landing seam", () => {
  it("mounts the module the product names at /", async () => {
    vi.resetModules();
    vi.doMock("../product/landing", () => ({ LANDING_ROUTE: "product/acme-landing.tsx" }));

    const { default: routes } = (await import("../routes")) as { default: RouteConfigEntry[] };

    // One index entry: the default landing module is un-mounted, not mounted
    // beside the product's.
    expect(routes.filter((entry) => entry.index === true).map((entry) => entry.file)).toEqual([
      "product/acme-landing.tsx",
    ]);
  });
});

describe("dashboard home seam", () => {
  it("mounts the module the product names, as a child of the dashboard layout", async () => {
    vi.resetModules();
    vi.doMock("../product/dashboard", () => ({ DASHBOARD_HOME_ROUTE: "product/acme-home.tsx" }));

    const { default: routes } = (await import("../routes")) as { default: RouteConfigEntry[] };

    const layout = routes.find((entry) => entry.file === "routes/dashboard.tsx");
    const home = layout?.children?.find((entry) => entry.path === "dashboard");
    expect(home?.file).toBe("product/acme-home.tsx");

    // One entry answers `/dashboard`: the default home is un-mounted, not
    // mounted beside the product's.
    expect(flatten(routes).filter((entry) => entry.path === "dashboard")).toHaveLength(1);
  });

  it("flags an import of generated route types for a module the config does not mount", () => {
    const sources = {
      "routes/dashboard.tsx": 'import type { Route } from "./+types/dashboard._index";',
      "routes/_examples/widgets.tsx": 'import type { Route } from "../+types/dashboard._index";',
    };

    expect(
      unmountedRouteTypeImports(sources, ["routes/dashboard.tsx", "product/home.tsx"]),
    ).toEqual(["routes/dashboard.tsx", "routes/_examples/widgets.tsx"]);
  });

  it("passes a mounted module importing its own generated route types", () => {
    // A product that customised the default home in place keeps this import,
    // and its types exist for as long as the constant names the module.
    const sources = {
      "routes/dashboard._index.tsx": 'import type { Route } from "./+types/dashboard._index";',
      "product/home.tsx": "import type { Route } from './+types/home';",
    };

    expect(
      unmountedRouteTypeImports(sources, ["routes/dashboard._index.tsx", "product/home.tsx"]),
    ).toEqual([]);
  });

  it("counts a module as mounted however the route config spells its file", () => {
    // React Router normalises the file before deriving the route id and the
    // types path, so `./x.tsx` and an absolute path under `app/` both mount `x`.
    const sources = { "product/home.tsx": 'import type { Route } from "./+types/home";' };

    expect(unmountedRouteTypeImports(sources, ["./product/home.tsx"], "/repo/app")).toEqual([]);
    expect(unmountedRouteTypeImports(sources, ["/repo/app/product/home.tsx"], "/repo/app")).toEqual(
      [],
    );
    expect(
      unmountedRouteTypeImports(sources, ["/repo/other/product/home.tsx"], "/repo/app"),
    ).toEqual(["product/home.tsx"]);
  });

  it("flags an example importing generated route types, even of a mounted module", () => {
    // Examples are never mounted, and the module one borrows types from is
    // un-mounted in any clone that swapped it out.
    const sources = {
      "routes/_examples/widgets.tsx": 'import type { Route } from "../+types/dashboard._index";',
      "routes/dashboard._index.tsx": 'import type { Route } from "./+types/dashboard._index";',
    };

    expect(
      unmountedRouteTypeImports(sources, ["routes/dashboard._index.tsx"], "/repo/app"),
    ).toEqual(["routes/_examples/widgets.tsx"]);
  });

  it("leaves no module importing generated route types the route config does not produce", async () => {
    const { default: routes } = (await import("../routes")) as { default: RouteConfigEntry[] };
    const sources = Object.fromEntries(
      (readdirSync(APP_DIR, { recursive: true }) as string[])
        .filter((file) => /\.tsx?$/.test(file))
        .filter((file) => !file.split(sep).includes("__tests__"))
        .map((file) => [file.split(sep).join("/"), readFileSync(join(APP_DIR, file), "utf8")]),
    );

    // The default landing module counts as un-mounted even while it is the
    // one mounted: a product swaps it out without editing it, so nothing,
    // itself included, may need its generated types.
    const offenders = unmountedRouteTypeImports(
      sources,
      flatten(routes)
        .map((entry) => entry.file)
        .filter((file) => file !== STARTER_LANDING_ROUTE),
    );

    expect(
      offenders,
      `imports route types of an un-mounted module: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
