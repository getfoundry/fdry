/**
 * positionLedger.ts — local cost-basis tracking per (vault, wallet).
 *
 * There's no indexer. We track the user's deposits and withdrawals in
 * localStorage so we can show P&L relative to what they actually put in
 * vs. what the vault owes them at current NAV.
 *
 * Shape (per key):
 *   { deposits: Array<{ ts, asset, shares }>,
 *     withdrawals: Array<{ ts, asset, shares }>,
 *     costBasisAsset: number,        // running total of asset deposited, reduced pro-rata on withdraw
 *     sharesHeld: number,            // redundant sanity tally; source of truth is on-chain
 *     firstDepositTs: number | null }
 *
 * All numbers are already human-scaled (divided by decimals).
 */

const PREFIX = "foundry:positionLedger:v1";

export type LedgerEntry = {
  ts: number;
  asset: number;
  shares: number;
};

export type PositionLedger = {
  deposits: LedgerEntry[];
  withdrawals: LedgerEntry[];
  costBasisAsset: number;
  sharesHeld: number;
  firstDepositTs: number | null;
};

const EMPTY: PositionLedger = {
  deposits: [],
  withdrawals: [],
  costBasisAsset: 0,
  sharesHeld: 0,
  firstDepositTs: null,
};

function key(vault: string, wallet: string): string {
  return `${PREFIX}:${vault}:${wallet}`;
}

export function readLedger(vault: string, wallet: string): PositionLedger {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(key(vault, wallet));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as PositionLedger;
    return {
      deposits: parsed.deposits ?? [],
      withdrawals: parsed.withdrawals ?? [],
      costBasisAsset: parsed.costBasisAsset ?? 0,
      sharesHeld: parsed.sharesHeld ?? 0,
      firstDepositTs: parsed.firstDepositTs ?? null,
    };
  } catch {
    return EMPTY;
  }
}

function write(vault: string, wallet: string, next: PositionLedger): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(vault, wallet), JSON.stringify(next));
  } catch {
    /* quota / disabled storage — silently drop; on-chain is still truth */
  }
}

export function recordDeposit(
  vault: string,
  wallet: string,
  asset: number,
  shares: number,
): PositionLedger {
  const cur = readLedger(vault, wallet);
  const ts = Date.now();
  const next: PositionLedger = {
    deposits: [...cur.deposits, { ts, asset, shares }].slice(-50),
    withdrawals: cur.withdrawals,
    costBasisAsset: cur.costBasisAsset + asset,
    sharesHeld: cur.sharesHeld + shares,
    firstDepositTs: cur.firstDepositTs ?? ts,
  };
  write(vault, wallet, next);
  return next;
}

/**
 * Reduce cost-basis pro-rata on withdraw: if the user burns 30% of their
 * shares, remove 30% of their cost-basis (rough but better than nothing).
 */
export function recordWithdraw(
  vault: string,
  wallet: string,
  asset: number,
  sharesBurned: number,
): PositionLedger {
  const cur = readLedger(vault, wallet);
  const ts = Date.now();
  const fractionBurned =
    cur.sharesHeld > 0 ? Math.min(1, sharesBurned / cur.sharesHeld) : 1;
  const next: PositionLedger = {
    deposits: cur.deposits,
    withdrawals: [...cur.withdrawals, { ts, asset, shares: sharesBurned }].slice(-50),
    costBasisAsset: Math.max(0, cur.costBasisAsset * (1 - fractionBurned)),
    sharesHeld: Math.max(0, cur.sharesHeld - sharesBurned),
    firstDepositTs: cur.sharesHeld - sharesBurned <= 0 ? null : cur.firstDepositTs,
  };
  write(vault, wallet, next);
  return next;
}

export type PortfolioView = {
  // Truth-source: on-chain share balance × live NAV (asset-denominated).
  sharesOnChain: number;
  positionValueAsset: number;
  costBasisAsset: number;
  unrealizedPnlAsset: number;
  unrealizedPnlPct: number; // 0.12 => +12%
  firstDepositTs: number | null;
  depositsCount: number;
  withdrawalsCount: number;
};

export function computePortfolio(
  ledger: PositionLedger,
  sharesOnChain: number,
  navPerShareInAsset: number,
): PortfolioView {
  const positionValueAsset = sharesOnChain * navPerShareInAsset;
  const cb = ledger.costBasisAsset;
  const pnl = positionValueAsset - cb;
  const pnlPct = cb > 0 ? pnl / cb : 0;
  return {
    sharesOnChain,
    positionValueAsset,
    costBasisAsset: cb,
    unrealizedPnlAsset: pnl,
    unrealizedPnlPct: pnlPct,
    firstDepositTs: ledger.firstDepositTs,
    depositsCount: ledger.deposits.length,
    withdrawalsCount: ledger.withdrawals.length,
  };
}
