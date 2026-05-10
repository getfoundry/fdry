/**
 * paperLedger.ts — append-only paper-trade journal.
 *
 * Every `would_sign` decision (in dryRun mode, plus future production for
 * audit purposes) gets one row here. The daily resolver script walks this
 * file and marks each row won/lost/pending by fetching market state from Jup.
 *
 * File: ~/.fdry/paper-trades.ndjson
 * Schema: see PaperTradeRowSchema below.
 *
 * Append-only. No mutation. Daily rotation matches triggers.ndjson convention.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { z } from "zod";
import type { SignalRow } from "./signal.js";

export const PAPER_LEDGER_DEFAULT = `${homedir()}/.fdry/paper-trades.ndjson`;

export const PaperTradeRowSchema = z.object({
  v: z.literal(1),
  ts_iso: z.string().min(20),
  ts_unix: z.number().int().nonnegative(),
  dedup_key: z.string().min(1),
  // From the trigger / SignalRow:
  upstream_slug: z.string().min(1),
  side: z.enum(["NO", "YES"]),
  upstream_price: z.number().min(0).max(1),
  // From the resolver / mapSignal:
  jup_market_id: z.string().min(1),
  jup_buy_price_usd: z.number().min(0).max(1),
  // From guards / vault:
  intended_size_fdry: z.number().nonnegative(),
  vault_nav_fdry: z.number().nonnegative(),
  // Optional jup tx that would have been signed:
  unsigned_tx_base64: z.string().optional(),
});
export type PaperTradeRow = z.infer<typeof PaperTradeRowSchema>;

export type PaperLedgerWriteInput = {
  dedupKey: string;
  row: SignalRow;
  marketId: string;
  jupBuyPriceUsd: number;
  sizeFdry: number;
  navFdry: number;
  unsignedTxBase64?: string;
};

export class PaperLedger {
  readonly path: string;
  constructor(opts: { path?: string } = {}) {
    this.path = opts.path ?? PAPER_LEDGER_DEFAULT;
  }

  async append(input: PaperLedgerWriteInput, nowMs: number = Date.now()): Promise<void> {
    const row: PaperTradeRow = {
      v: 1,
      ts_iso: new Date(nowMs).toISOString(),
      ts_unix: Math.floor(nowMs / 1000),
      dedup_key: input.dedupKey,
      upstream_slug: input.row.slug,
      side: input.row.side,
      upstream_price: input.row.price,
      jup_market_id: input.marketId,
      jup_buy_price_usd: input.jupBuyPriceUsd,
      intended_size_fdry: input.sizeFdry,
      vault_nav_fdry: input.navFdry,
      ...(input.unsignedTxBase64
        ? { unsigned_tx_base64: input.unsignedTxBase64 }
        : {}),
    };
    // Validate before persisting — caught issues won't be writable.
    PaperTradeRowSchema.parse(row);
    await fs.mkdir(dirname(this.path), { mode: 0o700, recursive: true });
    await fs.appendFile(this.path, JSON.stringify(row) + "\n", { mode: 0o600 });
  }
}
