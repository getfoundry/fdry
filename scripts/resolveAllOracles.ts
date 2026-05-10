/**
 * resolveAllOracles.ts — decode every Voltr-tracked Pyth Pull v2 oracle and
 * map feed_id → symbol via Hermes. Prints the full ship-ready universe.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const SPOT = new PublicKey("EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM");
const PYTH_V2 = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const HERMES = "https://hermes.pyth.network";

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  const receipts = await conn.getProgramAccounts(SPOT, { filters: [{ dataSize: 44 }] });
  const oracles = new Set<string>();
  for (const r of receipts) {
    if (r.account.data.length < 40) continue;
    oracles.add(new PublicKey(r.account.data.subarray(8, 40)).toBase58());
  }
  console.log(`unique Voltr-tracked oracles: ${oracles.size}\n`);

  // Resolve feed IDs and fetch symbols from Hermes
  const resolved: Array<{ oracle: string; feedId: string; symbol: string; base?: string }> = [];
  for (const pk of oracles) {
    const info = await conn.getAccountInfo(new PublicKey(pk));
    if (!info || !info.owner.equals(PYTH_V2)) continue;
    const feedId = info.data.subarray(41, 41 + 32).toString("hex");

    // Hermes /v2/price_feeds/{id} — returns feed metadata
    const url = `${HERMES}/v2/price_feeds?ids[]=0x${feedId}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        resolved.push({ oracle: pk, feedId, symbol: `<hermes ${res.status}>` });
        continue;
      }
      const data = await res.json() as Array<{ id: string; attributes: Record<string, string> }>;
      if (!data.length) {
        resolved.push({ oracle: pk, feedId, symbol: "<not in hermes>" });
        continue;
      }
      const a = data[0].attributes;
      resolved.push({
        oracle: pk,
        feedId,
        symbol: a.display_symbol ?? a.symbol ?? `${a.base}/${a.quote_currency}`,
        base: a.base,
      });
    } catch (e) {
      resolved.push({ oracle: pk, feedId, symbol: `<err ${e}>` });
    }
  }

  resolved.sort((a, b) => a.symbol.localeCompare(b.symbol));
  console.log(`${"symbol".padEnd(16)}  ${"base".padEnd(10)}  oracle`);
  for (const r of resolved) {
    console.log(`${r.symbol.padEnd(16)}  ${(r.base ?? "").padEnd(10)}  ${r.oracle}`);
  }

  // Emit strategies.example.json-ready JSON
  console.log("\n── strategies.json foreignOracle map ──");
  const map: Record<string, string> = {};
  for (const r of resolved) {
    const key = r.base ?? r.symbol.split("/")[0];
    if (!key.startsWith("<")) map[key] = r.oracle;
  }
  console.log(JSON.stringify(map, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
