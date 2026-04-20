#!/usr/bin/env tsx
import { Connection, PublicKey, AddressLookupTableAccount } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";

const HUMA_VAULT = "GrBFFvtdRL25o7gcRnV1kGvz1Qc7iscUmDp1ZvyBSyUa";
const HUMA_POOL = "AcHPQWtoQfJAQRcW6Mrv8gxkrH3o47F9n8hRjXxHM7Th";

async function main() {
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 25_000 });
  const v = await sdk.fetchVault(HUMA_VAULT);
  const f = (v as any).formatted;
  console.log("HUMA vault lut(s):", JSON.stringify(f.lookup_tables, null, 2));
  if (f.lookup_tables?.active?.length) {
    for (const lutPubkey of f.lookup_tables.active) {
      const resp = await conn.getAddressLookupTable(new PublicKey(lutPubkey));
      const addrs = resp.value?.state.addresses.map((a, i) => ({ i, addr: a.toBase58() })) || [];
      console.log(`\nLUT ${lutPubkey}:`);
      for (const a of addrs) {
        console.log(`  [${a.i}] ${a.addr}`);
      }
    }
  }
  console.log(`\npool pubkey is: ${HUMA_POOL}`);
  const poolInfo = await conn.getAccountInfo(new PublicKey(HUMA_POOL));
  if (poolInfo) {
    console.log(`pool owner: ${poolInfo.owner.toBase58()}`);
    // Raydium CPMM pool state layout: need to find vault A / vault B / observation
    // quick hack: parse known offsets from raydium-sdk-v2 CpmmPoolInfoLayout
  }
}
main().catch(e => { console.error(e); process.exit(1); });
