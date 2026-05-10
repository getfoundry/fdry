import { Connection, PublicKey } from "@solana/web3.js";

// Known spot strategy: wSOL on vault 7h3M9dGXketSTgvzNYvW8rS6F78K3GzK7imANbzd4EeH
const VOLTR = new PublicKey("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8");
const SPOT = new PublicKey("EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM");
const ORACLE_SEED = Buffer.from("oracle_init_receipt");
const VSA_SEED = Buffer.from("vault_strategy_auth");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const TARGETS = [
  { name: "wSOL", vault: "7h3M9dGXketSTgvzNYvW8rS6F78K3GzK7imANbzd4EeH", strategy: "So11111111111111111111111111111111111111112" },
  { name: "BONK", vault: "7h3M9dGXketSTgvzNYvW8rS6F78K3GzK7imANbzd4EeH", strategy: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { name: "cbBTC", vault: "7h3M9dGXketSTgvzNYvW8rS6F78K3GzK7imANbzd4EeH", strategy: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij" },
];

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  for (const t of TARGETS) {
    const vault = new PublicKey(t.vault);
    const strategy = new PublicKey(t.strategy);
    const [vsa] = PublicKey.findProgramAddressSync(
      [VSA_SEED, vault.toBuffer(), strategy.toBuffer()], VOLTR);
    const [foreignRcp] = PublicKey.findProgramAddressSync(
      [ORACLE_SEED, vsa.toBuffer(), strategy.toBuffer()], SPOT);
    const [assetRcp] = PublicKey.findProgramAddressSync(
      [ORACLE_SEED, vsa.toBuffer(), USDC.toBuffer()], SPOT);

    console.log(`\n=== ${t.name} (strategy=${t.strategy}) ===`);
    for (const [label, pda] of [["foreign", foreignRcp], ["asset/USDC", assetRcp]] as const) {
      const info = await conn.getAccountInfo(pda);
      if (!info) { console.log(`  ${label}: receipt ${pda.toBase58()} MISSING`); continue; }
      console.log(`  ${label} receipt=${pda.toBase58()}  data_len=${info.data.length}`);
      // Try different byte offsets for the oracle pubkey
      for (const off of [8, 40, 72, 104]) {
        if (info.data.length < off + 32) continue;
        const maybeOracle = new PublicKey(info.data.subarray(off, off + 32));
        const oInfo = await conn.getAccountInfo(maybeOracle);
        if (oInfo) {
          console.log(`    at offset ${off}: ${maybeOracle.toBase58()}  owner=${oInfo.owner.toBase58()}  datalen=${oInfo.data.length}`);
        }
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
