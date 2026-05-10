/**
 * voltr/src/signal.ts
 *
 * Reads the v6b daily signal (par-type + λ fade bilinear EBM) produced by
 * ~/Projects/ebllm/emit_voltr_signals_v6b.py and translates it into
 * integer basis-point weights for the Voltr Manager rotator.
 *
 * Contract: SIGNAL_BOUNDARY.md (public/private seam).
 *
 * v0 policy: LONG-ONLY.
 *   - v6b signals can express short positions via negative weights_bp.
 *   - Until Drift adaptor is integrated (v0.1+), negative weights are
 *     folded into CASH. The vault holds only spot longs via Jupiter +
 *     USDC via Save.
 *
 * Safety policy:
 *   - Confidence < CONFIDENCE_MIN → force full cash.
 *   - Staleness > FRESHNESS_MAX_MS → fail-closed.
 *
 * Failure mode: fail-closed. readSignalFile() returns { ok: false, reason }
 * on any problem (missing file, stale, parse error, invariant violation).
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SIGNAL_DIR =
  process.env.SIGNAL_DIR ?? "~/Projects/ebllm/signals_out_v6b";
export const FRESHNESS_MAX_MS = process.env.FRESHNESS_MAX_MS
  ? Number(process.env.FRESHNESS_MAX_MS)
  : 26 * 60 * 60 * 1000; // default 26h, override via env for intraday signals
export const CONFIDENCE_MIN = 0.4; // below this, force all-cash
export const TOTAL_BP = 10_000;

// ---------------------------------------------------------------------------
// Zod schema — matches v6b output (`signal_version: "v0.6b"`)
// ---------------------------------------------------------------------------

const IsoUtcRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const SignalSchema = z
  .object({
    timestamp: z.string().regex(IsoUtcRe, "timestamp must be ISO 8601 UTC with Z suffix"),
    signal_version: z.string().regex(/^v\d+\.\d+[a-z]?$/, "signal_version like v0.6b"),
    universe: z.array(z.string().min(1)).min(2),
    // v6b allows negative weights_bp for shorts; v0 folds them to CASH.
    weights_bp: z.record(z.string(), z.number().int()),
    confidence: z.number().min(0).max(1),
    ranker: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).default({}),
    side: z.record(z.string(), z.enum(["long", "short"])).optional(),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.universe).size !== v.universe.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "universe must contain unique tokens" });
    }
    if (!v.universe.includes("CASH")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "universe must include CASH" });
    }
    const wk = new Set(Object.keys(v.weights_bp));
    const uni = new Set(v.universe);
    if (wk.size !== uni.size || [...wk].some((k) => !uni.has(k))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "weights_bp keys must equal universe set" });
    }
    // v6b invariant: sum of |weights_bp| = TOTAL_BP (signed weights).
    const absSum = Object.values(v.weights_bp).reduce((a, b) => a + Math.abs(b), 0);
    if (absSum !== TOTAL_BP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `sum(|weights_bp|) must equal ${TOTAL_BP}, got ${absSum}`,
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
  return entries.filter((n) => n.endsWith(".json")).map((n) => path.join(dir, n));
}

async function pickLatest(files: string[]): Promise<string | null> {
  if (files.length === 0) return null;
  const stats = await Promise.all(files.map(async (f) => ({ f, mtime: (await fs.stat(f)).mtimeMs })));
  stats.sort((a, b) => b.mtime - a.mtime);
  return stats[0]?.f ?? null;
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
    return { ok: false, reason: `signal dir unreadable: ${(e as Error).message}` };
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
    return { ok: false, reason: `json parse failed in ${latest}: ${(e as Error).message}` };
  }

  const check = SignalSchema.safeParse(parsed);
  if (!check.success) {
    const msg = check.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { ok: false, reason: `schema validation failed: ${msg}` };
  }
  const signal = check.data;

  const ts = Date.parse(signal.timestamp);
  if (Number.isNaN(ts)) return { ok: false, reason: `invalid timestamp: ${signal.timestamp}` };
  const ageMs = now.getTime() - ts;
  if (ageMs < 0) return { ok: false, reason: `signal timestamp in the future by ${-ageMs}ms` };
  if (ageMs > FRESHNESS_MAX_MS) {
    return {
      ok: false,
      reason: `signal stale: age=${Math.round(ageMs / 1000)}s > ${Math.round(FRESHNESS_MAX_MS / 1000)}s`,
    };
  }

  return { ok: true, signal, path: latest, ageMs };
}

// ---------------------------------------------------------------------------
// Public: longOnlyWeights
// ---------------------------------------------------------------------------

/**
 * v0 policy: take the signal's signed weights_bp, drop shorts (negative),
 * redistribute the removed basis points into CASH, and renormalize so the
 * result is a pure long-only allocation summing to exactly 10_000.
 *
 * Also applies confidence-based force-to-cash when confidence < CONFIDENCE_MIN.
 */
export function longOnlyWeights(signal: Signal): Record<string, number> {
  const uni = signal.universe;
  if (signal.confidence < CONFIDENCE_MIN) {
    // All cash.
    const out: Record<string, number> = {};
    for (const t of uni) out[t] = t === "CASH" ? TOTAL_BP : 0;
    return out;
  }

  const longs: Record<string, number> = {};
  let shortBp = 0;
  for (const t of uni) {
    const w = signal.weights_bp[t] ?? 0;
    if (w > 0) longs[t] = w;
    else if (w < 0) shortBp += Math.abs(w);
    else longs[t] = 0;
  }
  // Fold short bp into CASH.
  longs["CASH"] = (longs["CASH"] ?? 0) + shortBp;

  // Ensure every universe token is present.
  for (const t of uni) if (!(t in longs)) longs[t] = 0;

  // Sanity: long-only sum must be exactly TOTAL_BP.
  const sum = uni.reduce((a, t) => a + (longs[t] ?? 0), 0);
  if (sum !== TOTAL_BP) {
    // Absorb residual into CASH.
    longs["CASH"] = (longs["CASH"] ?? 0) + (TOTAL_BP - sum);
  }
  return longs;
}
