/**
 * follower/signal.ts — wire contract for bridge-source → fdry signal pipeline.
 *
 * References:
 *   - docs/research/RESEARCH_FINDINGS.md (Day 1-2 research)
 *   - docs/PLAN_FOLLOW_IMABETTINGMAN.md  (Day 2 plan)
 *   - ../../../bridge-source/docs/SIGNAL_SCHEMA.md (wire contract)
 *
 * Still UNFINISHED (only items that remain so):
 *   - verifySignature() is a stub returning false — must wire @noble/ed25519.
 *   - Schema is v1 only; no migration shim yet.
 *   - `paper:true` rows pass the schema; the FOLLOWER caller must drop them
 *     before they touch the vault.
 */

import { z } from "zod";

export type SignalAction = "open" | "close" | "claim";

export const SignalActionSchema = z.enum(["open", "close", "claim"]);

export const SignalRowSchema = z.object({
  v: z.literal(1),
  ts: z.string().min(20), // ISO8601 UTC
  action: SignalActionSchema,
  slug: z.string().min(1),
  side: z.enum(["YES", "NO"]),
  token_id: z.string().min(1),
  price: z.number().finite().nonnegative(),
  size_usd: z.number().finite().nonnegative(),
  size_shares: z.number().finite().nonnegative(),
  evm_tx: z.string().min(3),
  order_id: z.string().optional(),
  quality_bucket: z.string().optional(),
  paper: z.boolean(),
});

export type SignalRow = z.infer<typeof SignalRowSchema>;

export const SignedSignalEnvelopeSchema = z.object({
  row: SignalRowSchema,
  sig: z.string().min(1), // base64 ed25519 signature
  signer: z.string().min(1), // base64 ed25519 pubkey
});

export type SignedSignalEnvelope = z.infer<typeof SignedSignalEnvelopeSchema>;

export class SignalParseError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "SignalParseError";
    this.issues = issues;
  }
}

/**
 * Parse one NDJSON line into a SignalRow. Throws SignalParseError on bad
 * shape. Accepts either a bare row OR a signed envelope (in the latter
 * case the envelope's row is returned — verification is the caller's job
 * via verifySignature).
 */
export function parseSignalRow(line: string): SignalRow {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    throw new SignalParseError("empty line", []);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (err) {
    throw new SignalParseError(
      `invalid JSON: ${(err as Error).message}`,
      [],
    );
  }

  // Try envelope first; fall back to bare row.
  const envParse = SignedSignalEnvelopeSchema.safeParse(raw);
  if (envParse.success) {
    return envParse.data.row;
  }

  const rowParse = SignalRowSchema.safeParse(raw);
  if (!rowParse.success) {
    throw new SignalParseError(
      "row failed schema",
      rowParse.error.issues,
    );
  }
  return rowParse.data;
}

/**
 * Verify ed25519 signature over canonical(row).
 * STUB: returns false. Wire to @noble/ed25519 in next step.
 */
export function verifySignature(
  env: SignedSignalEnvelope,
  allowedSigner: string,
): boolean {
  void env;
  void allowedSigner;
  // TODO(day-4): import { ed25519 } from "@noble/curves/ed25519"
  //              canonicalize row -> sha256 -> ed25519.verify(sig, msg, signer)
  //              and confirm signer === allowedSigner before trusting.
  return false;
}

/**
 * Composite dedup key per SIGNAL_SCHEMA.md.
 */
export function dedupKey(row: SignalRow): string {
  // Synthetic fallback for unfilled/voided rows where evm_tx is null/empty
  // (Day-3 lost-sheep: dedup must not collide across same-ts unfilled rows).
  const tx = row.evm_tx;
  if (tx && tx.length >= 3) return `${row.ts}:${tx}`;
  return `${row.ts}:syn:${row.action}:${row.slug}:${row.side}:${row.order_id ?? "noid"}`;
}

export interface PollOpts {
  kvUrl: string;
  cursor: string | null;
  allowedSigner: string;
}

export interface PollResult {
  rows: SignalRow[];
  nextCursor: string;
}

/**
 * DEPRECATED as of Day 6: runFollower(...) consumes a `fetchSinceCursor`
 * adapter instead of calling this function. Kept exported so any stale
 * external caller fails loudly rather than silently no-op'ing.
 */
export async function pollOnce(opts: PollOpts): Promise<PollResult> {
  void opts;
  throw new Error(
    "signal.pollOnce is deprecated as of Day 6 — use the fetchSinceCursor adapter passed to runFollower(); this stub remains as a reference to the original boundary contract",
  );
}

// last-pruned: 2026-05-09 step6/dominion
