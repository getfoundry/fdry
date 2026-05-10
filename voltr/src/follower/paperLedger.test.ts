import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaperLedger, PaperTradeRowSchema } from "./paperLedger.js";

function tmpPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "paper-"));
  return join(dir, "paper-trades.ndjson");
}

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) {
    try {
      rmSync(p.replace(/paper-trades\.ndjson$/, ""), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
  }
});

const sampleRow = {
  v: 1 as const,
  ts: new Date().toISOString(),
  action: "open" as const,
  slug: "lol-tes-we-2026-05-09",
  side: "NO" as const,
  token_id: "tok1",
  price: 0.42,
  size_usd: 10,
  size_shares: 0,
  evm_tx: "0xabc",
  paper: false,
};

describe("PaperLedger", () => {
  it("appends one valid row to ~/.fdry/paper-trades.ndjson", async () => {
    const path = tmpPath();
    cleanups.push(path);
    const ledger = new PaperLedger({ path });
    await ledger.append({
      dedupKey: "dk-1",
      row: sampleRow,
      marketId: "POLY-2128359-0",
      jupBuyPriceUsd: 0.42,
      sizeFdry: 100,
      navFdry: 1_000_000,
      unsignedTxBase64: "AbCd",
    });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    const r = PaperTradeRowSchema.parse(parsed);
    expect(r.dedup_key).toBe("dk-1");
    expect(r.jup_market_id).toBe("POLY-2128359-0");
    expect(r.intended_size_fdry).toBe(100);
    expect(r.unsigned_tx_base64).toBe("AbCd");
  });

  it("two appends produce two lines (append-only)", async () => {
    const path = tmpPath();
    cleanups.push(path);
    const ledger = new PaperLedger({ path });
    await ledger.append({
      dedupKey: "dk-1",
      row: sampleRow,
      marketId: "M1",
      jupBuyPriceUsd: 0.4,
      sizeFdry: 100,
      navFdry: 1_000_000,
    });
    await ledger.append({
      dedupKey: "dk-2",
      row: sampleRow,
      marketId: "M2",
      jupBuyPriceUsd: 0.5,
      sizeFdry: 100,
      navFdry: 1_000_000,
    });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).jup_market_id).toBe("M1");
    expect(JSON.parse(lines[1]!).jup_market_id).toBe("M2");
  });

  it("omits unsigned_tx_base64 when not provided (cleaner row)", async () => {
    const path = tmpPath();
    cleanups.push(path);
    const ledger = new PaperLedger({ path });
    await ledger.append({
      dedupKey: "dk-1",
      row: sampleRow,
      marketId: "M1",
      jupBuyPriceUsd: 0.4,
      sizeFdry: 100,
      navFdry: 1_000_000,
    });
    const r = JSON.parse(readFileSync(path, "utf8").trim());
    expect(r.unsigned_tx_base64).toBeUndefined();
  });

  it("schema rejects out-of-range price (>1) before writing", async () => {
    const path = tmpPath();
    cleanups.push(path);
    const ledger = new PaperLedger({ path });
    await expect(
      ledger.append({
        dedupKey: "dk-1",
        row: { ...sampleRow, price: 1.5 },
        marketId: "M1",
        jupBuyPriceUsd: 0.4,
        sizeFdry: 100,
        navFdry: 1_000_000,
      }),
    ).rejects.toThrow();
  });
});
