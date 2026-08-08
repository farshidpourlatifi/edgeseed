import { describe, it, expect } from "vitest";
import { resolveDbTarget } from "../lib/db-target";

describe("resolveDbTarget", () => {
  it("should target local when no flag is given", () => {
    expect(resolveDbTarget(["node", "db-migrate.ts"])).toEqual({
      remote: false,
      flag: "--local",
      label: "local",
    });
  });

  it("should target remote when --remote is given", () => {
    expect(resolveDbTarget(["node", "db-migrate.ts", "--remote"])).toEqual({
      remote: true,
      flag: "--remote",
      label: "remote",
    });
  });

  // The regression this module exists for: the flag used to be "" for remote,
  // and wrangler treats a missing flag as LOCAL. So `db:migrate --remote`
  // migrated the developer's own database and reported success, while
  // production was never touched.
  it("should never produce an empty flag, because wrangler defaults to local", () => {
    for (const argv of [[], ["--remote"], ["--local"], ["--remote", "--verbose"]]) {
      const target = resolveDbTarget(argv);
      expect(target.flag).not.toBe("");
      expect(["--remote", "--local"]).toContain(target.flag);
    }
  });

  it("should keep the label consistent with the flag", () => {
    for (const argv of [[], ["--remote"]]) {
      const target = resolveDbTarget(argv);
      expect(target.flag).toBe(`--${target.label}`);
      expect(target.remote).toBe(target.label === "remote");
    }
  });

  it("should not treat an unrelated argument as remote", () => {
    expect(resolveDbTarget(["node", "db-migrate.ts", "--remote-ish"]).remote).toBe(false);
    expect(resolveDbTarget(["node", "db-migrate.ts", "remote"]).remote).toBe(false);
  });
});
