/**
 * Jupiter Prediction REST client (typed, validated).
 *
 * Source of truth: https://api.jup.ag/prediction/v1 (OpenAPI 3.0 spec, ~2295 lines).
 * Local snapshot used when authoring this seed: /tmp/predict.yaml
 *  - CreateOrderRequest    L495
 *  - CreateOrderResponse   L378
 *  - CloseOrderResponse    L533  (carries accounts.owner / authority / settlementMint
 *                                 + requiredSigners[] — the structural facts our
 *                                 pre-sign assertion relies on)
 *  - Market                L93   (status / result / pricing)
 *  - Event                 L143  (eventId / metadata / closeCondition)
 *  - TradingStatusResponse L1021
 *
 * BETA WARNING: Jupiter explicitly flags this API as beta — request/response
 * shapes can change with no version bump. Schema validation here is the
 * tripwire: if the API drifts under us, we throw `JupApiError` instead of
 * silently passing a malformed object to the on-chain signer.
 *
 * GEO BLOCK: Jupiter blocks US/KR origins at the edge. Calls from those
 * regions return a 403 with a generic body — handled as a JupApiError but
 * worth flagging at deployment time.
 *
 * STUB CAVEATS: this file deliberately does NOT mirror the full 2295-line
 * spec. Only the shapes the SignalAction follower needs are modeled here.
 * Adding a new endpoint = adding the zod schema + one method, not a sweep.
 */

import { z } from "zod";

export const JUPUSD_MINT = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

const DEFAULT_BASE_URL = "https://api.jup.ag/prediction/v1";

// ────────────────────────────────────────────────────────────────────────────
// Schemas (only what SignalAction needs — see boundary 5 in Day-2 contracts)
// ────────────────────────────────────────────────────────────────────────────

export const TradingStatusSchema = z.object({
  trading_active: z.boolean(),
});
export type TradingStatus = z.infer<typeof TradingStatusSchema>;

const MarketPricingSchema = z
  .object({
    buyYesPriceUsd: z.number().nullable().optional(),
    buyNoPriceUsd: z.number().nullable().optional(),
    sellYesPriceUsd: z.number().nullable().optional(),
    sellNoPriceUsd: z.number().nullable().optional(),
    volume: z.number().optional(),
  })
  .partial();

export const MarketResponseSchema = z.object({
  marketId: z.string(),
  status: z.enum(["open", "closed", "cancelled"]),
  result: z.union([z.literal("yes"), z.literal("no"), z.null()]),
  openTime: z.number(),
  closeTime: z.number(),
  resolveAt: z.number().nullable(),
  pricing: MarketPricingSchema.optional(),
});
export type MarketResponse = z.infer<typeof MarketResponseSchema>;

// Orderbook: { yes: [[price,size]], no: [[price,size]], yes_dollars, no_dollars }
const LevelNumSchema = z.tuple([z.number(), z.number()]);
const LevelStrSchema = z.tuple([z.string(), z.number()]);

export const OrderbookResponseSchema = z
  .object({
    yes: z.array(LevelNumSchema),
    no: z.array(LevelNumSchema),
    yes_dollars: z.array(LevelStrSchema),
    no_dollars: z.array(LevelStrSchema),
  })
  .nullable();
export type OrderbookResponse = z.infer<typeof OrderbookResponseSchema>;

// Event — surface needed by both /events/search consumers AND the Phase C
// snapshot maintainer. Day-5 live-probe confirmed these fields land on every
// event; metadata.slug + markets[] are what the resolver indexes by.
export const EventMarketStubSchema = z
  .object({
    marketId: z.string(),
    title: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
  })
  .passthrough();

export const EventMetadataSchema = z
  .object({
    slug: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    series: z.string().optional().nullable(),
    closeTime: z.string().optional().nullable(),
  })
  .passthrough();

export const EventSchema = z
  .object({
    eventId: z.string(),
    isActive: z.boolean(),
    isLive: z.boolean(),
    category: z.string(),
    subcategory: z.string(),
    volumeUsd: z.string(),
    closeCondition: z.string(),
    beginAt: z.string().nullable(),
    rulesPdf: z.string(),
    metadata: EventMetadataSchema.optional().nullable(),
    markets: z.array(EventMarketStubSchema).optional().nullable(),
  })
  .passthrough();
export type Event = z.infer<typeof EventSchema>;

export const EventsSearchResponseSchema = z.object({
  data: z.array(EventSchema),
});
export type EventsSearchResponse = z.infer<typeof EventsSearchResponseSchema>;

// /events listing endpoint paginates 20 per page regardless of &end=N (R3 finding).
// Use pagination.hasNext + start cursor to walk the full active universe.
export const EventsListPaginationSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
export const EventsListResponseSchema = z.object({
  data: z.array(EventSchema),
  pagination: EventsListPaginationSchema,
});
export type EventsListResponse = z.infer<typeof EventsListResponseSchema>;

export type ListEventsParams = {
  category?: string;
  filter?: "live" | "trending" | "new";
  start?: number;
  end?: number;
};

// CreateOrderRequest — only `isBuy` is required by the spec; everything else
// is contextual (buy needs marketId+depositAmount; sell needs positionPubkey+contracts).
export const CreateOrderRequestSchema = z.object({
  ownerPubkey: z.string().optional(),
  marketId: z.string().min(1).optional(),
  positionPubkey: z.string().min(32).optional(),
  isYes: z.boolean().optional(),
  isBuy: z.boolean(),
  contracts: z.union([z.string(), z.number()]).optional(),
  depositAmount: z.union([z.string(), z.number()]).optional(),
  depositMint: z.string().optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

const CreateOrderInnerOrderSchema = z.object({
  orderPubkey: z.string().nullable(),
  orderAtaPubkey: z.string().nullable(),
  userPubkey: z.string(),
  marketId: z.string(),
  marketIdHash: z.string(),
  positionPubkey: z.string(),
  isBuy: z.boolean(),
  isYes: z.boolean(),
  contracts: z.string(),
  newContracts: z.string(),
  maxBuyPriceUsd: z.string().nullable(),
  minSellPriceUsd: z.string().nullable(),
  externalOrderId: z.string().nullable(),
  orderCostUsd: z.string(),
  newAvgPriceUsd: z.string(),
  newSizeUsd: z.string(),
  newPayoutUsd: z.string(),
  estimatedProtocolFeeUsd: z.string(),
  estimatedVenueFeeUsd: z.string(),
  estimatedTotalFeeUsd: z.string(),
});

export const CreateOrderResponseSchema = z.object({
  transaction: z.string().nullable(),
  txMeta: z
    .object({
      blockhash: z.string(),
      lastValidBlockHeight: z.number().int().nonnegative(),
    })
    .nullable(),
  externalOrderId: z.string().nullable(),
  order: CreateOrderInnerOrderSchema,
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponseSchema>;

// CloseOrderResponse — note this is the *boundary-contract* response for both
// closePosition and claimPayout. The live API currently returns CreateOrderResponse
// for DELETE /positions and ClaimPositionResponse for POST /positions/.../claim;
// the Day-2 contract picked CloseOrderResponse because it carries the
// `accounts.{owner,authority,settlementMint}` block that drives `assertSafeTx`.
// Reconciliation between contract and live shape is a Day-N item (see "unbelief").
export const CloseOrderAccountsSchema = z.object({
  owner: z.string(),
  authority: z.string(),
  vault: z.string(),
  marketId: z.string(),
  position: z.string(),
  order: z.string(),
  orderAta: z.string(),
  ownerTokenAccount: z.string(),
  settlementMint: z.string(),
});
export type CloseOrderAccounts = z.infer<typeof CloseOrderAccountsSchema>;

export const CloseOrderResponseSchema = z.object({
  blockhash: z.string(),
  transaction: z.string(),
  latestBlockhash: z.string(),
  lastValidBlockHeight: z.number().int().nonnegative(),
  requiredSigners: z.array(z.string()),
  computeUnits: z.number().int().nonnegative(),
  orderPubkey: z.string(),
  accounts: CloseOrderAccountsSchema,
});
export type CloseOrderResponse = z.infer<typeof CloseOrderResponseSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────────────

export class JupApiError extends Error {
  readonly status: number | undefined;
  readonly endpoint: string;
  readonly body: unknown;
  constructor(opts: {
    message: string;
    endpoint: string;
    status?: number;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = "JupApiError";
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.body = opts.body;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Client
// ────────────────────────────────────────────────────────────────────────────

export interface JupPredictionClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface JupPredictionClient {
  getTradingStatus(): Promise<TradingStatus>;
  searchEvents(query: string, limit?: number): Promise<EventsSearchResponse>;
  listEvents(params?: ListEventsParams): Promise<EventsListResponse>;
  getMarket(marketId: string): Promise<MarketResponse>;
  getOrderbook(marketId: string): Promise<OrderbookResponse>;
  createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse>;
  closePosition(
    positionPubkey: string,
    ownerPubkey: string,
  ): Promise<CloseOrderResponse>;
  claimPayout(
    positionPubkey: string,
    ownerPubkey: string,
  ): Promise<CloseOrderResponse>;
}

export function createJupPredictionClient(
  opts: JupPredictionClientOptions,
): JupPredictionClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl: typeof fetch = opts.fetch ?? fetch;
  const apiKey = opts.apiKey;

  async function call<T>(
    endpoint: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = `${baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      accept: "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (init.body != null && headers["content-type"] == null) {
      headers["content-type"] = "application/json";
    }
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, headers });
    } catch (err) {
      throw new JupApiError({
        message: `network error: ${(err as Error).message}`,
        endpoint,
      });
    }
    let parsedBody: unknown = undefined;
    const text = await res.text();
    if (text.length > 0) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
      }
    }
    if (!res.ok) {
      throw new JupApiError({
        message: `HTTP ${res.status} on ${endpoint}`,
        endpoint,
        status: res.status,
        body: parsedBody,
      });
    }
    const result = schema.safeParse(parsedBody);
    if (!result.success) {
      throw new JupApiError({
        message: `schema validation failed on ${endpoint}: ${result.error.message}`,
        endpoint,
        status: res.status,
        body: parsedBody,
      });
    }
    return result.data;
  }

  return {
    getTradingStatus() {
      return call("/trading-status", { method: "GET" }, TradingStatusSchema);
    },
    searchEvents(query, limit) {
      const params = new URLSearchParams({ query });
      if (limit != null) params.set("limit", String(limit));
      return call(
        `/events/search?${params.toString()}`,
        { method: "GET" },
        EventsSearchResponseSchema,
      );
    },
    listEvents(params) {
      const qs = new URLSearchParams();
      if (params?.category) qs.set("category", params.category);
      if (params?.filter) qs.set("filter", params.filter);
      if (params?.start != null) qs.set("start", String(params.start));
      if (params?.end != null) qs.set("end", String(params.end));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return call(`/events${suffix}`, { method: "GET" }, EventsListResponseSchema);
    },
    getMarket(marketId) {
      return call(
        `/markets/${encodeURIComponent(marketId)}`,
        { method: "GET" },
        MarketResponseSchema,
      );
    },
    getOrderbook(marketId) {
      return call(
        `/orderbook/${encodeURIComponent(marketId)}`,
        { method: "GET" },
        OrderbookResponseSchema,
      );
    },
    createOrder(req) {
      const parsed = CreateOrderRequestSchema.parse(req);
      return call(
        "/orders",
        { method: "POST", body: JSON.stringify(parsed) },
        CreateOrderResponseSchema,
      );
    },
    closePosition(positionPubkey, ownerPubkey) {
      return call(
        `/positions/${encodeURIComponent(positionPubkey)}`,
        { method: "DELETE", body: JSON.stringify({ ownerPubkey }) },
        CloseOrderResponseSchema,
      );
    },
    claimPayout(positionPubkey, ownerPubkey) {
      return call(
        `/positions/${encodeURIComponent(positionPubkey)}/claim`,
        { method: "POST", body: JSON.stringify({ ownerPubkey }) },
        CloseOrderResponseSchema,
      );
    },
  };
}

// last-pruned: 2026-05-09 step6/dominion
