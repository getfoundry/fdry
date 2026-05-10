import { Connection, PublicKey } from "@solana/web3.js";
const VOLTR = new PublicKey("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8");
const SPOT = new PublicKey("EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM");

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  console.log("scanning...");
  const accounts = await conn.getProgramAccounts(VOLTR);
  const spotHits: { vault: string; strategy: string; receipt: string }[] = [];
  for (const a of accounts) {
    const d = a.account.data;
    if (d.length < 104) continue;
    const adaptor = new PublicKey(d.subarray(72, 104));
    if (!adaptor.equals(SPOT)) continue;
    spotHits.push({
      vault: new PublicKey(d.subarray(8, 40)).toBase58(),
      strategy: new PublicKey(d.subarray(40, 72)).toBase58(),
      receipt: a.pubkey.toBase58(),
    });
  }
  console.log(`Total spot strategies on Voltr mainnet: ${spotHits.length}`);
  for (const h of spotHits.slice(0, 20)) {
    console.log(`  vault=${h.vault}  strategy=${h.strategy}  receipt=${h.receipt}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
