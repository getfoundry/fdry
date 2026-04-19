#!/usr/bin/env tsx
import { Connection } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";
async function main() {
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 50_000 });
  const v = await sdk.fetchVault(process.env.VAULT_PUBKEY!);
  console.log("name:     ", v.formatted?.name);
  console.log("supply:   ", v.formatted?.supply_outstanding);
  const comp = v.formatted?.composition || [];
  console.log("tokens:   ", comp.length);
  for (const a of comp) {
    console.log(`  - active=${a.active} mint=${a.mint.slice(0,10)}.. amount=${a.amount} weight=${a.weight}bp`);
  }
  const priced = await sdk.loadVaultPrice(v);
  console.log("TVL:      ", priced.tvl?.toString());
  console.log("NAV/share:", priced.price?.toString());
}
main().catch(e => { console.error("error:", e.message); process.exit(1); });
