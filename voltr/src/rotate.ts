/**
 * voltr/src/rotate.ts — Target allocation → deposit/withdraw plan.
 *
 * Pure logic. Given:
 *   - current USDC value per strategy (from vault state)
 *   - desired weights_bp per token (long-only, sums to 10_000)
 *   - total vault NAV
 *
 * Compute a minimal plan of:
 *   - withdrawals from over-allocated strategies → vault idle
 *   - deposits from vault idle → under-allocated strategies
 *
 * Withdrawals are ordered first so idle USDC exists before deposits run.
 * A no-trade band filters out micro-rebalances whose |delta| is below
 * NO_TRADE_BAND_USDC (default $1, scales with NAV for sizing).
 */

import type { StrategyRecord } from "./vault.js";

/** Below this delta (USDC), don't bother — below Jupiter's min-amount + fees. */
export const NO_TRADE_BAND_USDC_MIN = 1.0;

export interface Step {
  kind: "deposit" | "withdraw";
  token: string;
  strategy: StrategyRecord;
  amountUsdc: number;
}

export interface RotationPlan {
  withdraws: Step[];
  deposits: Step[];
  /** Net USDC pulled from/pushed to idle during the plan (for logging only). */
  idleDeltaUsdc: number;
  /** Computed max per-asset delta in USDC for logging. */
  maxStepUsdc: number;
}

/**
 * Build a rotation plan.
 *
 * @param currentAllocationsUsdc current per-strategy USDC value (keyed by token)
 * @param idleUsdc available idle USDC (will constrain deposits if too small)
 * @param weightsBp desired basis-point weights per token (sums to 10000)
 * @param totalValueUsdc total vault NAV in USDC
 * @param strategies strategy registry records by token
 * @param noTradeBandUsdc minimum delta to actually place a trade
 */
export function planRotation(
  currentAllocationsUsdc: Record<string, number>,
  idleUsdc: number,
  weightsBp: Record<string, number>,
  totalValueUsdc: number,
  strategies: StrategyRecord[],
  noTradeBandUsdc: number = NO_TRADE_BAND_USDC_MIN,
): RotationPlan {
  const withdraws: Step[] = [];
  const deposits: Step[] = [];
  let maxStepUsdc = 0;

  const byToken = new Map<string, StrategyRecord>();
  for (const s of strategies) byToken.set(s.token, s);

  // Compute per-strategy target USDC and deltas.
  const deltas: Array<{ token: string; delta: number; strategy: StrategyRecord }> = [];
  for (const [token, bp] of Object.entries(weightsBp)) {
    const strategy = byToken.get(token);
    if (!strategy) continue; // token not in registry (e.g. universe mismatch)
    const target = (bp / 10_000) * totalValueUsdc;
    const current = currentAllocationsUsdc[token] ?? 0;
    const delta = target - current;
    if (Math.abs(delta) < noTradeBandUsdc) continue;
    deltas.push({ token, delta, strategy });
  }

  // Withdraws first (delta < 0 means target < current → pull back to idle).
  for (const { token, delta, strategy } of deltas) {
    if (delta < 0) {
      const amount = -delta;
      withdraws.push({ kind: "withdraw", token, strategy, amountUsdc: amount });
      if (amount > maxStepUsdc) maxStepUsdc = amount;
    }
  }

  // Then deposits (delta > 0 means target > current → push from idle into strategy).
  for (const { token, delta, strategy } of deltas) {
    if (delta > 0) {
      const amount = delta;
      deposits.push({ kind: "deposit", token, strategy, amountUsdc: amount });
      if (amount > maxStepUsdc) maxStepUsdc = amount;
    }
  }

  // Sanity check: after withdraws, idle will be idleUsdc + sum(withdraws).
  // Deposits total must fit within that.
  const willHaveIdle = idleUsdc + withdraws.reduce((a, s) => a + s.amountUsdc, 0);
  const depositTotal = deposits.reduce((a, s) => a + s.amountUsdc, 0);

  // If deposits exceed what will be available (shouldn't happen given the
  // plan is derived from the same totalValue, but handles rounding/slippage),
  // scale all deposits down proportionally.
  if (depositTotal > willHaveIdle && depositTotal > 0) {
    const factor = willHaveIdle / depositTotal;
    for (const d of deposits) d.amountUsdc *= factor;
  }

  const idleDeltaUsdc =
    withdraws.reduce((a, s) => a + s.amountUsdc, 0) -
    deposits.reduce((a, s) => a + s.amountUsdc, 0);

  return { withdraws, deposits, idleDeltaUsdc, maxStepUsdc };
}

/**
 * Render a one-line summary of a plan for logging/alerts.
 * Example: "rotate: withdraw SOL-$3.21, JTO-$0.82 | deposit CASH+$2.40, WIF+$1.63"
 */
export function summarizePlan(plan: RotationPlan): string {
  const fmt = (s: Step) =>
    `${s.token}${s.kind === "deposit" ? "+" : "-"}$${s.amountUsdc.toFixed(2)}`;
  const w = plan.withdraws.map(fmt).join(", ") || "-";
  const d = plan.deposits.map(fmt).join(", ") || "-";
  return `withdraw ${w} | deposit ${d}`;
}
