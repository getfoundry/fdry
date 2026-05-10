import { describe, it, expect } from 'vitest';
import { checkKillSwitch } from './killSwitch.js';

const noFile = async (_p: string) => false;

describe('checkKillSwitch', () => {
  it('returns halted:false when neither env nor sentinel trips', async () => {
    const r = await checkKillSwitch({
      envSnapshot: {},
      fileExists: noFile,
    });
    expect(r.halted).toBe(false);
  });

  it('halts on env var set to "1" with source env', async () => {
    const r = await checkKillSwitch({
      envSnapshot: { FDRY_FOLLOWER_HALT: '1' },
      fileExists: noFile,
    });
    expect(r.halted).toBe(true);
    if (r.halted) {
      expect(r.source).toBe('env');
      expect(r.detail).toContain('FDRY_FOLLOWER_HALT');
    }
  });

  it('does NOT halt when env var is empty string', async () => {
    const r = await checkKillSwitch({
      envSnapshot: { FDRY_FOLLOWER_HALT: '' },
      fileExists: noFile,
    });
    expect(r.halted).toBe(false);
  });

  it('halts when env var is "0" (halt-by-existence semantics)', async () => {
    const r = await checkKillSwitch({
      envSnapshot: { FDRY_FOLLOWER_HALT: '0' },
      fileExists: noFile,
    });
    expect(r.halted).toBe(true);
    if (r.halted) expect(r.source).toBe('env');
  });

  it('halts when sentinel file exists with source sentinel_file', async () => {
    const r = await checkKillSwitch({
      envSnapshot: {},
      sentinelFilePath: '/tmp/custom-halt.flag',
      fileExists: async () => true,
    });
    expect(r.halted).toBe(true);
    if (r.halted) {
      expect(r.source).toBe('sentinel_file');
      expect(r.detail).toContain('/tmp/custom-halt.flag');
    }
  });

  it('env takes precedence over sentinel when both trip', async () => {
    const r = await checkKillSwitch({
      envSnapshot: { FDRY_FOLLOWER_HALT: 'stop' },
      fileExists: async () => true,
    });
    expect(r.halted).toBe(true);
    if (r.halted) expect(r.source).toBe('env');
  });

  it('halts with unhealthy_state when fileExists throws unexpected error', async () => {
    const r = await checkKillSwitch({
      envSnapshot: {},
      fileExists: async () => {
        const err = new Error('permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    });
    expect(r.halted).toBe(true);
    if (r.halted) {
      expect(r.source).toBe('unhealthy_state');
      expect(r.detail).toContain('EACCES');
    }
  });

  it('does NOT halt when fileExists returns false (ENOENT semantic)', async () => {
    const r = await checkKillSwitch({
      envSnapshot: {},
      fileExists: async () => false,
    });
    expect(r.halted).toBe(false);
  });

  it('respects custom envVarName', async () => {
    const r = await checkKillSwitch({
      envVarName: 'MY_HALT',
      envSnapshot: { MY_HALT: 'yes', FDRY_FOLLOWER_HALT: '' },
      fileExists: noFile,
    });
    expect(r.halted).toBe(true);
    if (r.halted) {
      expect(r.source).toBe('env');
      expect(r.detail).toContain('MY_HALT');
    }
  });
});
