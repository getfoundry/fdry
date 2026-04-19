/**
 * ledger/snapshot.ts
 *
 * Produces a daily JSON NAV snapshot for the Foundry (stFDRY) vault.
 *
 * Flow:
 *   1. Fetch vault state + prices via Symmetry SDK
 *   2. Fetch SOL/USD from Pyth
 *   3. Compute NAV (SOL + USD)
 *   4. Enumerate holdings with per-token weight, balance, price, value
 *   5. Read recent tx log
 *   6. Count unique depositors on-chain
 *   7. Persist ledger/<YYYY-MM-DD>.json
 *   8. Overwrite ledger/latest.json
 *   9. Rebuild ledger/history.json for the NAV chart
 *
 * Run via:   tsx ledger/snapshot.ts
 * Cron:      0 0 * * *  tsx ledger/snapshot.ts >> logs/snapshot.log 2>&1
 */

import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const LEDGER_DIR = '/Users/lekt9/Projects/fdry/ledger';
const TXLOG_PATH = path.join(LEDGER_DIR, 'txlog.json');
const LATEST_PATH = path.join(LEDGER_DIR, 'latest.json');
const HISTORY_PATH = path.join(LEDGER_DIR, 'history.json');

const VAULT_PUBKEY =
  process.env.VAULT_PUBKEY ?? 'REPLACE_WITH_SYMMETRY_VAULT_PUBKEY';

const PYTH_SOL_USD_FEED =
  'https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface Holding {
  symbol: string;
  mint: string;
  balance: number;
  weightBp: number;
  priceUsd: number;
  valueUsd: number;
}

interface TxLogEntry {
  ts: string;
  sig: string;
  kind: string;
  amountSol?: number;
  actor?: string;
  [k: string]: unknown;
}

interface Snapshot {
  date: string;
  ts: string;
  nav_sol: number;
  nav_usd: number;
  shares_outstanding: number;
  nav_per_share_sol: number;
  depositors: number;
  holdings: Holding[];
  fees_collected_sol: number;
  unbrowse_revenue_inflow_sol: number;
  tx_log_recent: TxLogEntry[];
  symmetry_vault_pubkey: string;
  explorer_links: string[];
}

interface HistoryPoint {
  date: string;
  nav_usd: number;
  nav_sol: number;
  nav_per_share_sol: number;
}

// -----------------------------------------------------------------------------
// SDK glue (thin wrapper — swap with actual Symmetry SDK imports)
// -----------------------------------------------------------------------------

interface VaultToken {
  symbol: string;
  mint: string;
  balance: number;
  targetWeightBp: number;
  priceUsd?: number;
}

interface Vault {
  pubkey: string;
  totalSupply: number;
  tokens: VaultToken[];
}

interface SdkLike {
  fetchVault(pubkey: string): Promise<Vault>;
  loadVaultPrice(v: Vault): Promise<Vault & { tokens: Required<VaultToken>[] }>;
}

async function loadSdk(): Promise<SdkLike> {
  // Lazy-load the real SDK. If it's not installed yet we fall back to a stub
  // so the snapshot script doesn't crash during bring-up / cron testing.
  try {
    // @ts-ignore — optional dep; present once bot is installed
    const mod = await import('@symmetry-hq/baskets-sdk');
    const sdk = new mod.BasketsSDK({ cluster: 'mainnet-beta' });
    return {
      async fetchVault(pubkey: string) {
        const v = await sdk.getVault(pubkey);
        return {
          pubkey,
          totalSupply: Number(v.lpSupply ?? v.totalSupply ?? 0),
          tokens: (v.tokens ?? []).map((t: any) => ({
            symbol: t.symbol,
            mint: t.mint?.toString?.() ?? t.mint,
            balance: Number(t.amount ?? t.balance ?? 0),
            targetWeightBp: Number(t.targetWeight ?? t.weightBp ?? 0),
          })),
        };
      },
      async loadVaultPrice(v) {
        const priced = await sdk.loadPrices(v as any);
        return {
          ...v,
          tokens: (priced.tokens ?? v.tokens).map((t: any) => ({
            symbol: t.symbol,
            mint: t.mint?.toString?.() ?? t.mint,
            balance: Number(t.amount ?? t.balance ?? 0),
            targetWeightBp: Number(t.targetWeight ?? t.weightBp ?? 0),
            priceUsd: Number(t.priceUsd ?? t.price ?? 0),
          })),
        };
      },
    };
  } catch (err) {
    console.warn('[snapshot] Symmetry SDK not available, using stub:', err instanceof Error ? err.message : err);
    return {
      async fetchVault() {
        return { pubkey: VAULT_PUBKEY, totalSupply: 0, tokens: [] };
      },
      async loadVaultPrice(v) {
        return { ...v, tokens: [] };
      },
    };
  }
}

// -----------------------------------------------------------------------------
// Price + NAV helpers
// -----------------------------------------------------------------------------

async function fetchPythPrice(pair: string): Promise<number> {
  if (pair !== 'SOL/USD') throw new Error(`Unsupported Pyth pair: ${pair}`);
  try {
    const res = await fetch(PYTH_SOL_USD_FEED);
    if (!res.ok) throw new Error(`Pyth HTTP ${res.status}`);
    const body = (await res.json()) as Array<{
      price: { price: string; expo: number };
    }>;
    const feed = body[0];
    const price = Number(feed.price.price) * 10 ** feed.price.expo;
    if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid Pyth price');
    return price;
  } catch (err) {
    console.warn('[snapshot] Pyth fetch failed, defaulting SOL/USD=0:', err instanceof Error ? err.message : err);
    return 0;
  }
}

function computeNavSol(
  vaultWithPrices: Vault & { tokens: Required<VaultToken>[] },
  solPriceUsd: number,
): number {
  if (!solPriceUsd) return 0;
  const navUsd = vaultWithPrices.tokens.reduce(
    (acc, t) => acc + t.balance * t.priceUsd,
    0,
  );
  return navUsd / solPriceUsd;
}

// -----------------------------------------------------------------------------
// Tx log + depositor count
// -----------------------------------------------------------------------------

async function readTxLog(): Promise<TxLogEntry[]> {
  if (!existsSync(TXLOG_PATH)) return [];
  try {
    const raw = await readFile(TXLOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[snapshot] txlog parse failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

async function countUniqueDepositors(): Promise<number> {
  const log = await readTxLog();
  const depositors = new Set<string>();
  for (const entry of log) {
    if (entry.kind === 'deposit' && typeof entry.actor === 'string') {
      depositors.add(entry.actor);
    }
  }
  return depositors.size;
}

// -----------------------------------------------------------------------------
// History builder
// -----------------------------------------------------------------------------

const DAILY_SNAPSHOT_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

async function buildHistory(): Promise<HistoryPoint[]> {
  const files = await readdir(LEDGER_DIR);
  const dailyFiles = files.filter((f) => DAILY_SNAPSHOT_RE.test(f)).sort();

  const points: HistoryPoint[] = [];
  for (const file of dailyFiles) {
    try {
      const raw = await readFile(path.join(LEDGER_DIR, file), 'utf8');
      const snap = JSON.parse(raw) as Snapshot;
      points.push({
        date: snap.date,
        nav_usd: snap.nav_usd,
        nav_sol: snap.nav_sol,
        nav_per_share_sol: snap.nav_per_share_sol,
      });
    } catch (err) {
      console.warn(`[snapshot] skip ${file} in history:`, err instanceof Error ? err.message : err);
    }
  }

  await writeFile(HISTORY_PATH, JSON.stringify(points, null, 2));
  return points;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function snapshot(): Promise<Snapshot> {
  if (!existsSync(LEDGER_DIR)) {
    await mkdir(LEDGER_DIR, { recursive: true });
  }

  const sdk = await loadSdk();

  const vault = await sdk.fetchVault(VAULT_PUBKEY);
  const vaultWithPrices = await sdk.loadVaultPrice(vault);

  const solPriceUsd = await fetchPythPrice('SOL/USD');

  const navSol = computeNavSol(vaultWithPrices, solPriceUsd);
  const navUsd = navSol * solPriceUsd;

  const holdings: Holding[] = vaultWithPrices.tokens.map((t) => ({
    symbol: t.symbol,
    mint: t.mint,
    balance: t.balance,
    weightBp: t.targetWeightBp,
    priceUsd: t.priceUsd,
    valueUsd: t.balance * t.priceUsd,
  }));

  const txLog = await readTxLog();
  const depositors = await countUniqueDepositors();

  const date = new Date().toISOString().slice(0, 10);
  const totalSupply = vault.totalSupply || 0;
  const navPerShareSol = totalSupply > 0 ? navSol / totalSupply : 0;

  const snap: Snapshot = {
    date,
    ts: new Date().toISOString(),
    nav_sol: navSol,
    nav_usd: navUsd,
    shares_outstanding: totalSupply,
    nav_per_share_sol: navPerShareSol,
    depositors,
    holdings,
    fees_collected_sol: 0, // TODO: read from Symmetry fee collector
    unbrowse_revenue_inflow_sol: 0, // TODO when monetization ships
    tx_log_recent: txLog.slice(-20),
    symmetry_vault_pubkey: VAULT_PUBKEY,
    explorer_links: [`https://solscan.io/account/${VAULT_PUBKEY}`],
  };

  const dailyPath = path.join(LEDGER_DIR, `${date}.json`);
  const serialized = JSON.stringify(snap, null, 2);

  await writeFile(dailyPath, serialized);
  // latest.json is a real file (not a symlink) so static hosting / fetch() work.
  await writeFile(LATEST_PATH, serialized);

  // Rebuild history.json for the NAV chart.
  const history = await buildHistory();

  console.log(
    `[snapshot] ${date} nav_sol=${navSol.toFixed(4)} nav_usd=${navUsd.toFixed(
      2,
    )} nps_sol=${navPerShareSol.toFixed(6)} depositors=${depositors} history_points=${history.length}`,
  );

  return snap;
}

// -----------------------------------------------------------------------------
// Entry
// -----------------------------------------------------------------------------

// Run when invoked directly (tsx ledger/snapshot.ts)
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  process.argv[1].endsWith('snapshot.ts');

if (isDirectRun) {
  snapshot().catch((err) => {
    console.error('[snapshot] fatal:', err);
    process.exit(1);
  });
}

export {
  snapshot,
  buildHistory,
  readTxLog,
  countUniqueDepositors,
  computeNavSol,
  fetchPythPrice,
};
export type { Snapshot, Holding, HistoryPoint, TxLogEntry };
