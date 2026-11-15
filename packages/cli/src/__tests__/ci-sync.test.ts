import { describe, it, expect } from "vitest";
import {
  gateCiDrift,
  gateCommands,
  playwrightImageProblems,
  playwrightImageVersions,
  pnpmCommandsRun,
} from "../lib/ci-sync";

describe("pnpmCommandsRun", () => {
  it("should read the commands a workflow runs, each once, in order", () => {
    const workflow = [
      "jobs:",
      "  quality:",
      "    steps:",
      "      - run: pnpm install --frozen-lockfile",
      "      - run: pnpm lint",
      "      - run: |",
      "          pnpm api:spec --check",
      "          pnpm run lint",
      "      - run: pnpm build && pnpm check:boot",
      "      - run: pnpm lint",
    ].join("\n");

    expect(pnpmCommandsRun(workflow)).toEqual([
      "install",
      "lint",
      "api:spec",
      "build",
      "check:boot",
    ]);
  });

  it.each([
    ["a comment naming a command", "      # then run pnpm db:seed by hand"],
    ["a name: line", "        name: pnpm db:seed must pass"],
    ["a - name: line", "      - name: pnpm db:seed must pass"],
    ["the pnpm setup action", "      - uses: pnpm/action-setup@v4"],
    ["the pnpm cache setting", "          cache: pnpm"],
    ["a path ending in pnpm", "      - run: ./bin/pnpm lint"],
  ])("should read nothing from %s", (_case, line) => {
    expect(pnpmCommandsRun(line)).toEqual([]);
  });

  // A flag before the command name cannot be classified without knowing which
  // flags take a value, so the whole invocation is returned: it matches no gate
  // command and is reported, instead of being counted as nothing.
  it.each([
    ["a flag before the command", "      - run: pnpm -s db:seed", "-s db:seed"],
    [
      "a filtered run",
      "      - run: pnpm --filter @starter/web run db:seed",
      "--filter @starter/web run db:seed",
    ],
    ["a filtered exec", "      - run: pnpm --filter x exec y && pnpm lint", "--filter x exec y"],
    ["a command held in a variable", '        run: pnpm "$COMMAND"', '"$COMMAND"'],
  ])("should return %s whole, as an invocation it cannot classify", (_case, line, invocation) => {
    expect(pnpmCommandsRun(line)).toContain(invocation);
  });

  it("should still read an unfiltered exec as the exec command", () => {
    expect(pnpmCommandsRun("      - run: pnpm exec playwright install")).toEqual(["exec"]);
  });
});

describe("gateCommands", () => {
  const scripts = {
    lint: "eslint .",
    test: "vitest run",
    "test:e2e": "playwright test",
    "verify:fast":
      "pnpm install --frozen-lockfile && pnpm lint && gitleaks git --redact && pnpm test",
    verify: "pnpm verify:fast && pnpm test:e2e",
  };

  it("should expand aggregates down to leaves, keeping a built-in and skipping non-pnpm steps", () => {
    expect(gateCommands(scripts, "verify")).toEqual(["install", "lint", "test", "test:e2e"]);
  });

  it("should split on ||, ; and pnpm run as well", () => {
    expect(
      gateCommands({ a: "x", b: "y", c: "z", all: "pnpm a || pnpm run b; pnpm c" }, "all"),
    ).toEqual(["a", "b", "c"]);
  });

  it("should not read pnpm test as test:e2e, or the reverse", () => {
    expect(gateCommands({ ...scripts, gate: "pnpm test && pnpm lint" }, "gate")).toEqual([
      "test",
      "lint",
    ]);
    expect(gateCommands({ ...scripts, gate: "pnpm test:e2e && pnpm lint" }, "gate")).toEqual([
      "test:e2e",
      "lint",
    ]);
  });

  it("should keep a script that names no root script as a leaf under its own name", () => {
    expect(gateCommands({ lint: "pnpm exec eslint .", gate: "pnpm lint" }, "gate")).toEqual([
      "lint",
    ]);
  });

  it("should report a command once however many aggregates reach it", () => {
    expect(
      gateCommands(
        { lint: "eslint .", a: "pnpm lint", b: "pnpm lint", all: "pnpm a && pnpm b" },
        "all",
      ),
    ).toEqual(["lint"]);
  });

  it("should terminate on a self-referencing script and yield nothing", () => {
    expect(gateCommands({ loop: "pnpm loop" }, "loop")).toEqual([]);
  });

  it("should terminate on a two-script cycle and keep the leaves beside it", () => {
    expect(gateCommands({ a: "pnpm b && pnpm lint", b: "pnpm a", lint: "eslint ." }, "a")).toEqual([
      "lint",
    ]);
  });

  /** A deleted gate must not compare as an empty, trivially matching set. */
  it("should yield the entry itself when it is not a script", () => {
    expect(gateCommands({ lint: "eslint ." }, "verify")).toEqual(["verify"]);
  });

  it("should not mistake an inherited object key for a script", () => {
    expect(
      gateCommands({ gate: "pnpm constructor && pnpm lint", lint: "eslint ." }, "gate"),
    ).toEqual(["constructor", "lint"]);
  });
});

describe("gateCiDrift", () => {
  const none = new Set<string>();

  it("should report a command only CI runs", () => {
    expect(gateCiDrift(["lint"], ["lint", "db:seed"], none)).toEqual({
      ciOnly: ["db:seed"],
      gateOnly: [],
    });
  });

  it("should not report a CI-only command that is allowed", () => {
    expect(gateCiDrift(["lint"], ["lint", "db:migrate"], new Set(["db:migrate"]))).toEqual({
      ciOnly: [],
      gateOnly: [],
    });
  });

  it("should report a command only the gate runs", () => {
    expect(gateCiDrift(["lint", "check:boot"], ["lint"], none)).toEqual({
      ciOnly: [],
      gateOnly: ["check:boot"],
    });
  });

  /** The allow set excuses CI, never the gate. */
  it("should still report a gate-only command that is in the allow set", () => {
    expect(gateCiDrift(["db:migrate"], [], new Set(["db:migrate"])).gateOnly).toEqual([
      "db:migrate",
    ]);
  });

  it("should report nothing for equal sets in a different order", () => {
    expect(gateCiDrift(["lint", "test"], ["test", "lint"], none)).toEqual({
      ciOnly: [],
      gateOnly: [],
    });
  });
});

const E2E = "    container:\n      image: mcr.microsoft.com/playwright:v1.58.2-noble\n";

describe("playwrightImageVersions", () => {
  it("should read the version out of a tag", () => {
    expect(playwrightImageVersions([E2E])).toEqual(["1.58.2"]);
  });

  it("should report one tag used in two sources once", () => {
    expect(playwrightImageVersions([E2E, E2E])).toEqual(["1.58.2"]);
  });

  it("should read every tag in one source", () => {
    expect(playwrightImageVersions([E2E + E2E.replace("1.58.2", "1.59.0")])).toEqual([
      "1.58.2",
      "1.59.0",
    ]);
  });
});

describe("playwrightImageProblems", () => {
  it("should report nothing when every tag is the pinned version", () => {
    expect(playwrightImageProblems("1.58.2", [E2E, E2E])).toEqual([]);
  });

  it("should name both versions when a tag differs", () => {
    expect(playwrightImageProblems("1.0.0", [E2E])).toEqual([
      "package.json pins @playwright/test 1.0.0 but a workflow runs the v1.58.2 image",
    ]);
  });

  it("should report only the tag that differs", () => {
    expect(playwrightImageProblems("1.58.2", [E2E, E2E.replace("1.58.2", "1.59.0")])).toEqual([
      "package.json pins @playwright/test 1.58.2 but a workflow runs the v1.59.0 image",
    ]);
  });

  it("should report an image whose tag cannot be read", () => {
    const problems = playwrightImageProblems("1.58.2", [
      "      image: mcr.microsoft.com/playwright:latest\n",
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("could not be read");
  });

  it("should report an unreadable tag beside a readable one", () => {
    const problems = playwrightImageProblems("1.58.2", [
      E2E,
      "      image: mcr.microsoft.com/playwright:latest\n",
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("could not be read");
  });

  it("should report nothing when no workflow names the image", () => {
    expect(playwrightImageProblems("1.58.2", ["      - run: pnpm test:e2e\n"])).toEqual([]);
    expect(playwrightImageProblems(undefined, ["      - run: pnpm test:e2e\n", ""])).toEqual([]);
    expect(playwrightImageProblems(undefined, [])).toEqual([]);
  });

  it("should report an image when package.json pins nothing", () => {
    expect(playwrightImageProblems(undefined, [E2E])).toEqual([
      "package.json does not pin @playwright/test but a workflow runs the v1.58.2 image",
    ]);
  });
});
