import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { RouteConfigEntry } from "@react-router/dev/routes";
import { afterEach, describe, expect, it, vi } from "vitest";

// Resolved from this file, not the working directory: Stryker runs the suite
// from a sandbox copy.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function flatten(entries: RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
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

  it("leaves no module depending on the default home's generated route types", () => {
    // A module outside the route config gets no generated types, so anything
    // importing these stops typechecking the moment a product mounts its own
    // home.
    const offenders = (readdirSync(APP_DIR, { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => !file.split(sep).includes("__tests__"))
      .filter((file) =>
        readFileSync(join(APP_DIR, file), "utf8").includes("+types/dashboard._index"),
      );

    expect(offenders, `imports the default home's route types: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });
});
