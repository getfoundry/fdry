/**
 * Falsifiable lights for jupPredictionClient.
 *
 * Each `it` is a tripwire — when the live API drifts or the client regresses,
 * exactly one of these flips red and tells us which boundary lied.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createJupPredictionClient,
  JupApiError,
  JUPUSD_MINT,
} from "./jupPredictionClient.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchArgs = Parameters<typeof fetch>;

type FetchFn = (...args: FetchArgs) => Promise<Response>;
type FetchMock = ReturnType<typeof vi.fn<FetchFn>>;

function makeFetchMock(impl: FetchFn): FetchMock {
  return vi.fn<FetchFn>(impl);
}

const VALID_TRADING_STATUS = { trading_active: true };

const VALID_MARKET = {
  marketId: "mkt_abc",
  status: "open" as const,
  result: null,
  openTime: 1_700_000_000,
  closeTime: 1_700_100_000,
  resolveAt: null,
  pricing: {
    buyYesPriceUsd: 0.42,
    buyNoPriceUsd: 0.58,
    sellYesPriceUsd: 0.41,
    sellNoPriceUsd: 0.57,
    volume: 12345,
  },
};
void VALID_MARKET;

const VALID_CREATE_ORDER_RESPONSE = {
  transaction: "base64tx",
  txMeta: { blockhash: "bh", lastValidBlockHeight: 12345 },
  externalOrderId: null,
  order: {
    orderPubkey: null,
    orderAtaPubkey: null,
    userPubkey: "owner",
    marketId: "mkt_abc",
    marketIdHash: "h",
    positionPubkey: "pos_pk_long_enough_to_satisfy_the_min_32_chars",
    isBuy: true,
    isYes: true,
    contracts: "10",
    newContracts: "10",
    maxBuyPriceUsd: null,
    minSellPriceUsd: null,
    externalOrderId: null,
    orderCostUsd: "4.20",
    newAvgPriceUsd: "0.42",
    newSizeUsd: "4.20",
    newPayoutUsd: "10.00",
    estimatedProtocolFeeUsd: "0",
    estimatedVenueFeeUsd: "0",
    estimatedTotalFeeUsd: "0",
  },
};

describe("createJupPredictionClient", () => {
  it("sends x-api-key header on a GET (getTradingStatus)", async () => {
    const fetchMock = makeFetchMock(async () =>
      jsonResponse(VALID_TRADING_STATUS),
    );
    const client = createJupPredictionClient({
      apiKey: "secret-key",
      fetch: fetchMock,
    });
    await client.getTradingStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/trading-status$/);
    expect(init!.method).toBe("GET");
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("secret-key");
  });

  it("sends Content-Type application/json on POST createOrder", async () => {
    const fetchMock = makeFetchMock(async () =>
      jsonResponse(VALID_CREATE_ORDER_RESPONSE),
    );
    const client = createJupPredictionClient({
      apiKey: "k",
      fetch: fetchMock,
    });
    await client.createOrder({ isBuy: true, marketId: "mkt_abc" });
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    // call() lowercases the header key when defaulting it.
    expect(headers["content-type"]).toBe("application/json");
    expect(init!.method).toBe("POST");
  });

  it("throws JupApiError with status 403 on geo-block", async () => {
    const fetchMock = makeFetchMock(
      async () =>
        new Response("forbidden", {
          status: 403,
          headers: { "content-type": "text/plain" },
        }),
    );
    const client = createJupPredictionClient({
      apiKey: "k",
      fetch: fetchMock,
    });
    await expect(client.getTradingStatus()).rejects.toMatchObject({
      name: "JupApiError",
      status: 403,
    });
    await expect(client.getTradingStatus()).rejects.toBeInstanceOf(JupApiError);
  });

  it("throws JupApiError with status 500 on server error", async () => {
    const fetchMock = makeFetchMock(async () =>
      jsonResponse({ error: "boom" }, 500),
    );
    const client = createJupPredictionClient({
      apiKey: "k",
      fetch: fetchMock,
    });
    await expect(client.getMarket("mkt_abc")).rejects.toMatchObject({
      name: "JupApiError",
      status: 500,
    });
  });

  it("throws JupApiError on schema mismatch (unexpected JSON shape)", async () => {
    const fetchMock = makeFetchMock(async () => jsonResponse({ foo: "bar" }));
    const client = createJupPredictionClient({
      apiKey: "k",
      fetch: fetchMock,
    });
    await expect(client.getMarket("mkt_abc")).rejects.toBeInstanceOf(
      JupApiError,
    );
    await expect(client.getMarket("mkt_abc")).rejects.toMatchObject({
      message: expect.stringContaining("schema validation failed"),
    });
  });

  it("getTradingStatus returns {trading_active:true} on canonical shape", async () => {
    const fetchMock = makeFetchMock(async () =>
      jsonResponse(VALID_TRADING_STATUS),
    );
    const client = createJupPredictionClient({
      apiKey: "k",
      fetch: fetchMock,
    });
    const out = await client.getTradingStatus();
    expect(out).toEqual({ trading_active: true });
  });
});

describe("module exports", () => {
  it("JUPUSD_MINT equals the canonical Jupiter USD mint", () => {
    expect(JUPUSD_MINT).toBe("JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD");
  });
});

describe("lost-sheep: closePosition vs OpenAPI v1 spec drift", () => {
  /**
   * Day-3 unbelief #4: the live OpenAPI spec for DELETE /positions/{pubkey}
   * documents a CreateOrderResponse-shaped body (transaction + txMeta + order),
   * NOT the CloseOrderResponse shape (with the rich `accounts` block) that the
   * client validates against. So when the live API returns the documented
   * shape, our zod validator should reject it as a schema mismatch.
   *
   * This test pins the CURRENT behavior — it passes by ASSERTING the throw.
   * The first live mainnet call is expected to confirm this drift; when it
   * does, we update CloseOrderResponseSchema (or split the two endpoints) and
   * THIS test flips. That is the falsifiable proof.
   */
  it("rejects the OpenAPI-documented CreateOrderResponse shape with JupApiError", async () => {
    const fetchMock = makeFetchMock(async () =>
      jsonResponse(VALID_CREATE_ORDER_RESPONSE),
    );
    const client = createJupPredictionClient({
      apiKey: "k",
      fetch: fetchMock,
    });
    await expect(
      client.closePosition(
        "pos_pk_long_enough_to_satisfy_the_min_32_chars",
        "owner",
      ),
    ).rejects.toBeInstanceOf(JupApiError);
    await expect(
      client.closePosition(
        "pos_pk_long_enough_to_satisfy_the_min_32_chars",
        "owner",
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("schema validation failed"),
    });
  });
});
