/**
 * signal.test.ts — falsifiable lights over signal.ts and SIGNAL_SCHEMA.md.
 *
 * Each `it` block is one belief that can fail loudly. Day-3 lost-sheep edges
 * (evm_tx null/empty, claim row shape) are first-class cases here.
 */

import { describe, it, expect } from "vitest";
import {
  parseSignalRow,
  dedupKey,
  verifySignature,
  SignalRowSchema,
  type SignalRow,
  type SignedSignalEnvelope,
} from "./signal.js";

const baseOpen: SignalRow = {
  v: 1,
  ts: "2026-05-09T10:19:42.653096+00:00",
  action: "open",
  slug: "val-drx1-ns1-2026-05-09-map-handicap-home-1pt5",
  side: "NO",
  token_id:
    "17287360576684029642838360321630673800172934081619572174340170173663099799150",
  price: 0.65,
  size_usd: 32.61,
  size_shares: 48.429274,
  evm_tx:
    "0x8e76aaf2587335d9dbe05d854b25788e1956e316808768d8f62ca821cd08a253",
  order_id:
    "0xb813dfeee5e18d27fd2e48e4a910ad4a7bd05db19aa7f5afb8b39442677377da",
  quality_bucket: "S70",
  paper: false,
};

const baseClose: SignalRow = {
  ...baseOpen,
  action: "close",
  ts: "2026-05-09T11:30:00.000000+00:00",
  evm_tx:
    "0xclose11111111111111111111111111111111111111111111111111111111111",
};

const baseClaim: SignalRow = {
  ...baseOpen,
  action: "claim",
  ts: "2026-05-09T13:00:00.000000+00:00",
  evm_tx:
    "0xclaim22222222222222222222222222222222222222222222222222222222222",
  // SIGNAL_SCHEMA.md: claim has redeem_tx_hash as evm_tx, price = redeem price.
  price: 1.0,
};

describe("parseSignalRow", () => {
  it("accepts a minimal valid open row", () => {
    const line = JSON.stringify(baseOpen);
    const out = parseSignalRow(line);
    expect(out.action).toBe("open");
    expect(out.evm_tx).toBe(baseOpen.evm_tx);
  });

  it("accepts a minimal valid close row", () => {
    const out = parseSignalRow(JSON.stringify(baseClose));
    expect(out.action).toBe("close");
  });

  it("accepts a minimal valid claim row", () => {
    const out = parseSignalRow(JSON.stringify(baseClaim));
    expect(out.action).toBe("claim");
  });

  it("rejects a row missing ts", () => {
    const { ts: _ts, ...noTs } = baseOpen;
    expect(() => parseSignalRow(JSON.stringify(noTs))).toThrow(
      /row failed schema/,
    );
  });

  it("rejects an unknown action like 'settle'", () => {
    const bad = { ...baseOpen, action: "settle" };
    expect(() => parseSignalRow(JSON.stringify(bad))).toThrow(
      /row failed schema/,
    );
  });
});

describe("dedupKey", () => {
  it("is stable: same row → same key on repeated calls", () => {
    const a = dedupKey(baseOpen);
    const b = dedupKey(baseOpen);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("is unique across two rows that share ts but differ in evm_tx", () => {
    const left = baseOpen;
    const right: SignalRow = {
      ...baseOpen,
      evm_tx:
        "0xdeadbeef00000000000000000000000000000000000000000000000000000000",
    };
    expect(dedupKey(left)).not.toBe(dedupKey(right));
  });

  it("returns a non-empty, non-colliding key when evm_tx is null (synthetic fallback)", () => {
    // Day-3 lost-sheep: unfilled/voided rows can lack evm_tx. Cast around the
    // schema since the contract still types evm_tx as string at the wire.
    const nullTx = { ...baseOpen, evm_tx: null } as unknown as SignalRow;
    const key = dedupKey(nullTx);
    expect(key.length).toBeGreaterThan(0);
    // Must NOT be the literal string "null" stuck on the end — that collides
    // across all unfilled rows for the same ts.
    expect(key.endsWith(":null")).toBe(false);
    expect(key).not.toBe(`${baseOpen.ts}:null`);

    // Two unfilled rows on same ts but different order_id/slug must not collide.
    const otherUnfilled = {
      ...baseOpen,
      evm_tx: null,
      order_id: "0xother",
      slug: "different-market-slug",
    } as unknown as SignalRow;
    expect(dedupKey(nullTx)).not.toBe(dedupKey(otherUnfilled));
  });
});

describe("verifySignature", () => {
  it("currently returns false (stub) — flipping this is a deliberate change", () => {
    const env: SignedSignalEnvelope = {
      row: baseOpen,
      sig: "AAAA",
      signer: "BBBB",
    };
    expect(verifySignature(env, "BBBB")).toBe(false);
  });
});

// Sanity: schema export is wired.
describe("SignalRowSchema", () => {
  it("parses the canonical example from SIGNAL_SCHEMA.md", () => {
    expect(SignalRowSchema.safeParse(baseOpen).success).toBe(true);
  });
});
