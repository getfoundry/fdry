import { stat } from 'node:fs/promises';

/**
 * Operator's emergency stop for the follower loop.
 *
 * Two independent halt vectors:
 *   1. env var (default FDRY_FOLLOWER_HALT) — checked first; cheapest.
 *      HALT-BY-EXISTENCE: any non-empty value trips the switch, including
 *      the strings '0' and 'false'. We do NOT parse truthiness — operators
 *      should not have to remember that '0' is "off". If you want it off,
 *      unset the variable.
 *   2. sentinel file (default /tmp/fdry-follower.halt) — file existence halts.
 *      Unknown fs errors (anything other than ENOENT) are treated as halts
 *      with source 'unhealthy_state' — when in doubt, stop trading.
 */

export type KillSwitchSource = 'env' | 'sentinel_file' | 'unhealthy_state';

export type KillSwitchReading =
  | { halted: false }
  | { halted: true; source: KillSwitchSource; detail: string };

export type KillSwitchOptions = {
  envVarName?: string;
  sentinelFilePath?: string;
  envSnapshot?: NodeJS.ProcessEnv;
  fileExists?: (p: string) => Promise<boolean>;
};

const DEFAULT_ENV_VAR = 'FDRY_FOLLOWER_HALT';
const DEFAULT_SENTINEL_PATH = '/tmp/fdry-follower.halt';

async function defaultFileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return false;
    // Surface unknown errors to caller — they should be treated as halts.
    throw err;
  }
}

export async function checkKillSwitch(
  opts: KillSwitchOptions = {},
): Promise<KillSwitchReading> {
  const envVarName = opts.envVarName ?? DEFAULT_ENV_VAR;
  const sentinelFilePath = opts.sentinelFilePath ?? DEFAULT_SENTINEL_PATH;
  const env = opts.envSnapshot ?? process.env;
  const fileExists = opts.fileExists ?? defaultFileExists;

  // 1. env check first (cheapest, no syscall).
  const envValue = env[envVarName];
  if (envValue !== undefined && envValue !== '') {
    return {
      halted: true,
      source: 'env',
      detail: `env var ${envVarName} is set (halt-by-existence)`,
    };
  }

  // 2. sentinel file check.
  try {
    const exists = await fileExists(sentinelFilePath);
    if (exists) {
      return {
        halted: true,
        source: 'sentinel_file',
        detail: `sentinel file present at ${sentinelFilePath}`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? 'UNKNOWN';
    const message = (err as Error)?.message ?? String(err);
    return {
      halted: true,
      source: 'unhealthy_state',
      detail: `sentinel check failed (${code}): ${message}`,
    };
  }

  return { halted: false };
}
