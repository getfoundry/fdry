/**
 * shared/src/universe.ts
 *
 * Single source-of-truth loader for the fdry token universe.
 *
 * Canonical firmament: docs/oracles.json — its `_meta.universe` array defines
 * the ordered symbol list; per-symbol entries carry pyth_id + optional
 * solana_mint. Every bot/, scripts/, frontend/ module MUST load via this
 * helper instead of hardcoding a token list.
 *
 * Usage:
 *   import { UNIVERSE_ORDER, TOKEN_MINTS, loadUniverse } from "@fdry/shared/universe";
 *   const { order, mints, oracles } = loadUniverse();
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

export interface OracleEntry {
  pyth_id: string;
  source: string;
  symbol: string;
  description: string;
  solana_mint?: string;
  primary_pool?: Record<string, unknown>;
  jupiter_route?: Record<string, unknown>;
}

export interface Universe {
  order: string[];
  mints: Record<string, string>;
  oracles: Record<string, OracleEntry>;
}

// Canonical SPL mints for symbols NOT carrying solana_mint in oracles.json.
// Kept here (not duplicated in every script) — override by adding solana_mint
// to the oracle entry.
const FALLBACK_MINTS: Record<string, string> = {
  SOL:    "So11111111111111111111111111111111111111112",
  WIF:    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  BONK:   "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  DOGE:   "Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw",
  FLOKI:  "9tzZzEHsKnwFL1A3DyFJwj36KnZj3gZ7g4srWp9YTEoh",
  JTO:    "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  FARTCOIN: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
};

const DEFAULT_ORACLES_PATH = path.resolve(
  __dirname, "..", "..", "docs", "oracles.json",
);

export function loadUniverse(oraclesPath: string = DEFAULT_ORACLES_PATH): Universe {
  const raw = readFileSync(oraclesPath, "utf8");
  const j = JSON.parse(raw) as Record<string, unknown> & {
    _meta?: { universe?: string[] };
  };
  const order = j._meta?.universe;
  if (!Array.isArray(order) || order.length === 0) {
    throw new Error(`oracles.json missing _meta.universe array at ${oraclesPath}`);
  }
  const oracles: Record<string, OracleEntry> = {};
  const mints: Record<string, string> = {};
  for (const sym of order) {
    const entry = j[sym] as OracleEntry | undefined;
    if (!entry || typeof entry.pyth_id !== "string") {
      throw new Error(`oracles.json missing entry for ${sym}`);
    }
    oracles[sym] = entry;
    const mint = entry.solana_mint ?? FALLBACK_MINTS[sym];
    if (!mint) throw new Error(`no mint for ${sym} — add solana_mint to oracles.json or FALLBACK_MINTS`);
    mints[sym] = mint;
  }
  return { order, mints, oracles };
}

// Eager exports — stable at import time. If oracles.json changes, reload.
const _u = loadUniverse();
export const UNIVERSE_ORDER: readonly string[] = _u.order;
export const TOKEN_MINTS: Readonly<Record<string, string>> = _u.mints;
export const ORACLES: Readonly<Record<string, OracleEntry>> = _u.oracles;
