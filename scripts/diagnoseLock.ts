#!/usr/bin/env tsx
import { Connection } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";

async function main() {
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 25_000 });
  const v: any = await sdk.fetchVault(process.env.VAULT_PUBKEY!);
  const f = v.formatted;

  console.log(`=== ${f.name} (${f.pubkey}) ===\n`);
  console.log("schedule_settings:", JSON.stringify(f.schedule_settings, null, 2));
  console.log("\ndeposits_settings:", JSON.stringify(f.deposits_settings, null, 2));
  console.log("\nautomation_settings:", JSON.stringify(f.automation_settings, null, 2));
  console.log("\nforce_rebalance_settings:", JSON.stringify(f.force_rebalance_settings, null, 2));
  console.log("\ncustom_rebalance_settings:", JSON.stringify(f.custom_rebalance_settings, null, 2));
  console.log("\nlp_settings:", JSON.stringify(f.lp_settings, null, 2));
  console.log("\nactive flags:", { active_rebalance: f.active_rebalance, active_withdraws: f.active_withdraws, active_managements: f.active_managements });
  console.log(`\ncomposition count: ${f.composition?.length ?? 0}`);
  console.log(`total_weight_bps: ${(f.composition || []).reduce((s:number,t:any)=>s+(t.weight||0),0)}`);

  const now = Math.floor(Date.now() / 1000);
  console.log(`\nnow: ${now}`);
  const ss = f.schedule_settings || {};
  if (ss.cycle_start_time && ss.cycle_duration) {
    const since = now - ss.cycle_start_time;
    const mod = ss.cycle_duration ? since % ss.cycle_duration : null;
    console.log(`cycle_mod: ${mod}s  deposits_window: [${ss.deposits_start}, ${ss.deposits_end}]  in_window: ${mod != null && mod >= ss.deposits_start && mod < ss.deposits_end}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
