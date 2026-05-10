/**
 * voltr/src/guards.ts — Pre-rotate sanity checks.
 *
 * All functions are pure. Callers log/handle GuardResult.reason.
 *
 * v0 guard model for the Voltr vault:
 *   - Universe = 9 (CASH + 8 tokens).
 *   - Per-asset cap = 2000 bp (20% — looser than v6b-tuned's 13.3% so
 *     minor signal drift doesn't trip the guard; the signal itself is
 *     already constrained to 13.3% by the strategy).
 *   - Cooldown = 24h.
 *   - MAX_DELTA_BP = 4000 (single-rebalance cap; catches runaway swings).
 */

export const UNIVERSE_SIZE = 9; // CASH + 8 tokens
export const TOTAL_BP = 10_000;
export const SUM_TOLERANCE_BP = 1;

/** Per-position cap (bp) — 20% NAV. v6b emits at most 13.3% so this is slack. */
export const MAX_WEIGHT_BP = 2_000;

/** Min SOL the hot wallet must hold for fee payment. */
export const MIN_HOT_SOL = 0.05;

/** Min vault NAV (USDC) — guards against empty/destroyed vault. */
export const MIN_VAULT_NAV_USDC = 10;

/** Min confidence to run a non-all-cash rotation. */
export const MIN_CONFIDENCE_FOR_ACTIVE = 0.4;

/** Max per-position bp delta between rebalances. Catches runaway swings. */
export const MAX_DELTA_BP = 4_000;

/** Cooldown between rotations (seconds). 24h. */
export const COOLDOWN_SECONDS = 86_400;

/** v0 ceiling — refuse to rotate if vault NAV is above this in USDC. */
export const V0_NAV_CEILING_USDC = Number(process.env.V0_NAV_CEILING_USDC ?? "100");

export interface GuardResult {
  ok: boolean;
  reason?: string;
  failedGuard?: string;
}

export interface GuardContext {
  hotSolBalance: number;
  vaultNavUsdc: number;
  confidence: number;
  ranker: string;
}

export interface CooldownContext {
  lastRotationTs: number | null;
  nowTs: number;
}

// ---------- pure helpers ----------

export function maxDelta(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    if (d > max) max = d;
  }
  return max;
}

export function sumWeights(w: number[]): number {
  let s = 0;
  for (const v of w) s += v;
  return s;
}

function ok(): GuardResult { return { ok: true }; }
function fail(failedGuard: string, reason: string): GuardResult {
  return { ok: false, failedGuard, reason };
}

// ---------- individual guards ----------

export function guardWeightsSum(w: number[]): GuardResult {
  const total = sumWeights(w);
  if (Math.abs(total - TOTAL_BP) > SUM_TOLERANCE_BP) {
    return fail("G1", `weights sum to ${total} bp, expected ${TOTAL_BP} ± ${SUM_TOLERANCE_BP}`);
  }
  return ok();
}

export function guardPerPositionCap(w: number[]): GuardResult {
  for (let i = 0; i < w.length; i++) {
    if ((w[i] ?? 0) > MAX_WEIGHT_BP) {
      return fail("G2", `weight[${i}]=${w[i]} bp > per-position cap ${MAX_WEIGHT_BP} bp`);
    }
  }
  return ok();
}

export function guardNonNegative(w: number[]): GuardResult {
  for (let i = 0; i < w.length; i++) {
    if ((w[i] ?? 0) < 0) return fail("G3", `weight[${i}]=${w[i]} bp is negative`);
  }
  return ok();
}

export function guardUniverseLength(newW: number[], curW: number[]): GuardResult {
  if (newW.length !== UNIVERSE_SIZE) {
    return fail("G4", `newWeights has length ${newW.length}, expected ${UNIVERSE_SIZE}`);
  }
  if (curW.length !== UNIVERSE_SIZE) {
    return fail("G4", `currentWeights has length ${curW.length}, expected ${UNIVERSE_SIZE}`);
  }
  return ok();
}

export function guardHotWalletFunded(hotSolBalance: number): GuardResult {
  if (!Number.isFinite(hotSolBalance) || hotSolBalance < MIN_HOT_SOL) {
    return fail("G5", `hot wallet has ${hotSolBalance} SOL, need ≥ ${MIN_HOT_SOL} SOL for fees`);
  }
  return ok();
}

export function guardVaultNav(vaultNavUsdc: number): GuardResult {
  if (!Number.isFinite(vaultNavUsdc) || vaultNavUsdc < MIN_VAULT_NAV_USDC) {
    return fail("G6", `vault NAV ${vaultNavUsdc} USDC < ${MIN_VAULT_NAV_USDC} USDC floor`);
  }
  if (vaultNavUsdc > V0_NAV_CEILING_USDC) {
    return fail("G6b", `vault NAV ${vaultNavUsdc} USDC > v0 ceiling ${V0_NAV_CEILING_USDC} USDC`);
  }
  return ok();
}

export function guardConfidence(confidence: number): GuardResult {
  if (!Number.isFinite(confidence)) return fail("G7", `confidence not finite (${confidence})`);
  if (confidence < 0 || confidence > 1) return fail("G7", `confidence ${confidence} out of [0,1]`);
  return ok();
}

export function guardMaxDelta(curW: number[], newW: number[]): GuardResult {
  const d = maxDelta(curW, newW);
  if (d > MAX_DELTA_BP) {
    return fail("G8", `max per-position delta ${d} bp exceeds ${MAX_DELTA_BP} bp ceiling`);
  }
  return ok();
}

export function guardCooldown(cd: CooldownContext): GuardResult {
  if (cd.lastRotationTs === null || cd.lastRotationTs === undefined) return ok();
  if (!Number.isFinite(cd.nowTs) || !Number.isFinite(cd.lastRotationTs)) {
    return fail("G9", `cooldown timestamps not finite (now=${cd.nowTs}, last=${cd.lastRotationTs})`);
  }
  const elapsed = cd.nowTs - cd.lastRotationTs;
  if (elapsed < COOLDOWN_SECONDS) {
    return fail("G9", `cooldown: ${elapsed}s since last rotation < ${COOLDOWN_SECONDS}s`);
  }
  return ok();
}

// ---------- composite ----------

export function applyGuards(curW: number[], newW: number[], ctx: GuardContext): GuardResult {
  const g4 = guardUniverseLength(newW, curW); if (!g4.ok) return g4;
  const g3 = guardNonNegative(newW); if (!g3.ok) return g3;
  const g1 = guardWeightsSum(newW); if (!g1.ok) return g1;
  const g2 = guardPerPositionCap(newW); if (!g2.ok) return g2;
  const g5 = guardHotWalletFunded(ctx.hotSolBalance); if (!g5.ok) return g5;
  const g6 = guardVaultNav(ctx.vaultNavUsdc); if (!g6.ok) return g6;
  const g7 = guardConfidence(ctx.confidence); if (!g7.ok) return g7;
  const g8 = guardMaxDelta(curW, newW); if (!g8.ok) return g8;
  return ok();
}
