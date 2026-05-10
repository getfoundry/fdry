/**
 * follower/predictionMap.ts — map a upstream-market SignalRow to a Jupiter Prediction
 * market via title-token Jaccard, then sanity-gate on price-delta and liquidity.
 *
 * Heuristic-only: this is the simplest viable mapping. The Day-7 reconciliation
 * log will record every {ok:false} reason so we can tune thresholds against
 * real upstream rows from bridge-source.
 *
 * Notes:
 *   - SignalRow uses `slug` (not `market_slug`) and `price` (not `price_usd`).
 *   - Jupiter pricing is integer micro-USD (690000 → $0.69) per Day-5 probe.
 *   - The live Event payload includes a `markets[]` array with `marketId`,
 *     `title`, `closeTime` not modeled in our zod EventSchema — we read them
 *     defensively from the raw `data` array (zod is extra-field tolerant).
 */

import type { SignalRow } from "./signal.js";
import {
  JupApiError,
  type JupPredictionClient,
  type MarketResponse,
  type OrderbookResponse,
} from "./jupPredictionClient.js";

export type MapResult =
  | {
      ok: true;
      marketId: string;
      isYes: boolean;
      jupBuyPriceUsd: number;
      sellSidePriceUsd: number;
      liquidityUsd: number;
      titleSimilarity: number;
    }
  | {
      ok: false;
      reason:
        | "no_match"
        | "low_similarity"
        | "price_delta_too_wide"
        | "liquidity_too_thin"
        | "closeTime_passed"
        | "jup_api_error";
    };

export type MapOptions = {
  minSimilarity?: number;
  maxPriceDeltaUsd?: number;
  minLiquidityMultiple?: number;
  ourTradeSizeUsd?: number;
};

const DEFAULTS = {
  minSimilarity: 0.4,
  maxPriceDeltaUsd: 0.05,
  minLiquidityMultiple: 10,
  ourTradeSizeUsd: 10,
} as const;

// Lowercased alphanumeric tokens with no stopwords removed (keep simple).
function tokenize(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

export function tokenSimilarity(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

function microUsdToUsd(v: number | null | undefined): number | undefined {
  if (v == null) return undefined;
  return v / 1e6;
}

// Defensive shape read — Event in zod doesn't model `markets[]` or `title`,
// but the live response carries them. We accept anything that looks right.
type RawCandidateMarket = {
  marketId?: unknown;
  title?: unknown;
  closeTime?: unknown;
};

function extractCandidateMarkets(
  data: ReadonlyArray<unknown>,
): Array<{ marketId: string; title: string; closeTime?: number }> {
  const out: Array<{ marketId: string; title: string; closeTime?: number }> =
    [];
  for (const ev of data) {
    if (!ev || typeof ev !== "object") continue;
    const markets = (ev as { markets?: unknown }).markets;
    if (!Array.isArray(markets)) continue;
    for (const m of markets as RawCandidateMarket[]) {
      if (!m || typeof m !== "object") continue;
      const marketId = typeof m.marketId === "string" ? m.marketId : undefined;
      const title = typeof m.title === "string" ? m.title : undefined;
      const closeTime =
        typeof m.closeTime === "number" ? m.closeTime : undefined;
      if (!marketId || !title) continue;
      out.push({ marketId, title, closeTime });
    }
  }
  return out;
}

function liquidityTopN(
  ob: OrderbookResponse,
  side: "yes" | "no",
  n = 3,
): number {
  if (!ob) return 0;
  const levels = ob[side];
  let sum = 0;
  for (let i = 0; i < Math.min(n, levels.length); i++) {
    const lvl = levels[i];
    if (!lvl) continue;
    sum += lvl[0] * lvl[1];
  }
  return sum;
}

export async function mapSignalToMarket(
  row: SignalRow,
  client: JupPredictionClient,
  opts: MapOptions = {},
): Promise<MapResult> {
  const minSimilarity = opts.minSimilarity ?? DEFAULTS.minSimilarity;
  const maxPriceDeltaUsd = opts.maxPriceDeltaUsd ?? DEFAULTS.maxPriceDeltaUsd;
  const minLiquidityMultiple =
    opts.minLiquidityMultiple ?? DEFAULTS.minLiquidityMultiple;
  const ourTradeSizeUsd = opts.ourTradeSizeUsd ?? DEFAULTS.ourTradeSizeUsd;

  const query = row.slug.replace(/-/g, " ");

  try {
    const search = await client.searchEvents(query, 10);
    const candidates = extractCandidateMarkets(search.data);
    if (candidates.length === 0) {
      return { ok: false, reason: "no_match" };
    }

    let best:
      | {
          marketId: string;
          title: string;
          closeTime?: number;
          score: number;
        }
      | null = null;
    for (const c of candidates) {
      const score = tokenSimilarity(row.slug, c.title);
      if (best === null || score > best.score) {
        best = { ...c, score };
      }
    }
    if (best === null || best.score < minSimilarity) {
      return { ok: false, reason: "low_similarity" };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (best.closeTime !== undefined && best.closeTime <= nowSec) {
      return { ok: false, reason: "closeTime_passed" };
    }

    const isYes = row.side === "YES";

    const market: MarketResponse = await client.getMarket(best.marketId);
    if (market.closeTime <= nowSec) {
      return { ok: false, reason: "closeTime_passed" };
    }

    const pricing = market.pricing ?? {};
    const buyMicro = isYes ? pricing.buyYesPriceUsd : pricing.buyNoPriceUsd;
    const sellMicro = isYes ? pricing.sellYesPriceUsd : pricing.sellNoPriceUsd;
    const jupBuyPriceUsd = microUsdToUsd(buyMicro);
    const sellSidePriceUsd = microUsdToUsd(sellMicro);
    if (jupBuyPriceUsd === undefined || sellSidePriceUsd === undefined) {
      return { ok: false, reason: "price_delta_too_wide" };
    }

    if (Math.abs(jupBuyPriceUsd - row.price) > maxPriceDeltaUsd) {
      return { ok: false, reason: "price_delta_too_wide" };
    }

    const ob = await client.getOrderbook(best.marketId);
    const liquidityUsd = liquidityTopN(ob, isYes ? "yes" : "no", 3);
    if (liquidityUsd < minLiquidityMultiple * ourTradeSizeUsd) {
      return { ok: false, reason: "liquidity_too_thin" };
    }

    return {
      ok: true,
      marketId: best.marketId,
      isYes,
      jupBuyPriceUsd,
      sellSidePriceUsd,
      liquidityUsd,
      titleSimilarity: best.score,
    };
  } catch (err) {
    if (err instanceof JupApiError) {
      return { ok: false, reason: "jup_api_error" };
    }
    throw err;
  }
}
