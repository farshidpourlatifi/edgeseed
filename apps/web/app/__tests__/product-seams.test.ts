import { readdirSync, readFileSync } from "node:fs";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { RouteConfigEntry } from "@react-router/dev/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

// Resolved from this file, not the working directory: Stryker runs the suite
// from a sandbox copy.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function flatten(entries: RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

/**
 * Files importing generated route types (`+types/<module>`) for a module the
 * route config does not mount. Only a mounted module gets generated types, so
 * each of these stops typechecking. Paths are relative to `app/`, with `/`.
 */
function unmountedRouteTypeImports(
  sources: Record<string, string>,
  mounted: readonly string[],
): string[] {
  const modules = new Set(mounted.map((file) => file.replace(/\.tsx?$/, "")));
  return Object.keys(sources).filter((file) =>
    [...sources[file].matchAll(/["'](\.[^"']*)\+types\/([^"']+)["']/g)].some(
      ([, directory, name]) => !modules.has(posix.join(posix.dirname(file), directory, name)),
    ),
  );
}

afterEach(() => {
  vi.doUnmock("../product/dashboard");
  vi.resetModules();
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

  it("leaves no module importing generated route types the route config does not produce", async () => {
    const { default: routes } = (await import("../routes")) as { default: RouteConfigEntry[] };
    const sources = Object.fromEntries(
      (readdirSync(APP_DIR, { recursive: true }) as string[])
        .filter((file) => /\.tsx?$/.test(file))
        .filter((file) => !file.split(sep).includes("__tests__"))
        .map((file) => [file.split(sep).join("/"), readFileSync(join(APP_DIR, file), "utf8")]),
    );

    const offenders = unmountedRouteTypeImports(
      sources,
      flatten(routes).map((entry) => entry.file),
    );

    expect(
      offenders,
      `imports route types of an un-mounted module: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
