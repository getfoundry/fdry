/**
 * bot/src/signal.ts
 *
 * Reads the bible-EBM daily signal produced by the fib-harness and translates
 * it into integer basis-point weights for the vault rebalancer.
 *
 * Contract: /Users/lekt9/Projects/fdry/docs/SIGNAL_CONTRACT.md
 *
 * Safety policy (Cycle 3 concession):
 *   - If the signal's ranker is "equal_weight" OR confidence < 0.5, we
 *     override to equal-weight. Backtest shows bible-HIGH loses to EW, so we
 *     ship the vault with EW as the default until live evidence flips.
 *
 * Failure mode: fail-closed. readSignalFile() returns
 *   { ok: false, reason } on any problem (missing file, stale, parse error,
 *   invariant violation) so the caller can skip the rebalance and alert.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SIGNAL_DIR = "/Users/lekt9/Projects/fdry/runs/daily_signal";
export const FRESHNESS_MAX_MS = 6 * 60 * 60 * 1000; // 6 hours
export const CONFIDENCE_MIN = 0.5;
export const TOTAL_BP = 10000;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const IsoUtcRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const SignalSchema = z
  .object({
    timestamp: z
      .string()
      .regex(IsoUtcRe, "timestamp must be ISO 8601 UTC with Z suffix"),
    signal_version: z.string().regex(/^v\d+\.\d+$/, "signal_version like v0.1"),
    universe: z.array(z.string().min(1)).min(1),
    weights_bp: z.record(z.string(), z.number().int().nonnegative()),
    confidence: z.number().min(0).max(1),
    ranker: z.enum([
      "bible_high",
      "composite",
      "train_sharpe",
      "equal_weight",
    ]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((v, ctx) => {
    // universe unique
    if (new Set(v.universe).size !== v.universe.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "universe must contain unique tokens",
      });
    }
    // keys of weights_bp exactly match universe
    const wk = new Set(Object.keys(v.weights_bp));
    const uni = new Set(v.universe);
    if (wk.size !== uni.size || [...wk].some((k) => !uni.has(k))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weights_bp keys must equal universe set",
      });
    }
    // sum exactly 10000
    const sum = Object.values(v.weights_bp).reduce((a, b) => a + b, 0);
    if (sum !== TOTAL_BP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `weights_bp must sum to ${TOTAL_BP}, got ${sum}`,
      });
    }
  });

export type Signal = z.infer<typeof SignalSchema>;

export type SignalResult =
  | { ok: true; signal: Signal; path: string; ageMs: number }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function listSignalFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return entries
    .filter((n) => n.endsWith(".json"))
    .map((n) => path.join(dir, n));
}

async function pickLatest(files: string[]): Promise<string | null> {
  if (files.length === 0) return null;
  const stats = await Promise.all(
    files.map(async (f) => ({ f, mtime: (await fs.stat(f)).mtimeMs })),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return stats[0].f;
}

// ---------------------------------------------------------------------------
// Public: readSignalFile
// ---------------------------------------------------------------------------

export async function readSignalFile(
  dir: string = SIGNAL_DIR,
  now: Date = new Date(),
): Promise<SignalResult> {
  let files: string[];
  try {
    files = await listSignalFiles(dir);
  } catch (e: unknown) {
    return {
      ok: false,
      reason: `signal dir unreadable: ${(e as Error).message}`,
    };
  }
  const latest = await pickLatest(files);
  if (!latest) return { ok: false, reason: `no signal files in ${dir}` };

  let raw: string;
  try {
    raw = await fs.readFile(latest, "utf8");
  } catch (e: unknown) {
    return { ok: false, reason: `read failed: ${(e as Error).message}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    return {
      ok: false,
      reason: `json parse failed in ${latest}: ${(e as Error).message}`,
    };
  }

  const check = SignalSchema.safeParse(parsed);
  if (!check.success) {
    const msg = check.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `schema validation failed: ${msg}` };
  }
  const signal = check.data;

  // Freshness
  const ts = Date.parse(signal.timestamp);
  if (Number.isNaN(ts)) {
    return { ok: false, reason: `invalid timestamp: ${signal.timestamp}` };
  }
  const ageMs = now.getTime() - ts;
  if (ageMs < 0) {
    return {
      ok: false,
      reason: `signal timestamp in the future by ${-ageMs}ms`,
    };
  }
  if (ageMs > FRESHNESS_MAX_MS) {
    return {
      ok: false,
      reason: `signal stale: age=${Math.round(ageMs / 1000)}s > ${Math.round(
        FRESHNESS_MAX_MS / 1000,
      )}s`,
    };
  }

  return { ok: true, signal, path: latest, ageMs };
}

// ---------------------------------------------------------------------------
// Public: signalToWeights
// ---------------------------------------------------------------------------

/**
 * Produce an equal-weight basis-point vector for the given universe.
 * Sum is guaranteed to be exactly TOTAL_BP — any integer-rounding residual
 * is absorbed into the first element.
 */
export function equalWeightBp(universe: string[]): number[] {
  const n = universe.length;
  if (n === 0) throw new Error("equalWeightBp: empty universe");
  const base = Math.floor(TOTAL_BP / n);
  const out = new Array<number>(n).fill(base);
  const residual = TOTAL_BP - base * n;
  out[0] += residual;
  return out;
}

/**
 * Maps signal.weights_bp to a basis-point array in the caller's universe order.
 *
 * Fallback to equal-weight if:
 *   - signal.ranker === "equal_weight" (explicit producer signal)
 *   - signal.confidence < CONFIDENCE_MIN (0.5)
 *   - any caller-universe token is missing from signal.weights_bp
 *
 * Post-condition: returned array has length === universe.length and sums
 * to exactly TOTAL_BP. Throws if invariants can't be satisfied.
 */
export function signalToWeights(
  signal: Signal,
  universe: string[],
): number[] {
  if (universe.length === 0) {
    throw new Error("signalToWeights: empty universe");
  }

  // Safety fallback: explicit EW ranker or low confidence.
  if (signal.ranker === "equal_weight" || signal.confidence < CONFIDENCE_MIN) {
    const out = equalWeightBp(universe);
    assertSumExact(out);
    return out;
  }

  // Coverage fallback: any missing token -> equal weight.
  const missing = universe.filter(
    (t) => !(t in signal.weights_bp),
  );
  if (missing.length > 0) {
    const out = equalWeightBp(universe);
    assertSumExact(out);
    return out;
  }

  // Map signal bp into caller order.
  const mapped = universe.map((t) => signal.weights_bp[t]);
  const sum = mapped.reduce((a, b) => a + b, 0);

  if (sum === TOTAL_BP) {
    return mapped;
  }
  // If caller universe is a strict subset of signal universe (or order differs),
  // the sub-sum won't equal 10000. Renormalise into integer basis points and
  // absorb residual into the largest weight.
  if (sum <= 0) {
    const out = equalWeightBp(universe);
    assertSumExact(out);
    return out;
  }
  const renorm = mapped.map((w) => Math.floor((w * TOTAL_BP) / sum));
  const residual = TOTAL_BP - renorm.reduce((a, b) => a + b, 0);
  // Absorb residual into largest weight.
  let maxIdx = 0;
  for (let i = 1; i < renorm.length; i++) {
    if (renorm[i] > renorm[maxIdx]) maxIdx = i;
  }
  renorm[maxIdx] += residual;
  assertSumExact(renorm);
  return renorm;
}

function assertSumExact(bp: number[]): void {
  const s = bp.reduce((a, b) => a + b, 0);
  if (s !== TOTAL_BP) {
    throw new Error(
      `invariant violated: weights must sum to ${TOTAL_BP}, got ${s}`,
    );
  }
}
