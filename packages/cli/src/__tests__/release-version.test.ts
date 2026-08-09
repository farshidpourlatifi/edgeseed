import { describe, it, expect } from "vitest";

import {
  backoffMs,
  compareVersions,
  healthProblem,
  releaseOrderProblem,
  parseAppVersion,
  parseDeployOutput,
  parseTagVersion,
  releaseVersionProblems,
  smokeUrls,
} from "../lib/release-version";

describe("compareVersions", () => {
  it("should order by major first", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("should order by minor when majors match", () => {
    expect(compareVersions("1.2.0", "1.3.0")).toBeLessThan(0);
  });

  it("should order by patch when major and minor match", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
  });

  it("should report equality", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  // The bug a string comparison would have: "0.9.0" > "0.10.0" lexically.
  it("should compare components numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });

  // The contract is major.minor.patch. Reading a fourth component would compare
  // it against `undefined` and yield NaN, which sorts unpredictably.
  it("should ignore anything beyond the third component", () => {
    expect(compareVersions("1.2.3.4", "1.2.3.5")).toBe(0);
  });
});

describe("releaseOrderProblem", () => {
  it("should allow the first release, with nothing already out", () => {
    expect(releaseOrderProblem("v1.0.0", [])).toBeNull();
  });

  it("should allow a strictly newer tag", () => {
    expect(releaseOrderProblem("v1.2.3", ["v1.2.2", "v1.0.0"])).toBeNull();
  });

  // The queued-tags race: order of execution is not guaranteed, so an older
  // tag can arrive after a newer one has already deployed.
  it("should refuse a tag older than something already released", () => {
    expect(releaseOrderProblem("v1.2.1", ["v1.2.2"])).toContain("backwards");
  });

  it("should refuse re-releasing the same version", () => {
    expect(releaseOrderProblem("v1.2.3", ["v1.2.3"])).toContain("backwards");
  });

  it("should name the highest blocking release, not merely the first", () => {
    expect(releaseOrderProblem("v1.0.0", ["v1.2.2", "v2.5.1", "v1.3.0"])).toContain("v2.5.1");
  });

  it("should ignore tags that are not releases", () => {
    expect(releaseOrderProblem("v1.2.3", ["nightly", "backup-2026", "v1.2.2"])).toBeNull();
  });

  it("should refuse a tag it cannot parse", () => {
    expect(releaseOrderProblem("nightly", ["v1.0.0"])).toContain("not a vMAJOR.MINOR.PATCH");
  });

  it("should compare numerically across a version-10 boundary", () => {
    expect(releaseOrderProblem("v0.9.0", ["v0.10.0"])).toContain("backwards");
  });
});

describe("backoffMs", () => {
  it("should start well under a second so a fast deploy is not padded", () => {
    expect(backoffMs(0)).toBe(500);
  });

  it("should double each attempt", () => {
    expect([backoffMs(1), backoffMs(2), backoffMs(3)]).toEqual([1000, 2000, 4000]);
  });

  it("should cap so a long deadline is not spent in one sleep", () => {
    expect(backoffMs(20)).toBe(8000);
  });

  it("should honour a caller's cap", () => {
    expect(backoffMs(10, 1500)).toBe(1500);
  });

  it("should not cap a delay that is still under the limit", () => {
    expect(backoffMs(1, 1500)).toBe(1000);
  });
});

describe("parseTagVersion", () => {
  it("should extract the version from a release tag", () => {
    expect(parseTagVersion("v1.2.3")).toBe("1.2.3");
  });

  it("should tolerate surrounding whitespace from a shell capture", () => {
    expect(parseTagVersion("  v0.1.0\n")).toBe("0.1.0");
  });

  it("should accept multi-digit components in every position", () => {
    expect(parseTagVersion("v10.20.30")).toBe("10.20.30");
  });

  it("should reject a tag that merely ends in a version", () => {
    expect(parseTagVersion("release-v1.2.3")).toBeNull();
  });

  it("should reject a tag with no v prefix", () => {
    expect(parseTagVersion("1.2.3")).toBeNull();
  });

  it("should reject a tag missing the patch component", () => {
    expect(parseTagVersion("v1.2")).toBeNull();
  });

  it("should reject a prerelease suffix version:bump cannot produce", () => {
    expect(parseTagVersion("v1.2.3-beta.1")).toBeNull();
  });

  it("should reject a non-version tag", () => {
    expect(parseTagVersion("latest")).toBeNull();
  });

  it("should reject a tag with trailing content", () => {
    expect(parseTagVersion("v1.2.3-rc")).toBeNull();
  });
});

describe("parseAppVersion", () => {
  it("should read APP_VERSION from the version module source", () => {
    expect(parseAppVersion('export const APP_VERSION = "0.4.1";')).toBe("0.4.1");
  });

  it("should read it regardless of spacing around the assignment", () => {
    expect(parseAppVersion('export const APP_VERSION="2.0.0";')).toBe("2.0.0");
  });

  it("should return null when the constant was renamed away", () => {
    expect(parseAppVersion('export const VERSION = "0.4.1";')).toBeNull();
  });
});

describe("releaseVersionProblems", () => {
  const ok = { tag: "v1.2.3", packageVersion: "1.2.3", appVersion: "1.2.3" };

  it("should report nothing when tag, package and APP_VERSION agree", () => {
    expect(releaseVersionProblems(ok)).toEqual([]);
  });

  it("should refuse a tag that is not a release tag, without checking further", () => {
    const problems = releaseVersionProblems({ ...ok, tag: "nightly" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("nightly");
  });

  it("should report a package.json left behind by the tag", () => {
    const problems = releaseVersionProblems({ ...ok, packageVersion: "1.2.2" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("package.json");
  });

  it("should report an APP_VERSION left behind by the tag", () => {
    const problems = releaseVersionProblems({ ...ok, appVersion: "1.2.2" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("APP_VERSION");
  });

  // Distinct from a mismatch: a missing constant means the version module was
  // renamed, which a "APP_VERSION is null, tag says 1.2.3" message reports as
  // a version disagreement and sends the reader looking in the wrong place.
  it("should report a missing APP_VERSION as missing, not as a mismatch", () => {
    const problems = releaseVersionProblems({ ...ok, appVersion: null });
    expect(problems).toEqual(["APP_VERSION not found in packages/config/src/version.ts"]);
  });

  it("should report both versions when the tag agrees with neither", () => {
    expect(
      releaseVersionProblems({ tag: "v2.0.0", packageVersion: "1.2.3", appVersion: "1.2.3" }),
    ).toHaveLength(2);
  });
});

describe("parseDeployOutput", () => {
  const deployLine = JSON.stringify({
    type: "deploy",
    version: 1,
    worker_name: "edgeseed-web",
    worker_tag: "abc123",
    version_id: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
    targets: ["app.edgeseed.dev", "edgeseed.dev"],
    timestamp: "2026-08-09T13:55:37.938Z",
  });

  it("should read the version id and targets from a deploy record", () => {
    expect(parseDeployOutput(deployLine)).toEqual({
      versionId: "9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
      targets: ["app.edgeseed.dev", "edgeseed.dev"],
    });
  });

  it("should ignore entries of other types written by the same run", () => {
    const ndjson = [
      JSON.stringify({ type: "version-upload", version_id: "not-a-deploy" }),
      deployLine,
    ].join("\n");
    expect(parseDeployOutput(ndjson)?.versionId).toBe("9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f");
  });

  // The type check has to hold in both directions: a later non-deploy entry
  // carrying its own string `version_id` must not overwrite the deploy's.
  it("should ignore a non-deploy entry written after the deploy", () => {
    const ndjson = [
      deployLine,
      JSON.stringify({ type: "version-upload", version_id: "written-later" }),
    ].join("\n");
    expect(parseDeployOutput(ndjson)?.versionId).toBe("9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f");
  });

  // wrangler appends across invocations, and `deploy:web` runs the whole verify
  // gate — which drives wrangler — before deploying.
  it("should take the last deploy record, not the first", () => {
    const ndjson = [
      JSON.stringify({ type: "deploy", version_id: "earlier", targets: [] }),
      deployLine,
    ].join("\n");
    expect(parseDeployOutput(ndjson)?.versionId).toBe("9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f");
  });

  it("should skip malformed lines rather than throwing on them", () => {
    expect(parseDeployOutput(`not json at all\n${deployLine}`)?.targets).toEqual([
      "app.edgeseed.dev",
      "edgeseed.dev",
    ]);
  });

  it("should tolerate blank lines", () => {
    expect(parseDeployOutput(`\n${deployLine}\n\n`)).not.toBeNull();
  });

  it("should reject a deploy record whose version id is not a string", () => {
    expect(parseDeployOutput(JSON.stringify({ type: "deploy", version_id: 42 }))).toBeNull();
  });

  it("should default targets to empty when the field is absent", () => {
    expect(parseDeployOutput(JSON.stringify({ type: "deploy", version_id: "v" }))).toEqual({
      versionId: "v",
      targets: [],
    });
  });

  it("should drop non-string targets", () => {
    expect(
      parseDeployOutput(JSON.stringify({ type: "deploy", version_id: "v", targets: ["a", 7] }))
        ?.targets,
    ).toEqual(["a"]);
  });

  it("should return null when nothing was deployed", () => {
    expect(parseDeployOutput("")).toBeNull();
  });
});

describe("smokeUrls", () => {
  // Verbatim from a real `wrangler deploy` (4.79.0). Targets are rendered
  // *display* strings, and the list wrangler prints is the same array it writes
  // to the structured output — so the annotation is in the data, not just the
  // console. Parsing these as bare hosts produced
  // "https://app.edgeseed.dev (custom domain)" and failed every origin.
  it("should strip the route-kind annotation wrangler appends", () => {
    expect(smokeUrls(["app.edgeseed.dev (custom domain)", "edgeseed.dev (custom domain)"])).toEqual(
      ["https://app.edgeseed.dev", "https://edgeseed.dev"],
    );
  });

  it("should strip a zone-qualified annotation", () => {
    expect(smokeUrls(["edgeseed.dev/api/* (custom domain - zone name: edgeseed.dev)"])).toEqual([
      "https://edgeseed.dev",
    ]);
  });

  // wrangler truncates the list past ten routes with a plain-English line.
  it("should drop the truncation notice, which names no host", () => {
    expect(smokeUrls(["app.edgeseed.dev (custom domain)", "...and 3 more routes"])).toEqual([
      "https://app.edgeseed.dev",
    ]);
  });

  it("should drop a single-label host that cannot be a real origin", () => {
    expect(smokeUrls(["localhost"])).toEqual([]);
  });

  it("should tolerate a padded target", () => {
    expect(smokeUrls(["  app.edgeseed.dev  "])).toEqual(["https://app.edgeseed.dev"]);
  });

  // Fail closed on a shape this does not understand. Were wrangler to drop the
  // space before its annotation, accepting the leading hostname would build a
  // URL with the annotation still glued on; refusing makes `check:deployed`
  // report "no requestable target" instead of a request that cannot succeed.
  it("should reject trailing junk rather than accepting the host prefix", () => {
    expect(smokeUrls(["edgeseed.dev(custom domain)"])).toEqual([]);
  });

  it("should turn a bare custom domain into an https origin", () => {
    expect(smokeUrls(["app.edgeseed.dev"])).toEqual(["https://app.edgeseed.dev"]);
  });

  it("should keep a workers.dev target that already carries its protocol", () => {
    expect(smokeUrls(["https://edgeseed-web.example.workers.dev"])).toEqual([
      "https://edgeseed-web.example.workers.dev",
    ]);
  });

  it("should upgrade an http target rather than requesting it in the clear", () => {
    expect(smokeUrls(["http://app.edgeseed.dev"])).toEqual(["https://app.edgeseed.dev"]);
  });

  it("should strip a route pattern's path", () => {
    expect(smokeUrls(["edgeseed.dev/api/*"])).toEqual(["https://edgeseed.dev"]);
  });

  it("should drop a wildcard host it cannot resolve to one origin", () => {
    expect(smokeUrls(["*.edgeseed.dev/*"])).toEqual([]);
  });

  it("should keep every distinct origin, in order", () => {
    expect(smokeUrls(["app.edgeseed.dev", "edgeseed.dev"])).toEqual([
      "https://app.edgeseed.dev",
      "https://edgeseed.dev",
    ]);
  });

  it("should collapse two patterns on the same host", () => {
    expect(smokeUrls(["edgeseed.dev/api/*", "edgeseed.dev/*"])).toEqual(["https://edgeseed.dev"]);
  });

  it("should drop an empty target rather than yielding https://", () => {
    expect(smokeUrls(["", "  "])).toEqual([]);
  });
});

describe("healthProblem", () => {
  it("should accept a healthy body reporting the expected version", () => {
    expect(healthProblem({ status: "ok", version: "1.2.3" }, "1.2.3")).toBeNull();
  });

  // The previous deploy answers 200 with a healthy body too — only the version
  // distinguishes "the new code is live" from "something is live".
  it("should reject the previous version still being served", () => {
    const problem = healthProblem({ status: "ok", version: "1.2.2" }, "1.2.3");
    expect(problem).toContain("1.2.2");
    expect(problem).toContain("1.2.3");
  });

  it("should reject a body reporting a non-ok status", () => {
    expect(healthProblem({ status: "degraded", version: "1.2.3" }, "1.2.3")).toContain("degraded");
  });

  it("should reject a body with no status at all", () => {
    expect(healthProblem({ version: "1.2.3" }, "1.2.3")).toContain("expected");
  });

  it("should reject a body missing the version", () => {
    expect(healthProblem({ status: "ok" }, "1.2.3")).toContain("expected");
  });

  it("should reject a non-object body without throwing", () => {
    expect(healthProblem(null, "1.2.3")).toContain("expected");
  });

  it("should reject a string body without throwing", () => {
    expect(healthProblem("ok", "1.2.3")).toContain("expected");
  });
});
