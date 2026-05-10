import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EMPTY_STATE,
  FollowerStore,
  StateLoadError,
  type FollowerState,
  type IntendedPosition,
} from './state.js';
import type { SignalRow } from './signal.js';

const tmpPaths: string[] = [];

function tmpStatePath(): string {
  const p = path.join(os.tmpdir(), `fdry-state-${randomUUID()}.json`);
  tmpPaths.push(p);
  return p;
}

afterEach(async () => {
  while (tmpPaths.length) {
    const p = tmpPaths.pop()!;
    await fs.rm(p, { force: true });
    await fs.rm(`${p}.tmp`, { force: true });
  }
});

function makeRow(slug = 'btc-up'): SignalRow {
  return {
    v: 1,
    ts: '2026-05-09T12:00:00.000Z',
    action: 'open',
    slug,
    side: 'YES',
    token_id: 'tok-123',
    price: 0.42,
    size_usd: 100,
    size_shares: 250,
    evm_tx: '0xabc',
    paper: false,
  } as SignalRow;
}

function makeIntent(dedupKey: string): Omit<IntendedPosition, 'recordedAtMs' | 'status'> {
  return {
    dedupKey,
    row: makeRow(),
    marketId: 'mkt-1',
    sizeFdry: 10,
  };
}

describe('FollowerStore', () => {
  it('load on missing file returns EMPTY_STATE', async () => {
    const store = new FollowerStore({ path: tmpStatePath() });
    const s = await store.load();
    expect(s).toEqual(EMPTY_STATE);
  });

  it('save then load round-trips a populated state', async () => {
    const p = tmpStatePath();
    const store = new FollowerStore({ path: p });
    let s = await store.load();
    s = store.recordIntent(s, makeIntent('k1'));
    s = store.setCursor(s, 'cursor-7');
    s = store.beat(s, 1234);
    await store.save(s);
    const loaded = await store.load();
    expect(loaded.lastCursor).toBe('cursor-7');
    expect(loaded.lastHeartbeatMs).toBe(1234);
    expect(loaded.processedDedupKeys).toEqual(['k1']);
    expect(loaded.intendedPositions).toHaveLength(1);
    expect(loaded.intendedPositions[0]!.dedupKey).toBe('k1');
    expect(loaded.intendedPositions[0]!.status).toBe('pending');
  });

  it('save is atomic — tmp file does not linger', async () => {
    const p = tmpStatePath();
    const store = new FollowerStore({ path: p });
    await store.save({
      ...EMPTY_STATE,
      processedDedupKeys: [],
      intendedPositions: [],
    });
    await expect(fs.access(`${p}.tmp`)).rejects.toBeDefined();
    await expect(fs.access(p)).resolves.toBeUndefined();
  });

  it('load on corrupted JSON throws StateLoadError', async () => {
    const p = tmpStatePath();
    await fs.writeFile(p, '{not valid json', 'utf8');
    const store = new FollowerStore({ path: p });
    await expect(store.load()).rejects.toBeInstanceOf(StateLoadError);
  });

  it('load on shape-invalid JSON throws StateLoadError', async () => {
    const p = tmpStatePath();
    await fs.writeFile(p, JSON.stringify({ schemaVersion: 99 }), 'utf8');
    const store = new FollowerStore({ path: p });
    await expect(store.load()).rejects.toBeInstanceOf(StateLoadError);
  });

  it('alreadySeen returns true for known key, false otherwise', async () => {
    const store = new FollowerStore({ path: tmpStatePath() });
    let s = await store.load();
    s = store.recordIntent(s, makeIntent('seen-key'));
    expect(store.alreadySeen(s, 'seen-key')).toBe(true);
    expect(store.alreadySeen(s, 'other')).toBe(false);
  });

  it('recordIntent appends to intendedPositions AND processedDedupKeys', async () => {
    const store = new FollowerStore({ path: tmpStatePath() });
    let s = await store.load();
    s = store.recordIntent(s, makeIntent('k1'));
    s = store.recordIntent(s, makeIntent('k2'));
    expect(s.intendedPositions.map((i) => i.dedupKey)).toEqual(['k1', 'k2']);
    expect(s.processedDedupKeys).toEqual(['k1', 'k2']);
  });

  it('recordIntent twice with same dedupKey appends both (caller dedupes)', async () => {
    const store = new FollowerStore({ path: tmpStatePath() });
    let s = await store.load();
    s = store.recordIntent(s, makeIntent('dup'));
    s = store.recordIntent(s, makeIntent('dup'));
    expect(s.intendedPositions).toHaveLength(2);
    expect(s.processedDedupKeys).toEqual(['dup', 'dup']);
  });

  it('processedDedupKeys is capped at 10_000 (FIFO)', async () => {
    const store = new FollowerStore({ path: tmpStatePath() });
    let s: FollowerState = await store.load();
    for (let i = 0; i < 10_001; i++) {
      s = store.recordIntent(s, makeIntent(`k-${i}`));
    }
    expect(s.processedDedupKeys).toHaveLength(10_000);
    expect(s.processedDedupKeys[0]).toBe('k-1');
    expect(s.processedDedupKeys[9_999]).toBe('k-10000');
    // intendedPositions are NOT capped
    expect(s.intendedPositions).toHaveLength(10_001);
  });

  it('setCursor returns new state, original unchanged (immutability)', async () => {
    const store = new FollowerStore({ path: tmpStatePath() });
    const s0 = await store.load();
    const s1 = store.setCursor(s0, 'c-1');
    expect(s1.lastCursor).toBe('c-1');
    expect(s0.lastCursor).toBeNull();
    expect(s1).not.toBe(s0);
  });

  it('beat updates lastHeartbeatMs without mutating original', async () => {
    const store = new FollowerStore({ path: tmpStatePath() });
    const s0 = await store.load();
    const s1 = store.beat(s0, 999_999);
    expect(s1.lastHeartbeatMs).toBe(999_999);
    expect(s0.lastHeartbeatMs).toBe(0);
    expect(s1).not.toBe(s0);
  });

  it('save then load does not call save() inside mutators', async () => {
    // Confirm helpers don't persist on their own.
    const p = tmpStatePath();
    const store = new FollowerStore({ path: p });
    let s = await store.load();
    s = store.recordIntent(s, makeIntent('not-persisted'));
    s = store.setCursor(s, 'never-saved');
    // No save call — file should still be missing.
    await expect(fs.access(p)).rejects.toBeDefined();
  });
});
