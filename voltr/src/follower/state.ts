import { promises as fs } from 'node:fs';
import type { SignalRow } from './signal.js';

export type IntendedPosition = {
  dedupKey: string;
  row: SignalRow;
  marketId: string;
  sizeFdry: number;
  unsignedTxBase64?: string;
  recordedAtMs: number;
  status: 'pending' | 'opened' | 'closed' | 'failed';
};

export type FollowerState = {
  schemaVersion: 1;
  lastCursor: string | null;
  processedDedupKeys: string[];
  intendedPositions: IntendedPosition[];
  lastHeartbeatMs: number;
};

export const EMPTY_STATE: FollowerState = Object.freeze({
  schemaVersion: 1 as const,
  lastCursor: null,
  processedDedupKeys: [],
  intendedPositions: [],
  lastHeartbeatMs: 0,
}) as FollowerState;

const MAX_DEDUP_KEYS = 10_000;

export class StateLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'StateLoadError';
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

function clone(s: FollowerState): FollowerState {
  return {
    schemaVersion: 1,
    lastCursor: s.lastCursor,
    processedDedupKeys: [...s.processedDedupKeys],
    intendedPositions: [...s.intendedPositions],
    lastHeartbeatMs: s.lastHeartbeatMs,
  };
}

export class FollowerStore {
  private readonly path: string;

  constructor(opts: { path: string }) {
    this.path = opts.path;
  }

  async load(): Promise<FollowerState> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return clone(EMPTY_STATE);
      }
      throw new StateLoadError(`failed to read state file: ${this.path}`, { cause: err });
    }
    try {
      const parsed = JSON.parse(raw) as FollowerState;
      // minimal shape check
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.processedDedupKeys) ||
        !Array.isArray(parsed.intendedPositions)
      ) {
        throw new Error('state file shape invalid');
      }
      return parsed;
    } catch (err) {
      throw new StateLoadError(`corrupted state file: ${this.path}`, { cause: err });
    }
  }

  async save(s: FollowerState): Promise<void> {
    const tmp = `${this.path}.tmp`;
    const json = JSON.stringify(s);
    await fs.writeFile(tmp, json, 'utf8');
    await fs.rename(tmp, this.path);
  }

  alreadySeen(s: FollowerState, dedupKey: string): boolean {
    return s.processedDedupKeys.includes(dedupKey);
  }

  // NOTE: recordIntent does NOT dedupe. If called twice with the same dedupKey
  // it will append two intent entries and two key entries. Callers that need
  // dedup should consult alreadySeen() first.
  recordIntent(
    s: FollowerState,
    intent: Omit<IntendedPosition, 'recordedAtMs' | 'status'>,
  ): FollowerState {
    const next = clone(s);
    next.intendedPositions.push({
      ...intent,
      recordedAtMs: Date.now(),
      status: 'pending',
    });
    next.processedDedupKeys.push(intent.dedupKey);
    if (next.processedDedupKeys.length > MAX_DEDUP_KEYS) {
      next.processedDedupKeys = next.processedDedupKeys.slice(
        next.processedDedupKeys.length - MAX_DEDUP_KEYS,
      );
    }
    return next;
  }

  setCursor(s: FollowerState, cursor: string): FollowerState {
    const next = clone(s);
    next.lastCursor = cursor;
    return next;
  }

  beat(s: FollowerState, nowMs: number): FollowerState {
    const next = clone(s);
    next.lastHeartbeatMs = nowMs;
    return next;
  }
}
