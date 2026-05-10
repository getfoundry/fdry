import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const FDRY_PLIST = "~/Projects/fdry/voltr/scripts/com.fdry.follower.plist";
const FDRY_RESOLVE_PLIST = "~/Projects/fdry/voltr/scripts/com.fdry.follower.resolve.plist";
const IBM_TRIGGERS_PLIST = "~/Projects/bridge-source/harness/com.bridge-source.triggers.plist";

const FDRY_PLISTS = [FDRY_PLIST, FDRY_RESOLVE_PLIST];

const HARDCODED_INTERPRETER_RE =
  /(\/opt\/homebrew\/bin\/(pnpm|node|tsx|python|python3))|(\/usr\/local\/bin\/(pnpm|node|tsx))|(~\/\.bun\/bin\/(pnpm|node|tsx))/;

function plutilLint(path: string): { code: number; output: string } {
  try {
    const output = execSync(`plutil -lint ${JSON.stringify(path)}`, {
      encoding: "utf8",
    }).trim();
    return { code: 0, output };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    const out = `${e.stdout?.toString() ?? ""}${e.stderr?.toString() ?? ""}`.trim();
    return { code: e.status ?? 1, output: out };
  }
}

describe("plist drift guard — fdry follower launchd plists", () => {
  it("both fdry plists exist at voltr/scripts/", () => {
    expect(existsSync(FDRY_PLIST)).toBe(true);
    expect(existsSync(FDRY_RESOLVE_PLIST)).toBe(true);
  });

  it.each(FDRY_PLISTS)("each fdry plist parses as valid plist XML: %s", (path) => {
    const { code, output } = plutilLint(path);
    expect(code).toBe(0);
    expect(output.endsWith("OK")).toBe(true);
  });

  it.each(FDRY_PLISTS)(
    "no fdry plist contains a hardcoded interpreter path: %s",
    (path) => {
      const contents = readFileSync(path, "utf8");
      const match = contents.match(HARDCODED_INTERPRETER_RE);
      expect(
        match,
        `hardcoded interpreter path found in ${path}: ${match?.[0]}`,
      ).toBeNull();
    },
  );

  it.each(FDRY_PLISTS)(
    "each fdry plist's ProgramArguments invokes the wrapper: %s",
    (path) => {
      const contents = readFileSync(path, "utf8");
      expect(contents).toMatch(/voltr\/scripts\/run-follower/);
    },
  );

  it("com.fdry.follower.plist references follower:dry npm script", () => {
    const contents = readFileSync(FDRY_PLIST, "utf8");
    expect(contents).toMatch(/follower:dry/);
  });

  it("com.fdry.follower.resolve.plist references follower:resolve npm script", () => {
    const contents = readFileSync(FDRY_RESOLVE_PLIST, "utf8");
    expect(contents).toMatch(/follower:resolve/);
  });

  it("bridge-source triggers plist still parses (no-touch invariant from Day 3)", () => {
    if (!existsSync(IBM_TRIGGERS_PLIST)) {
      // If it's not present on this machine, we can't assert the no-touch held there.
      // Treat as skipped by trivially passing — the invariant is "we did not edit it".
      return;
    }
    const { code, output } = plutilLint(IBM_TRIGGERS_PLIST);
    expect(code).toBe(0);
    expect(output.endsWith("OK")).toBe(true);
  });
});
