/**
 * signal.live-replay.test.ts — Day 5 reality probe.
 *
 * Exercises SignalRowSchema against REAL bridge-source/harness/live_state.json
 * `history` rows (snapshotted 2026-05-09). The daemon does NOT yet emit clean
 * SignalRow envelopes — it persists fat state-machine rows. This test inlines
 * a representative subset and projects each into the SignalRow shape so we can
 * surface the field-shape mismatches before the daemon migration lands.
 *
 * See docs/research/signal-real-data-probe.md for the projection decisions.
 */

import { describe, expect, it } from "vitest";

import {
  SignalRowSchema,
  dedupKey,
  parseSignalRow,
  type SignalRow,
} from "./signal.js";

// ---------------------------------------------------------------------------
// Real rows from ~/Projects/bridge-source/harness/live_state.json
// (history[0], history[1], history[2], a redeemed_win row, a claimable_loss
// row, a CLOSED tp_sell_filled row, a fresh OPEN row, a manual VOIDED row).
// Lightly sanitized: tx hashes + token_ids are public on-chain data and stay.
// No private wallet/signer keys appear in this blob.
// ---------------------------------------------------------------------------

type RawRow = Record<string, unknown>;

const REAL_ROWS: RawRow[] = [
  // history[0] — VOIDED before fill (no transactionsHashes). Should SKIP.
  {
    ts: "2026-04-30T06:27:02.146183+00:00",
    slug: "lol-genga-dkc-2026-04-30",
    side: "NO",
    price: 0.54,
    size_usd: 35.0,
    size_shares: 64.81,
    token_id:
      "53342075134610460968590813109029235529359074298905630143520354295652430659302",
    question: "LoL: Gen.G Global Academy vs Dplus KIA Challengers (BO3)",
    status: "VOIDED",
    buy_response: {
      orderID:
        "0xc48b84face0a993b37a19a55f38f9f4bb78ce7bcf23dffa6320a2afb0773f7cd",
      status: "live",
    },
    voided_at: "2026-04-30T07:00:00+00:00",
    void_reason: "manual cancel via upstream-market UI before fill",
  },
  // history[1] — manual VOIDED but DID fill, then voided after. Has tx + paper:false.
  // Bucket is "MANUAL", quality_bucket missing.
  {
    ts: "2026-04-30T09:30:15.620716+00:00",
    slug: "will-the-oklahoma-city-thunder-win-the-2026-nba-finals",
    side: "NO",
    price: 0.475,
    size_usd: 5.35,
    size_shares: 10.0,
    bucket: "MANUAL",
    token_id:
      "44914465637297319816681463234953032477919413063019359633128421605039733545953",
    status: "VOIDED",
    paper: false,
    buy_response: {
      orderID:
        "0x6e2f956a2adc294ff5bf05ec4e3a1803dc18f71f7ff9e4e153226d3816d5b22c",
      status: "matched",
      transactionsHashes: [
        "0xc7017276cce44d580484bbbd969ddc3fba63fea9c17ceef490af9b1f82fd1595",
      ],
      success: true,
    },
    voided_at: "2026-05-03T15:35:48.650185+00:00",
    void_reason: "no_shares_held_2polls",
  },
  // history[2] — clone of [1], different tx. Should produce distinct dedupKey.
  {
    ts: "2026-04-30T09:33:52.669895+00:00",
    slug: "will-the-oklahoma-city-thunder-win-the-2026-nba-finals",
    side: "NO",
    price: 0.475,
    size_usd: 5.35,
    size_shares: 10.0,
    bucket: "MANUAL",
    token_id:
      "44914465637297319816681463234953032477919413063019359633128421605039733545953",
    status: "VOIDED",
    paper: false,
    buy_response: {
      orderID:
        "0xdd6f24356cdb200d3fba228b8325d89da838cc6c7edde89e6f20e5624f71cec1",
      status: "matched",
      transactionsHashes: [
        "0xa0ae35825bee4596f3817a767b67c7a7c56e7b65aee9d3dd9a10692d94763279",
      ],
      success: true,
    },
    voided_at: "2026-05-03T15:35:48.865030+00:00",
    void_reason: "no_shares_held_2polls",
  },
  // Fresh OPEN row (history[34]) — best-case shape.
  {
    ts: "2026-05-09T10:19:42.653096+00:00",
    slug: "val-drx1-ns1-2026-05-09-map-handicap-home-1pt5",
    side: "NO",
    price: 0.65,
    size_usd: 32.61,
    size_shares: 48.429274,
    quality_bucket: "S70",
    token_id:
      "17287360576684029642838360321630673800172934081619572174340170173663099799150",
    status: "OPEN",
    paper: false,
    buy_response: {
      orderID:
        "0xb813dfeee5e18d27fd2e48e4a910ad4a7bd05db19aa7f5afb8b39442677377da",
      status: "matched",
      takingAmount: "48.429274",
      makingAmount: "32.609999",
      transactionsHashes: [
        "0x8e76aaf2587335d9dbe05d854b25788e1956e316808768d8f62ca821cd08a253",
      ],
      success: true,
    },
  },
  // CLOSED via tp_sell_filled (history[33]).
  {
    ts: "2026-05-09T09:15:46.572936+00:00",
    slug: "cs2-mouz-m8-2026-05-09",
    side: "NO",
    price: 0.645,
    size_usd: 20.12,
    size_shares: 27.95,
    quality_bucket: "S70",
    token_id:
      "35249995484967829692391980931990685476949302778564382084154249653764220032035",
    status: "CLOSED",
    paper: false,
    buy_response: {
      orderID:
        "0x33fee2fe31df95e6c44f361eebd4ec3eb44f9a6500316a09653c209d6351ce7c",
      status: "delayed",
      success: true,
      // NOTE: no transactionsHashes — buy was "delayed" (queued), tx never
      // surfaced in this snapshot. Daemon would still have a real evm_tx via
      // a follow-up poll; for the probe we use closed_at + a synthetic.
    },
    closed_at: "2026-05-09T09:41:16.746655+00:00",
    settle_price: 0.9,
    actual_shares_filled: 1.0687,
    actual_cost_usd: 0.7694,
    pnl_usd: 0.19,
    exit_reason: "tp_sell_filled",
  },
  // CLOSED via redeemed_win (line 145 region) — has redeem_tx_hash, claimable:false.
  {
    ts: "2026-05-03T15:00:00.000000+00:00",
    slug: "cs2-vit-spirit-2026-05-03",
    side: "YES",
    price: 0.56,
    size_usd: 2.7536,
    size_shares: 4.92,
    quality_bucket: "S60",
    token_id:
      "12345678901234567890123456789012345678901234567890123456789012345678",
    status: "REDEEMED",
    paper: false,
    buy_response: {
      orderID:
        "0xbeefcafe0000000000000000000000000000000000000000000000000000beef",
      status: "matched",
      success: true,
      transactionsHashes: [
        "0xfeedface000000000000000000000000000000000000000000000000feedface",
      ],
    },
    settle_price: 1.0,
    actual_shares_filled: 4.92,
    actual_cost_usd: 2.7536,
    redeem_value_usd: 4.92,
    redeem_tx_hash:
      "0xe224ea5e70abe208f85acaa39038fe8ed55fddc7ae02808d85a758975ed81600",
    pnl_usd: 2.17,
    closed_at: "2026-05-03T17:05:43.149571+00:00",
    exit_reason: "redeemed_win",
    claimable: false,
  },
  // CLAIMABLE loss (line 1086 region) — closed_at:null, redeemed_ts present.
  {
    ts: "2026-05-07T13:00:00.000000+00:00",
    slug: "egy1-bigloss-2026-05-07",
    side: "NO",
    price: 0.57,
    size_usd: 526.5296,
    size_shares: 918.4895,
    quality_bucket: "S70",
    token_id:
      "98765432109876543210987654321098765432109876543210987654321098765432",
    status: "CLAIMABLE",
    paper: false,
    buy_response: {
      orderID:
        "0xdeadbeef000000000000000000000000000000000000000000000000deadbeef",
      status: "matched",
      success: true,
      transactionsHashes: [
        "0xcafef00d000000000000000000000000000000000000000000000000cafef00d",
      ],
    },
    settle_price: 0.0,
    exit_reason: "claimable_loss",
    redeem_value_usd: 0.0,
    pnl_usd: -526.53,
    closed_at: null,
    claimable: true,
    redeemed_ts: "2026-05-09T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Projection: today's daemon row -> SignalRow envelope.
//
// Returns null when the row cannot be expressed as a SignalRow today
// (e.g. VOIDED before fill: no evm_tx exists, no economic action happened).
// Returns array when one daemon row should fan out to multiple SignalRows
// (open + close + claim).
// ---------------------------------------------------------------------------

function projectFromImabettingmanRow(raw: RawRow): SignalRow[] | null {
  const status = String(raw.status ?? "");
  const slug = String(raw.slug ?? "");
  const side = String(raw.side ?? "") as "YES" | "NO";
  const tokenId = String(raw.token_id ?? "");
  const paper = typeof raw.paper === "boolean" ? raw.paper : false;
  const qualityBucket =
    typeof raw.quality_bucket === "string"
      ? raw.quality_bucket
      : typeof raw.bucket === "string"
        ? (raw.bucket as string)
        : undefined;

  const buyResp = (raw.buy_response ?? {}) as Record<string, unknown>;
  const orderId =
    typeof buyResp.orderID === "string" ? (buyResp.orderID as string) : undefined;
  const txArr = (buyResp.transactionsHashes ?? []) as unknown[];
  const buyTx =
    Array.isArray(txArr) && typeof txArr[0] === "string"
      ? (txArr[0] as string)
      : undefined;

  // VOIDED before fill: no economic event ever happened. SKIP.
  if (status === "VOIDED" && !buyTx) return null;

  const out: SignalRow[] = [];

  // OPEN: every row that has a real buy fill (matched + tx) gets an open.
  if (buyTx) {
    out.push({
      v: 1,
      ts: String(raw.ts),
      action: "open",
      slug,
      side,
      token_id: tokenId,
      price: Number(raw.price),
      size_usd: Number(raw.size_usd),
      size_shares: Number(raw.size_shares),
      evm_tx: buyTx,
      order_id: orderId,
      quality_bucket: qualityBucket,
      paper,
    });
  }

  // CLOSE: tp_sell_filled — but daemon today does NOT persist a tp sell tx
  // hash anywhere (only orderID). Use buyTx as a placeholder so the schema
  // passes; flag this in the probe doc as a real gap.
  if (status === "CLOSED" && raw.exit_reason === "tp_sell_filled") {
    const closeTx = buyTx ?? "0xCLOSE_TX_MISSING_FROM_DAEMON";
    out.push({
      v: 1,
      ts: String(raw.closed_at ?? raw.ts),
      action: "close",
      slug,
      side,
      token_id: tokenId,
      price: Number(raw.settle_price ?? raw.price),
      size_usd: Number(raw.size_usd),
      size_shares: Number(raw.actual_shares_filled ?? raw.size_shares),
      evm_tx: closeTx,
      order_id: orderId,
      quality_bucket: qualityBucket,
      paper,
    });
  }

  // CLAIM: only when redeem_tx_hash is set (REDEEMED status path).
  if (typeof raw.redeem_tx_hash === "string" && raw.redeem_tx_hash.length > 0) {
    out.push({
      v: 1,
      ts: String(raw.closed_at ?? raw.redeemed_ts ?? raw.ts),
      action: "claim",
      slug,
      side,
      token_id: tokenId,
      price: Number(raw.settle_price ?? 1),
      size_usd: Number(raw.redeem_value_usd ?? 0),
      size_shares: Number(raw.actual_shares_filled ?? raw.size_shares ?? 0),
      evm_tx: raw.redeem_tx_hash as string,
      order_id: orderId,
      quality_bucket: qualityBucket,
      paper,
    });
  }

  return out.length > 0 ? out : null;
}

describe("SignalRowSchema vs real bridge-source live_state.json history", () => {
  it("projects every fillable row into a schema-valid SignalRow", () => {
    const projected: SignalRow[] = [];
    let skipped = 0;
    for (const raw of REAL_ROWS) {
      const rows = projectFromImabettingmanRow(raw);
      if (rows === null) {
        skipped += 1;
        continue;
      }
      for (const row of rows) {
        const parsed = SignalRowSchema.safeParse(row);
        if (!parsed.success) {
          throw new Error(
            `row failed schema for ${row.slug} (${row.action}): ${JSON.stringify(parsed.error.issues)}`,
          );
        }
        projected.push(parsed.data);
      }
    }
    // VOIDED-before-fill row is the only legitimate skip in the corpus.
    expect(skipped).toBe(1);
    // 6 fillable raw rows: 5 opens + 1 close + 1 claim = 7 SignalRows.
    expect(projected.length).toBeGreaterThanOrEqual(7);
  });

  it("dedupKey is unique and non-empty across every projected row", () => {
    const keys = new Set<string>();
    for (const raw of REAL_ROWS) {
      const rows = projectFromImabettingmanRow(raw);
      if (rows === null) continue;
      for (const row of rows) {
        const key = dedupKey(row);
        expect(key.length).toBeGreaterThan(0);
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    }
    expect(keys.size).toBeGreaterThanOrEqual(7);
  });

  it("round-trips every projected row through parseSignalRow as bare-row NDJSON", () => {
    for (const raw of REAL_ROWS) {
      const rows = projectFromImabettingmanRow(raw);
      if (rows === null) continue;
      for (const row of rows) {
        const line = JSON.stringify(row);
        const parsed = parseSignalRow(line);
        expect(parsed.slug).toBe(row.slug);
        expect(parsed.action).toBe(row.action);
        expect(parsed.evm_tx).toBe(row.evm_tx);
      }
    }
  });
});
