#!/usr/bin/env tsx
/**
 * findRaydiumCpmmVault.ts — scan Symmetry mainnet vaults and print ones that
 * use a raydium_cpmm oracle so we can copy their working config.
 */
import { Connection } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";

async function main() {
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 25_000 });

  console.log("fetching all Symmetry vaults…");
  const vaults = await sdk.fetchAllVaults();
  console.log(`got ${vaults.length} vaults\n`);

  const oracleTypeCounts: Record<string, number> = {};
  let cpmmHits = 0;
  let clmmHits = 0;
  for (const v of vaults) {
    const f = (v as any).formatted || v;
    const tokens = f.assets || f.tokens || [];
    for (const t of tokens) {
      const oracles = t.oracle_aggregator?.oracles ?? t.oracleAggregator?.oracles ?? t.oracles ?? [];
      for (const o of oracles) {
        const ot = (o.oracle_type || o.oracleType || o.oracle_settings?.oracle_type || o.oracleSettings?.oracleType || "").toString();
        oracleTypeCounts[ot] = (oracleTypeCounts[ot] || 0) + 1;
        if (ot.toString().toLowerCase().includes("cpmm") || ot === "2") {
          cpmmHits++;
          console.log(`=== CPMM HIT in vault ${f.pubkey || f.vault_pubkey || "?"} ===`);
          console.log(`  name:        ${f.name}`);
          console.log(`  token mint:  ${t.token_mint || t.mint || t.symbol}`);
          console.log(`  oracle:      ${JSON.stringify(o, null, 2).slice(0, 1500)}`);
          console.log("");
        } else if (ot.toString().toLowerCase().includes("clmm") || ot === "1") {
          clmmHits++;
        }
      }
    }
  }
  console.log(`\noracle_type distribution across ${vaults.length} vaults:`);
  for (const [k, c] of Object.entries(oracleTypeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.toString().padStart(4)}  ${k || "(empty)"}`);
  }
  console.log(`\nsummary: ${cpmmHits} raydium_cpmm, ${clmmHits} raydium_clmm`);
}

main().catch((e) => { console.error(e); process.exit(1); });
main().catch((e) => { console.error(e); process.exit(1); });
