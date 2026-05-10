/**
 * scanAllOracles.ts — decode ALL existing Voltr jupiter-spot strategies on mainnet
 * and extract their foreign-oracle pubkey via the oracle_init_receipt PDA.
 *
 * Matches the strategy pubkey (= foreign mint for spot) against a watchlist of
 * tokens we want oracles for: WIF, POPCAT, FLOKI, JTO, plus reconfirms SOL/BONK.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const VOLTR = new PublicKey("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8");
const SPOT = new PublicKey("EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM");
const ORACLE_SEED = Buffer.from("oracle_init_receipt");
const VSA_SEED = Buffer.from("vault_strategy_auth");

// Strategy pubkey == foreign mint for jupiter-spot strategies
const WATCH: Record<string, string> = {
  // Solana ecosystem mints
  "SOL":    "So11111111111111111111111111111111111111112",
  "BONK":   "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "WIF":    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  "POPCAT": "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr",
  "JTO":    "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  // FLOKI on Solana is typically the wormhole-bridged version
  "FLOKI":  "6YNjkvRQJ1AnJczcyiMhuSH1HAqcoeZn22gvh1rATBNM",  // may need to verify
};

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

  // Fetch all Strategy accounts owned by Voltr program, filter for ones whose
  // pubkey == a watched foreign mint. That gives us (vault, strategy) pairs,
  // then we derive the oracle_init_receipt and decode.

  console.log("Fetching all Voltr Strategy accounts...");
  // Strategy account discriminator first 8 bytes. We don't know it a priori,
  // so grab everything and filter by data length to narrow down.
  const all = await conn.getProgramAccounts(VOLTR, {
    filters: [{ dataSize: 216 }],  // typical Strategy account size; guess
  });
  console.log(`  ${all.length} candidate Strategy accounts\n`);

  // We actually want to locate the strategy by scanning for strategy pubkeys
  // matching our watchlist. But the Strategy PDA is derived from the vault,
  // and its OWN pubkey is the PDA. We need a different approach:
  //   - For each watchlist token, SCAN every known Voltr vault for a strategy
  //     whose pubkey matches. That requires knowing the vaults.
  //
  // Simpler: use getProgramAccounts on the spot adapter program to find
  // oracle_init_receipt accounts (44 bytes, owned by SPOT).
  const receipts = await conn.getProgramAccounts(SPOT, {
    filters: [{ dataSize: 44 }],  // oracle_init_receipt layout
  });
  console.log(`Oracle init receipts on mainnet: ${receipts.length}`);

  // Group receipts: the oracle pubkey lives at offset 8.
  // Receipt PDA is [oracle_init_receipt, vaultStrategyAuth, mint]. We don't
  // know which is asset vs foreign without reverse-mapping, so extract all
  // unique oracle pubkeys and verify each exists on-chain as a Pyth Pull v2
  // account (owned by rec5EK...).
  const PYTH_V2 = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
  const oracles = new Set<string>();
  for (const r of receipts) {
    if (r.account.data.length < 40) continue;
    const pk = new PublicKey(r.account.data.subarray(8, 40));
    oracles.add(pk.toBase58());
  }

  console.log(`\nUnique oracle pubkeys referenced: ${oracles.size}`);

  // Verify each and collect metadata. Pyth v2 price account data: first 8 bytes
  // are anchor discriminator, then feed_id (32 bytes) at offset 32? Actually
  // the layout is:
  //   discriminator (8) | write_authority (32) | verification_level (1) |
  //   price_message (~79) | posted_slot (8)
  // Feed ID is inside price_message. For our use we just need to match the
  // oracle to a known symbol. Easiest: just dump and let you cross-reference
  // with Pyth's symbol map.

  const verified: Array<{ oracle: string; owner: string; dataLen: number; firstBytes: string }> = [];
  for (const pk of oracles) {
    const info = await conn.getAccountInfo(new PublicKey(pk));
    if (!info) continue;
    if (!info.owner.equals(PYTH_V2)) continue;  // not a Pyth v2 account
    // Feed ID is inside the message. Pyth's PriceUpdateV2 layout
    // (from pyth-crosschain/pythnet/pythnet_sdk): after 8 disc, 32 write_auth,
    // 1 verification_level = 41 bytes prefix. Then price_message:
    //   feed_id (32) | price (8) | conf (8) | exponent (4) | publish_time (8) |
    //   prev_publish_time (8) | ema_price (8) | ema_conf (8)
    // So feed_id starts at offset 41.
    const feedId = info.data.subarray(41, 41 + 32).toString("hex");
    verified.push({
      oracle: pk,
      owner: info.owner.toBase58(),
      dataLen: info.data.length,
      firstBytes: feedId,
    });
  }

  // Print as a table with feed IDs so they can be matched against Pyth Hermes
  console.log(`\nVerified Pyth v2 accounts: ${verified.length}`);
  console.log("\noracle pubkey                                   feedId (hex)");
  for (const v of verified) {
    console.log(`${v.oracle.padEnd(45)}  ${v.firstBytes}`);
  }

  // Match against known feed IDs for the watchlist
  const KNOWN_FEED_IDS: Record<string, string> = {
    "SOL":    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    "BONK":   "72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
    "WIF":    "4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
    "POPCAT": "b9312a7ee50e189ef045aa3c7842e099b061bd9bdc99ac645956c3b660dc8cce",
    "FLOKI":  "6b1381ce7e874dc5410b197ac8348162c0dd6c0d4c9cd6322672d6c2b1d58293",
    "JTO":    "b43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2",
    "USDC":   "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  };

  console.log("\n── MATCHED TO WATCHLIST ──");
  for (const [sym, wantFeedId] of Object.entries(KNOWN_FEED_IDS)) {
    const match = verified.find((v) => v.firstBytes === wantFeedId);
    if (match) {
      console.log(`✅ ${sym.padEnd(8)} ${match.oracle}`);
    } else {
      console.log(`❌ ${sym.padEnd(8)} — no Voltr-tracked oracle found on mainnet`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
