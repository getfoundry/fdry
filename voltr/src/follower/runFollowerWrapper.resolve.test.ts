import { describe, it, expect } from "vitest";
import {
  statSync,
  existsSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WRAPPER =
  "~/Projects/fdry/voltr/scripts/run-follower";
const OPERATOR_ENV = `${process.env.HOME}/.fdry/env`;

type ExecResult = {
  status: number;
  stdout: string;
  stderr: string;
};

function runWrapper(args: string[], env: NodeJS.ProcessEnv): ExecResult {
  const result = spawnSync(WRAPPER, args, {
    env: env as Record<string, string>,
    encoding: "utf8",
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function operatorEnvHasJupKey(): boolean {
  if (!existsSync(OPERATOR_ENV)) return false;
  const contents = readFileSync(OPERATOR_ENV, "utf8");
  return /^JUP_PREDICTION_API_KEY=.+/m.test(contents);
}

// Make a pnpm-shaped shim. The wrapper runs `--version` against $PNPM before
// exec (Day-5 sheep #2 fix); fixtures must answer with a semver line or the
// wrapper rejects them with exit 126. `extra` is appended to handle the real
// invocation (test-specific behavior like emitting probe output).
function makePnpmShim(path: string, extra: string = ""): void {
  const body = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "10.5.2"
  exit 0
fi
${extra}
exit 0
`;
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function shimDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("run-follower wrapper — pnpm resolution chain", () => {
  it("wrapper file exists and is executable", () => {
    expect(existsSync(WRAPPER)).toBe(true);
    const mode = statSync(WRAPPER).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it("FDRY_PNPM honored when executable (step a wins)", () => {
    const dir = shimDir("fdry-step-a-");
    const shim = join(dir, "pnpm");
    makePnpmShim(shim);
    const result = runWrapper(["follower:dry"], {
      HOME: process.env.HOME,
      PATH: "/usr/bin:/bin",
      FDRY_PNPM: shim,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`[run-follower] pnpm=${shim}`);
  });

  it("falls back to PATH lookup when FDRY_PNPM unset", () => {
    const dir = shimDir("fdry-pnpm-shim-");
    const shim = join(dir, "pnpm");
    makePnpmShim(shim, 'echo "[shim] invoked" >&2');

    const result = runWrapper(["follower:dry"], {
      HOME: dir,
      PATH: `${dir}:/usr/bin:/bin`,
    });

    expect(result.status).toBe(0);
    const pnpmLine = result.stderr
      .split("\n")
      .find((l) => l.startsWith("[run-follower] pnpm="));
    expect(
      pnpmLine,
      `expected pnpm= line in stderr: ${result.stderr}`,
    ).toBeDefined();
    expect(pnpmLine).toContain(shim);
  });

  it("fails loud with FDRY_PNPM hint when no pnpm anywhere", () => {
    const dir = shimDir("fdry-no-pnpm-");
    const result = runWrapper(["follower:dry"], {
      HOME: dir,
      PATH: "/usr/bin:/bin",
      FDRY_PNPM: "/no/such/binary",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("FDRY_PNPM");
  });

  // Day-5 lost sheep #2: a corrupt FDRY_PNPM=/bin/echo silently exits 0
  // because /bin/echo prints whatever you pass it ("--version" -> "--version")
  // and the wrapper used to assume any 0-exit binary was pnpm. Result: launchd
  // shows "ran successfully" while no follower work happens. The wrapper now
  // requires --version to print a semver-shaped line.
  it("rejects corrupt FDRY_PNPM that does not return a pnpm-shaped --version", () => {
    const result = runWrapper(["follower:dry"], {
      HOME: process.env.HOME,
      PATH: "/usr/bin:/bin",
      FDRY_PNPM: "/bin/echo",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not return a pnpm-shaped --version");
  });

  it("rejects unknown positional arg (does not silently no-op)", () => {
    const dir = shimDir("fdry-bogus-");
    const shim = join(dir, "pnpm");
    makePnpmShim(shim);
    const result = runWrapper(["follower:bogus"], {
      HOME: process.env.HOME,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      FDRY_PNPM: shim,
    });
    expect(result.status).not.toBe(0);
  });

  it("sources ~/.fdry/env into the child environment", () => {
    if (!operatorEnvHasJupKey()) {
      console.warn(
        "[skip] ~/.fdry/env missing JUP_PREDICTION_API_KEY; sourcing test cannot assert",
      );
      return;
    }
    const dir = shimDir("fdry-probe-");
    const probe = join(dir, "probe-pnpm");
    makePnpmShim(
      probe,
      `if [ -n "\${JUP_PREDICTION_API_KEY:-}" ]; then echo "[probe] HAS_KEY=1" >&2; else echo "[probe] HAS_KEY=0" >&2; fi`,
    );

    const result = runWrapper(["follower:dry"], {
      HOME: process.env.HOME,
      PATH: "/usr/bin:/bin",
      FDRY_PNPM: probe,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[probe] HAS_KEY=1");
  });

  // Lost-sheep #6 (caught manually during Day-3 smoke verification):
  // launchd subprocesses get a near-empty PATH. pnpm resolves fine, but pnpm
  // then invokes tsx, whose `#!/usr/bin/env node` shebang fails with
  // "env: node: No such file or directory" because node isn't on PATH.
  // The wrapper's fix: prepend pnpm's dir + the standard install dirs to PATH
  // before exec. This test pins that contract — strip it and the launchd
  // launch silently dies on Friday morning.
  it("exports PATH including pnpm's dir so child tsx/node shebangs resolve", () => {
    const dir = shimDir("wrapper-path-");
    const probe = join(dir, "pnpm");
    makePnpmShim(probe, "echo [path-probe] PATH=$PATH >&2");

    const result = runWrapper(["follower:dry"], {
      HOME: process.env.HOME,
      PATH: "/usr/bin:/bin", // launchd-style minimal PATH
      FDRY_PNPM: probe,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[path-probe] PATH=");
    expect(result.stderr).toContain(dir);
  });
});
