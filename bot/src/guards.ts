/**
 * guards.ts — Pre-rebalance sanity checks.
 *
 * All functions are pure: they only read inputs and return structured
 * results. No network calls, no disk I/O, no logging, no throws for
 * business-logic failures. Callers log/handle `GuardResult.reason`.
 *
 * Units:
 *   - weights: basis points (bp). 10000 bp == 100%.
 *   - SOL balances: floating-point SOL units.
 *   - confidence: [0, 1].
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Universe size: number of assets the vault rebalances across. */
export const UNIVERSE_SIZE = 7;

/** Total bp in a valid weight vector. */
export const TOTAL_BP = 10_000;

/** Tolerance for weight-sum check (bp). */
export const SUM_TOLERANCE_BP = 1;

/** Per-position cap (bp). 30% of vault. */
export const MAX_WEIGHT_BP = 3_000;

/** Min SOL the hot wallet must hold for fee payment. */
export const MIN_HOT_SOL = 0.05;

/** Min vault NAV (SOL) — guards against empty/destroyed vault. */
export const MIN_VAULT_NAV_SOL = 0.1;

/** Min confidence for a non-equal-weight ranker. Below this, force EW. */
export const MIN_CONFIDENCE_FOR_ACTIVE = 0.5;

/** Equal-weight ranker identifier — the always-allowed fallback. */
export const EQUAL_WEIGHT_RANKER = "equal_weight";

/** Max absolute per-position bp delta between rebalances. */
export const MAX_DELTA_BP = 4_000;

/** Cooldown between rebalances (seconds). 24h. */
export const COOLDOWN_SECONDS = 86_400;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardResult {
  ok: boolean;
  reason?: string;
  failedGuard?: string;
}

export interface GuardContext {
  hotSolBalance: number;
  vaultNavSol: number;
  confidence: number;
  ranker: string;
}

export interface CooldownContext {
  /** Unix seconds of the previous rebalance, or null if never rebalanced. */
  lastRebalanceTs: number | null;
  /** Unix seconds "now". */
  nowTs: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Return max absolute bp difference per index between two weight vectors. */
export function maxDelta(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    // Length mismatch is itself an anomaly; caller's G4 will reject. Return
    // Infinity so any delta-bound check trips and surfaces the mismatch.
    return Number.POSITIVE_INFINITY;
  }
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    if (d > max) max = d;
  }
  return max;
}

/** Sum of a numeric array. Pure. */
export function sumWeights(w: number[]): number {
  let s = 0;
  for (const v of w) s += v;
  return s;
}

/** ok-result singleton builder. */
function ok(): GuardResult {
  return { ok: true };
}

/** fail-result builder. */
function fail(failedGuard: string, reason: string): GuardResult {
  return { ok: false, failedGuard, reason };
}

// ---------------------------------------------------------------------------
// Individual guards — each pure, each returns GuardResult.
// Exported so they can be unit-tested in isolation.
// ---------------------------------------------------------------------------

/** G1: weights sum to 10000 ± SUM_TOLERANCE_BP. */
export function guardWeightsSum(newWeights: number[]): GuardResult {
  const total = sumWeights(newWeights);
  if (Math.abs(total - TOTAL_BP) > SUM_TOLERANCE_BP) {
    return fail(
      "G1",
      `weights sum to ${total} bp, expected ${TOTAL_BP} ± ${SUM_TOLERANCE_BP}`,
    );
  }
  return ok();
}

/** G2: no single weight exceeds per-position cap. */
export function guardPerPositionCap(newWeights: number[]): GuardResult {
  for (let i = 0; i < newWeights.length; i++) {
    const w = newWeights[i];
    if (w > MAX_WEIGHT_BP) {
      return fail(
        "G2",
        `weight[${i}]=${w} bp exceeds per-position cap of ${MAX_WEIGHT_BP} bp`,
      );
    }
  }
  return ok();
}

/** G3: no negative weights. */
export function guardNonNegative(newWeights: number[]): GuardResult {
  for (let i = 0; i < newWeights.length; i++) {
    const w = newWeights[i];
    if (w < 0) {
      return fail("G3", `weight[${i}]=${w} bp is negative`);
    }
  }
  return ok();
}

/** G4: universe length must equal UNIVERSE_SIZE. */
export function guardUniverseLength(
  newWeights: number[],
  currentWeights: number[],
): GuardResult {
  if (newWeights.length !== UNIVERSE_SIZE) {
    return fail(
      "G4",
      `newWeights has length ${newWeights.length}, expected ${UNIVERSE_SIZE}`,
    );
  }
  if (currentWeights.length !== UNIVERSE_SIZE) {
    return fail(
      "G4",
      `currentWeights has length ${currentWeights.length}, expected ${UNIVERSE_SIZE}`,
    );
  }
  return ok();
}

/** G5: hot wallet SOL must cover fees. */
export function guardHotWalletFunded(hotSolBalance: number): GuardResult {
  if (!Number.isFinite(hotSolBalance) || hotSolBalance < MIN_HOT_SOL) {
    return fail(
      "G5",
      `hot wallet has ${hotSolBalance} SOL, need ≥ ${MIN_HOT_SOL} SOL for fees`,
    );
  }
  return ok();
}

/** G6: vault NAV must be above the "empty/destroyed" floor. */
export function guardVaultNav(vaultNavSol: number): GuardResult {
  if (!Number.isFinite(vaultNavSol) || vaultNavSol <= MIN_VAULT_NAV_SOL) {
    return fail(
      "G6",
      `vault NAV ${vaultNavSol} SOL ≤ ${MIN_VAULT_NAV_SOL} SOL floor (empty/destroyed vault?)`,
    );
  }
  return ok();
}

/**
 * G7: if confidence is low, the only allowed ranker is equal_weight.
 * Callers must explicitly select EW when they lack conviction.
 */
export function guardConfidenceRanker(
  confidence: number,
  ranker: string,
): GuardResult {
  if (!Number.isFinite(confidence)) {
    return fail("G7", `confidence is not finite (${confidence})`);
  }
  if (
    confidence < MIN_CONFIDENCE_FOR_ACTIVE &&
    ranker !== EQUAL_WEIGHT_RANKER
  ) {
    return fail(
      "G7",
      `confidence ${confidence} < ${MIN_CONFIDENCE_FOR_ACTIVE} but ranker="${ranker}"; must explicitly use "${EQUAL_WEIGHT_RANKER}"`,
    );
  }
  return ok();
}

/** G8: reject catastrophic per-position shifts. */
export function guardMaxDelta(
  currentWeights: number[],
  newWeights: number[],
): GuardResult {
  const d = maxDelta(currentWeights, newWeights);
  if (d > MAX_DELTA_BP) {
    return fail(
      "G8",
      `max per-position delta ${d} bp exceeds ${MAX_DELTA_BP} bp ceiling`,
    );
  }
  return ok();
}

/**
 * G9: cooldown respected. The caller SHOULD NOT attempt a rebalance within
 * COOLDOWN_SECONDS of the prior one. This function is offered so callers can
 * include the check inside the same pure pipeline; it is not wired into
 * `applyGuards` because the GuardContext in the public signature does not
 * carry timestamps. Callers pass a CooldownContext explicitly.
 */
export function guardCooldown(cd: CooldownContext): GuardResult {
  if (cd.lastRebalanceTs === null || cd.lastRebalanceTs === undefined) {
    return ok();
  }
  if (!Number.isFinite(cd.nowTs) || !Number.isFinite(cd.lastRebalanceTs)) {
    return fail(
      "G9",
      `cooldown timestamps not finite (now=${cd.nowTs}, last=${cd.lastRebalanceTs})`,
    );
  }
  const elapsed = cd.nowTs - cd.lastRebalanceTs;
  if (elapsed < COOLDOWN_SECONDS) {
    return fail(
      "G9",
      `cooldown not respected: ${elapsed}s since last rebalance < ${COOLDOWN_SECONDS}s`,
    );
  }
  return ok();
}

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

/**
 * Apply all guards that depend only on (currentWeights, newWeights, ctx).
 * Runs in a deterministic order and short-circuits on the first failure so
 * the caller sees the most fundamental problem first.
 *
 * G9 (cooldown) is NOT evaluated here because the public signature does not
 * carry timestamps — callers must invoke `guardCooldown` separately before
 * calling `applyGuards`, matching the documented contract: "caller must not
 * attempt if last rebalance < 86400 sec ago".
 */
export function applyGuards(
  currentWeights: number[],
  newWeights: number[],
  ctx: GuardContext,
): GuardResult {
  // Structural guards first — any downstream guard that reads by index
  // assumes the universe length is correct.
  const g4 = guardUniverseLength(newWeights, currentWeights);
  if (!g4.ok) return g4;

  // Shape of new weights.
  const g3 = guardNonNegative(newWeights);
  if (!g3.ok) return g3;

  const g1 = guardWeightsSum(newWeights);
  if (!g1.ok) return g1;

  const g2 = guardPerPositionCap(newWeights);
  if (!g2.ok) return g2;

  // Environmental guards.
  const g5 = guardHotWalletFunded(ctx.hotSolBalance);
  if (!g5.ok) return g5;

  const g6 = guardVaultNav(ctx.vaultNavSol);
  if (!g6.ok) return g6;

  // Policy guards.
  const g7 = guardConfidenceRanker(ctx.confidence, ctx.ranker);
  if (!g7.ok) return g7;

  const g8 = guardMaxDelta(currentWeights, newWeights);
  if (!g8.ok) return g8;

  return ok();
}

// ---------------------------------------------------------------------------
// Default export — convenient bundle for consumers that prefer a namespace.
// ---------------------------------------------------------------------------

const guards = {
  // composite
  applyGuards,
  // helpers
  maxDelta,
  sumWeights,
  // individual guards
  guardWeightsSum,
  guardPerPositionCap,
  guardNonNegative,
  guardUniverseLength,
  guardHotWalletFunded,
  guardVaultNav,
  guardConfidenceRanker,
  guardMaxDelta,
  guardCooldown,
  // constants
  UNIVERSE_SIZE,
  TOTAL_BP,
  SUM_TOLERANCE_BP,
  MAX_WEIGHT_BP,
  MIN_HOT_SOL,
  MIN_VAULT_NAV_SOL,
  MIN_CONFIDENCE_FOR_ACTIVE,
  EQUAL_WEIGHT_RANKER,
  MAX_DELTA_BP,
  COOLDOWN_SECONDS,
};

export default guards;
