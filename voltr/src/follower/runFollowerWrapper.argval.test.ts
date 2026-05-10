import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WRAPPER = "~/Projects/fdry/voltr/scripts/run-follower";

// Isolate HOME so the wrapper's `source ~/.fdry/env` (which may set FDRY_PNPM
// to a real pnpm and actually run a follower script) cannot bleed into our
// tests. We set HOME to a fresh tempdir with no .fdry/env file.
const ISOLATED_HOME = mkdtempSync(join(tmpdir(), "fdry-argval-"));

type ExecResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
};

function runWrapper(args: string[], extraEnv: Record<string, string> = {}): ExecResult {
  // Use spawnSync (not execFileSync) so we can read stderr regardless of exit code.
  const r = spawnSync(WRAPPER, args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: ISOLATED_HOME, ...extraEnv },
    timeout: 5000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    signal: r.signal,
  };
}

function makePnpmShimFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "fdry-argval-shim-"));
  const shim = join(dir, "pnpm");
  writeFileSync(
    shim,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "10.5.2"; exit 0; fi\nexit 0\n`,
  );
  chmodSync(shim, 0o755);
  return shim;
}

describe("run-follower wrapper — positional arg validation", () => {
  it("no-arg invocation exits non-zero with usage line", () => {
    const r = runWrapper([]);
    expect(r.signal).toBeNull();
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBeNull();
    expect(r.stderr).toMatch(/usage:/i);
  });

  it("empty-string arg exits non-zero (does not silently invoke pnpm with empty script)", () => {
    const r = runWrapper([""]);
    expect(r.status).not.toBe(0);
    // Must reject before resolving pnpm: no pnpm= line should appear.
    expect(r.stderr).not.toMatch(/\[run-follower\] pnpm=/);
    expect(r.stderr).toMatch(/usage:/i);
  });

  it("two-arg invocation rejected (wrapper accepts exactly one positional)", () => {
    const r = runWrapper(["follower:dry", "follower:resolve"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage:/i);
  });

  it("allowed arg follower:dry passes argval and invokes resolved pnpm", () => {
    // pnpm-shaped shim: handles `--version` (sheep #2 sanity check) then
    // exits 0. Proves: (a) argval accepted the script name, (b) resolution
    // chain found our override, (c) exec succeeded.
    const shim = makePnpmShimFile();
    const r = runWrapper(["follower:dry"], { FDRY_PNPM: shim });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain(`[run-follower] pnpm=${shim}`);
  });

  it("--help flag is rejected as unknown script (does not hang or loop)", () => {
    // Wrapper's case-statement only allows the three known scripts; anything
    // else (including --help) hits the `usage` branch. Important property:
    // exits promptly, does not hang. spawnSync timeout=5000ms guards hang.
    const r = runWrapper(["--help"]);
    expect(r.signal).toBeNull(); // not killed by timeout
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage:/i);
  });
});
