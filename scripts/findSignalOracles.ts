/**
 * findSignalOracles.ts — locate sponsored Pyth Pull Oracle v2 price accounts
 * on Solana mainnet for the 6 tokens the FDRY scalp signal trades:
 *   SOL, WIF, BONK, POPCAT, FLOKI, JTO
 *
 * Strategy:
 *   1. Look up Pyth feed IDs via Hermes REST (https://hermes.pyth.network/v2/price_feeds).
 *   2. Derive the shard-0 sponsored price account PDA under the Pyth receiver
 *      program rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ.
 *   3. Probe each derived account via getAccountInfo. Print which exist.
 *
 * Run:
 *   RPC_URL=https://api.mainnet-beta.solana.com npx tsx scripts/findSignalOracles.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";

const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const HERMES_BASE = "https://hermes.pyth.network";

const TOKENS = ["Solana", "dogwifhat", "Bonk", "Popcat", "FLOKI", "Jito"];
const SYMBOLS = ["SOL/USD", "WIF/USD", "BONK/USD", "POPCAT/USD", "FLOKI/USD", "JTO/USD"];

interface HermesFeed {
  id: string;
  attributes: { asset_type?: string; base?: string; quote_currency?: string; symbol?: string; display_symbol?: string };
}

function derivePriceAccountPda(shard: number, feedIdHex: string): PublicKey {
  const shardBytes = Buffer.alloc(2);
  shardBytes.writeUInt16LE(shard, 0);
  const feedIdBytes = Buffer.from(feedIdHex.replace(/^0x/, ""), "hex");
  if (feedIdBytes.length !== 32) throw new Error(`feed id must be 32 bytes, got ${feedIdBytes.length}`);
  const [pda] = PublicKey.findProgramAddressSync([shardBytes, feedIdBytes], PYTH_RECEIVER);
  return pda;
}

async function fetchFeedId(symbol: string): Promise<string | null> {
  const url = `${HERMES_BASE}/v2/price_feeds?query=${encodeURIComponent(symbol)}&asset_type=crypto`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  hermes ${symbol}: HTTP ${res.status}`);
    return null;
  }
  const feeds = (await res.json()) as HermesFeed[];
  // Prefer exact match on display_symbol === symbol
  const exact = feeds.find((f) => f.attributes?.display_symbol === symbol);
  const fallback = feeds[0];
  const pick = exact ?? fallback;
  if (!pick) return null;
  return pick.id.replace(/^0x/, "");
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  console.log(`Pyth receiver: ${PYTH_RECEIVER.toBase58()}`);
  console.log(`RPC: ${rpcUrl}\n`);

  const results: Array<{
    symbol: string;
    feedId: string | null;
    priceAccount: string | null;
    exists: boolean;
  }> = [];

  for (const symbol of SYMBOLS) {
    console.log(`→ ${symbol}`);
    const feedId = await fetchFeedId(symbol);
    if (!feedId) {
      console.log(`  no Hermes feed found for "${symbol}"`);
      results.push({ symbol, feedId: null, priceAccount: null, exists: false });
      continue;
    }
    console.log(`  feed id: 0x${feedId}`);

    // Try shards 0-4 (most sponsored accounts are shard 0; some are higher)
    let found: string | null = null;
    for (let shard = 0; shard <= 4; shard++) {
      const pda = derivePriceAccountPda(shard, feedId);
      const info = await conn.getAccountInfo(pda);
      if (info) {
        console.log(`  shard ${shard} → ${pda.toBase58()}  (exists, owner=${info.owner.toBase58()}, ${info.data.length}B)`);
        found = pda.toBase58();
        break;
      } else {
        console.log(`  shard ${shard} → ${pda.toBase58()}  (does not exist)`);
      }
    }
    results.push({ symbol, feedId, priceAccount: found, exists: !!found });
  }

  console.log("\n── summary ──");
  for (const r of results) {
    const status = r.exists ? "✅" : "❌";
    console.log(`${status} ${r.symbol.padEnd(12)}  ${r.priceAccount ?? "— no sponsored account found —"}`);
  }

  console.log("\n── strategies.json snippet (fill these into jupiterConfig.foreignOracle) ──");
  for (const r of results) {
    if (r.priceAccount) {
      console.log(`  "${r.symbol.split("/")[0]}": "${r.priceAccount}",`);
    } else {
      console.log(`  "${r.symbol.split("/")[0]}": "<MISSING — no sponsored Pyth account on mainnet>",`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
