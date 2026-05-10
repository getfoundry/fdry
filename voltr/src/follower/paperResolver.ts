/**
 * paperResolver.ts — daily walk over ~/.fdry/paper-trades.ndjson, mark each
 * row won/lost/pending by fetching market state from Jup, append outcome to
 * ~/.fdry/paper-results.ndjson.
 *
 * Run via: pnpm follower:resolve  (or scripts/resolve-paper.sh hourly).
 *
 * Idempotent: re-running on the same trades file produces the same results
 * file because rows are keyed by dedup_key. Already-resolved trades are
 * skipped on re-run.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { z } from "zod";
import {
  createJupPredictionClient,
  JupApiError,
  type JupPredictionClient,
} from "./jupPredictionClient.js";
import { PaperTradeRowSchema, type PaperTradeRow } from "./paperLedger.js";

export const PAPER_TRADES_DEFAULT = `${homedir()}/.fdry/paper-trades.ndjson`;
export const PAPER_RESULTS_DEFAULT = `${homedir()}/.fdry/paper-results.ndjson`;

export const PaperResultRowSchema = z.object({
  v: z.literal(1),
  ts_iso: z.string().min(20),
  dedup_key: z.string().min(1),
  jup_market_id: z.string().min(1),
  status: z.enum(["pending", "won", "lost", "voided", "error"]),
  resolved_yes: z.boolean().optional(),
  // PnL on the BUY-NO side (bridge-source doctrine):
  // - won: payoff $1 - entry, ROI = (1 - entry)/entry
  // - lost: payoff $0, ROI = -1
  pnl_per_dollar: z.number().optional(),
  market_status: z.string().optional(),
  market_result: z.string().optional(),
  error: z.string().optional(),
});
export type PaperResultRow = z.infer<typeof PaperResultRowSchema>;

export type ResolveOptions = {
  tradesPath?: string;
  resultsPath?: string;
  client?: JupPredictionClient;
  jupApiKey?: string;
  jupBaseUrl?: string;
  now?: () => number;
  logger?: (msg: string) => void;
};

export type ResolveSummary = {
  trades_total: number;
  already_resolved: number;
  newly_resolved_won: number;
  newly_resolved_lost: number;
  newly_resolved_voided: number;
  still_pending: number;
  errors: number;
};

async function readJsonLines<T>(
  path: string,
  schema: z.ZodType<T>,
): Promise<{ row: T; lineNo: number }[]> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: { row: T; lineNo: number }[] = [];
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed);
      const parsed = schema.parse(obj);
      out.push({ row: parsed, lineNo: i + 1 });
    } catch {
      // skip malformed line; resolver is read-only on trades file
    }
  });
  return out;
}

function pnlNoSide(entryNoPrice: number, won: boolean): number {
  if (entryNoPrice <= 0 || entryNoPrice >= 1) return 0;
  if (won) return (1 - entryNoPrice) / entryNoPrice;
  return -1;
}

export async function resolvePaperTrades(
  opts: ResolveOptions = {},
): Promise<ResolveSummary> {
  const tradesPath = opts.tradesPath ?? PAPER_TRADES_DEFAULT;
  const resultsPath = opts.resultsPath ?? PAPER_RESULTS_DEFAULT;
  const now = opts.now ?? Date.now;
  const log = opts.logger ?? (() => {});
  const client =
    opts.client ??
    createJupPredictionClient({
      apiKey: opts.jupApiKey ?? process.env.JUP_PREDICTION_API_KEY ?? "",
      baseUrl: opts.jupBaseUrl,
    });

  const trades = await readJsonLines(tradesPath, PaperTradeRowSchema);
  const existingResults = await readJsonLines(resultsPath, PaperResultRowSchema);
  const resolvedKeys = new Set(
    existingResults
      .filter((r) => r.row.status !== "pending")
      .map((r) => r.row.dedup_key),
  );

  const summary: ResolveSummary = {
    trades_total: trades.length,
    already_resolved: 0,
    newly_resolved_won: 0,
    newly_resolved_lost: 0,
    newly_resolved_voided: 0,
    still_pending: 0,
    errors: 0,
  };

  const newRows: PaperResultRow[] = [];
  for (const { row: trade } of trades) {
    if (resolvedKeys.has(trade.dedup_key)) {
      summary.already_resolved += 1;
      continue;
    }
    let resultRow: PaperResultRow;
    try {
      const market = await client.getMarket(trade.jup_market_id);
      const status = (market.status ?? "").toLowerCase();
      const result = (market.result ?? "").toLowerCase();
      if (status === "open" || result === "" || result === "pending") {
        resultRow = {
          v: 1,
          ts_iso: new Date(now()).toISOString(),
          dedup_key: trade.dedup_key,
          jup_market_id: trade.jup_market_id,
          status: "pending",
          market_status: market.status,
          market_result: market.result ?? undefined,
        };
        summary.still_pending += 1;
      } else if (result === "yes" || result === "no") {
        // bridge-source doctrine: BUY NO → won iff result === "no" when side="NO"
        // (or result === "yes" when side="YES", though bridge-source is NO-only).
        const won =
          (trade.side === "NO" && result === "no") ||
          (trade.side === "YES" && result === "yes");
        resultRow = {
          v: 1,
          ts_iso: new Date(now()).toISOString(),
          dedup_key: trade.dedup_key,
          jup_market_id: trade.jup_market_id,
          status: won ? "won" : "lost",
          resolved_yes: result === "yes",
          pnl_per_dollar: pnlNoSide(
            trade.side === "NO"
              ? 1 - trade.upstream_price
              : trade.upstream_price,
            won,
          ),
          market_status: market.status,
          market_result: market.result ?? undefined,
        };
        if (won) summary.newly_resolved_won += 1;
        else summary.newly_resolved_lost += 1;
      } else {
        resultRow = {
          v: 1,
          ts_iso: new Date(now()).toISOString(),
          dedup_key: trade.dedup_key,
          jup_market_id: trade.jup_market_id,
          status: "voided",
          market_status: market.status,
          market_result: market.result ?? undefined,
        };
        summary.newly_resolved_voided += 1;
      }
    } catch (err) {
      const msg =
        err instanceof JupApiError
          ? `jup_api_error: ${err.message}`
          : `${(err as Error)?.message ?? String(err)}`;
      log(`[paper-resolver] error resolving ${trade.dedup_key}: ${msg}`);
      resultRow = {
        v: 1,
        ts_iso: new Date(now()).toISOString(),
        dedup_key: trade.dedup_key,
        jup_market_id: trade.jup_market_id,
        status: "error",
        error: msg,
      };
      summary.errors += 1;
    }
    newRows.push(resultRow);
  }

  if (newRows.length > 0) {
    await fs.mkdir(dirname(resultsPath), { mode: 0o700, recursive: true });
    const lines = newRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.appendFile(resultsPath, lines, { mode: 0o600 });
  }

  log(
    `[paper-resolver] trades=${summary.trades_total} already=${summary.already_resolved} ` +
      `won=${summary.newly_resolved_won} lost=${summary.newly_resolved_lost} ` +
      `voided=${summary.newly_resolved_voided} pending=${summary.still_pending} ` +
      `errors=${summary.errors}`,
  );
  return summary;
}

// ---------- CLI entrypoint
const isDirectRun = (() => {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("paperResolver.ts") || entry.endsWith("paperResolver.js");
})();

if (isDirectRun) {
  resolvePaperTrades({
    logger: (m) => console.info(m),
  })
    .then((s) => {
      console.info(JSON.stringify(s, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.stack : String(err));
      process.exit(1);
    });
}
