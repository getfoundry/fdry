/**
 * predictionMap tripwires — each `it` flips red on a specific failure mode of
 * the mapping heuristic so we know which lever to tune.
 */

import { describe, expect, it } from "vitest";
import {
  mapSignalToMarket,
  tokenSimilarity,
  type MapResult,
} from "./predictionMap.js";
import {
  JupApiError,
  type EventsSearchResponse,
  type JupPredictionClient,
  type MarketResponse,
  type OrderbookResponse,
} from "./jupPredictionClient.js";
import type { SignalRow } from "./signal.js";

const FAR_FUTURE = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
const PAST = Math.floor(Date.now() / 1000) - 60 * 60;

function makeRow(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    v: 1,
    ts: "2026-05-09T12:00:00.000Z",
    action: "open",
    slug: "los-angeles-lakers-vs-celtics",
    side: "NO",
    token_id: "tok_1",
    price: 0.42,
    size_usd: 100,
    size_shares: 250,
    evm_tx: "0xdeadbeef",
    paper: false,
    ...overrides,
  };
}

type StubResponses = {
  search?: EventsSearchResponse | (() => Promise<EventsSearchResponse>);
  market?: MarketResponse | (() => Promise<MarketResponse>);
  orderbook?: OrderbookResponse | (() => Promise<OrderbookResponse>);
};

function makeStub(r: StubResponses): JupPredictionClient {
  const stub = {
    async getTradingStatus() {
      return { trading_active: true };
    },
    async searchEvents(_q: string, _l?: number) {
      const v = r.search;
      if (typeof v === "function") return v();
      if (!v) throw new Error("stub: searchEvents not configured");
      return v;
    },
    async getMarket(_id: string) {
      const v = r.market;
      if (typeof v === "function") return v();
      if (!v) throw new Error("stub: getMarket not configured");
      return v;
    },
    async getOrderbook(_id: string) {
      const v = r.orderbook;
      if (typeof v === "function") return v();
      if (v === undefined) throw new Error("stub: getOrderbook not configured");
      return v;
    },
    async createOrder() {
      throw new Error("not used");
    },
    async closePosition() {
      throw new Error("not used");
    },
    async claimPayout() {
      throw new Error("not used");
    },
  };
  return stub as unknown as JupPredictionClient;
}

function searchWithMarket(
  marketId: string,
  title: string,
  closeTime: number = FAR_FUTURE,
): EventsSearchResponse {
  return {
    data: [
      {
        eventId: "evt_1",
        isActive: true,
        isLive: true,
        category: "sports",
        subcategory: "nba",
        volumeUsd: "1000",
        closeCondition: "spec",
        beginAt: null,
        rulesPdf: "",
        // extras (not in zod EventSchema, present on live API):
        markets: [{ marketId, title, closeTime }],
      } as unknown as EventsSearchResponse["data"][number],
    ],
  };
}

function market(
  overrides: Partial<MarketResponse> & {
    pricing?: MarketResponse["pricing"];
  } = {},
): MarketResponse {
  return {
    marketId: "mkt_lakers_celtics",
    status: "open",
    result: null,
    openTime: 1_700_000_000,
    closeTime: FAR_FUTURE,
    resolveAt: null,
    pricing: {
      buyYesPriceUsd: 580_000,
      buyNoPriceUsd: 430_000,
      sellYesPriceUsd: 560_000,
      sellNoPriceUsd: 410_000,
    },
    ...overrides,
  };
}

function orderbook(
  noLevels: Array<[number, number]>,
  yesLevels: Array<[number, number]> = [],
): OrderbookResponse {
  return {
    yes: yesLevels,
    no: noLevels,
    yes_dollars: [],
    no_dollars: [],
  };
}

describe("tokenSimilarity", () => {
  it("matches lakers vs celtics across slug and title forms", () => {
    const s = tokenSimilarity(
      "los-angeles-lakers-vs-celtics",
      "Lakers vs Celtics",
    );
    expect(s).toBeGreaterThan(0.4);
  });

  it("returns 0 for fully disjoint inputs", () => {
    expect(tokenSimilarity("foo", "bar")).toBe(0);
  });

  it("returns 1 for identical token sets ignoring punctuation/case", () => {
    expect(tokenSimilarity("foo-bar BAZ", "baz, foo? bar")).toBe(1);
  });
});

describe("mapSignalToMarket", () => {
  it("happy path returns ok with expected marketId, isYes, prices, liquidity", async () => {
    const client = makeStub({
      search: searchWithMarket("mkt_lakers_celtics", "Lakers vs Celtics"),
      market: market(),
      orderbook: orderbook([
        [0.43, 200],
        [0.42, 200],
        [0.41, 200],
      ]),
    });
    const res = await mapSignalToMarket(makeRow(), client);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.marketId).toBe("mkt_lakers_celtics");
    expect(res.isYes).toBe(false);
    expect(res.jupBuyPriceUsd).toBeCloseTo(0.43, 5);
    expect(res.sellSidePriceUsd).toBeCloseTo(0.41, 5);
    expect(res.liquidityUsd).toBeCloseTo(0.43 * 200 + 0.42 * 200 + 0.41 * 200);
    expect(res.titleSimilarity).toBeGreaterThan(0.4);
  });

  it("YES side picks buyYes pricing", async () => {
    const client = makeStub({
      search: searchWithMarket("mkt_lakers_celtics", "Lakers vs Celtics"),
      market: market(),
      orderbook: orderbook(
        [],
        [
          [0.58, 200],
          [0.57, 200],
          [0.56, 200],
        ],
      ),
    });
    const res = await mapSignalToMarket(makeRow({ side: "YES", price: 0.58 }), client);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.isYes).toBe(true);
    expect(res.jupBuyPriceUsd).toBeCloseTo(0.58, 5);
  });

  it("returns no_match when search returns no markets", async () => {
    const client = makeStub({
      search: { data: [] },
    });
    const res = await mapSignalToMarket(makeRow(), client);
    expect(res).toEqual<MapResult>({ ok: false, reason: "no_match" });
  });

  it("returns low_similarity when titles share no tokens with slug", async () => {
    const client = makeStub({
      search: searchWithMarket("mkt_x", "Bitcoin above 100k by Friday"),
    });
    const res = await mapSignalToMarket(makeRow(), client);
    expect(res).toEqual<MapResult>({ ok: false, reason: "low_similarity" });
  });

  it("returns price_delta_too_wide when jup buy diverges >5c from row.price", async () => {
    const client = makeStub({
      search: searchWithMarket("mkt_lakers_celtics", "Lakers vs Celtics"),
      market: market({
        pricing: {
          buyYesPriceUsd: 580_000,
          buyNoPriceUsd: 600_000, // $0.60 vs row 0.42 → delta 0.18
          sellYesPriceUsd: 560_000,
          sellNoPriceUsd: 580_000,
        },
      }),
      orderbook: orderbook([[0.6, 1_000_000]]),
    });
    const res = await mapSignalToMarket(makeRow(), client);
    expect(res).toEqual<MapResult>({
      ok: false,
      reason: "price_delta_too_wide",
    });
  });

  it("returns liquidity_too_thin when top-3 sum < 10x trade size", async () => {
    const client = makeStub({
      search: searchWithMarket("mkt_lakers_celtics", "Lakers vs Celtics"),
      market: market(),
      orderbook: orderbook([
        [0.43, 10],
        [0.42, 10],
        [0.41, 10],
      ]), // ~$12.6 < $100
    });
    const res = await mapSignalToMarket(makeRow(), client);
    expect(res).toEqual<MapResult>({
      ok: false,
      reason: "liquidity_too_thin",
    });
  });

  it("returns closeTime_passed when market is already closed", async () => {
    const client = makeStub({
      search: searchWithMarket("mkt_lakers_celtics", "Lakers vs Celtics", PAST),
    });
    const res = await mapSignalToMarket(makeRow(), client);
    expect(res).toEqual<MapResult>({ ok: false, reason: "closeTime_passed" });
  });

  it("wraps JupApiError into {ok:false, reason:'jup_api_error'}", async () => {
    const client = makeStub({
      search: () => {
        throw new JupApiError({
          message: "boom",
          endpoint: "/events/search",
          status: 500,
        });
      },
    });
    const res = await mapSignalToMarket(makeRow(), client);
    expect(res).toEqual<MapResult>({ ok: false, reason: "jup_api_error" });
  });

  it("re-throws non-JupApiError exceptions", async () => {
    const client = makeStub({
      search: () => {
        throw new Error("network died");
      },
    });
    await expect(mapSignalToMarket(makeRow(), client)).rejects.toThrow(
      /network died/,
    );
  });
});
