#!/usr/bin/env tsx
/**
 * findXstockOracle.ts — scan all Voltr strategy init receipts on mainnet,
 * find ones whose strategy pubkey matches an xStock mint (i.e. Jupiter-spot
 * strategies), then read their oracleInitReceipt PDAs to extract the
 * sponsored Pyth oracle accounts so we can reuse them.
 *
 * Uses raw getProgramAccounts — the SDK's borsh decoder chokes on version
 * mismatches across deployed receipts.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const VOLTR_VAULT_PROGRAM = new PublicKey("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8");
const SPOT_ADAPTOR = new PublicKey("EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM");
const ORACLE_INIT_RECEIPT_SEED = Buffer.from("oracle_init_receipt");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const XSTOCKS: Record<string, string> = {
  SPYx:   "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
  NVDAx:  "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  TSLAx:  "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  METAx:  "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
  MSFTx:  "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
  GOOGLx: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
  MSTRx:  "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
  COINx:  "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
  CRCLx:  "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
  QQQx:   "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
};

function deriveVaultStrategyAuth(vault: PublicKey, strategy: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_strategy_auth"), vault.toBuffer(), strategy.toBuffer()],
    VOLTR_VAULT_PROGRAM,
  );
  return pda;
}

function deriveOracleInitReceipt(vaultStrategyAuth: PublicKey, mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [ORACLE_INIT_RECEIPT_SEED, vaultStrategyAuth.toBuffer(), mint.toBuffer()],
    SPOT_ADAPTOR,
  );
  return pda;
}

async function main() {
  const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");

  console.log(`# findXstockOracle — scanning mainnet`);
  console.log(`  rpc=${rpc}`);

  // Raw getProgramAccounts — skip SDK decoder
  console.log(`  fetching all Voltr program accounts (may take ~10s)...`);
  const accounts = await conn.getProgramAccounts(VOLTR_VAULT_PROGRAM);
  console.log(`  total accounts: ${accounts.length}`);

  // StrategyInitReceipt layout (from SDK types): 8-byte disc + vault(32)
  //   + strategy(32) + adaptorProgram(32) + ... We match on the
  //   middle 32-byte slice against xStock mints.
  const xstockMints = new Set(Object.values(XSTOCKS));
  const bySymbol: Record<string, string> = {};
  for (const [sym, mint] of Object.entries(XSTOCKS)) bySymbol[mint] = sym;

  const found: { xstock: string; vault: string; strategy: string; adaptor: string; accountPubkey: string }[] = [];
  for (const a of accounts) {
    const d = a.account.data;
    if (d.length < 8 + 32 * 3) continue;
    const vault = new PublicKey(d.subarray(8, 40));
    const strategy = new PublicKey(d.subarray(40, 72));
    const adaptor = new PublicKey(d.subarray(72, 104));
    const sStr = strategy.toBase58();
    if (!xstockMints.has(sStr)) continue;
    found.push({
      xstock: bySymbol[sStr],
      vault: vault.toBase58(),
      strategy: sStr,
      adaptor: adaptor.toBase58(),
      accountPubkey: a.pubkey.toBase58(),
    });
  }

  if (found.length === 0) {
    console.log(`\nNO xStock spot strategies found on Voltr mainnet.`);
    console.log(`This means either:`);
    console.log(`  - Ranger hasn't deployed an xStock spot vault yet (we'd be first)`);
    console.log(`  - Our xStock mint list is stale`);
    console.log(`  - The account layout changed in a newer adaptor version`);
    return;
  }

  console.log(`\n=== Found ${found.length} xStock spot strategies ===`);
  for (const s of found) {
    console.log(`\n  ${s.xstock}  strategy=${s.strategy}`);
    console.log(`    vault: ${s.vault}`);
    console.log(`    adaptorProgram: ${s.adaptor}`);
    console.log(`    receipt account: ${s.accountPubkey}`);

    // Derive oracleInitReceipts for USDC (asset) and xStock (foreign)
    const vaultPk = new PublicKey(s.vault);
    const strategyPk = new PublicKey(s.strategy);
    const vsa = deriveVaultStrategyAuth(vaultPk, strategyPk);
    const foreignRcp = deriveOracleInitReceipt(vsa, strategyPk);
    const assetRcp = deriveOracleInitReceipt(vsa, USDC_MINT);

    for (const [label, pda] of [["foreign/xStock", foreignRcp], ["asset/USDC", assetRcp]] as const) {
      const info = await conn.getAccountInfo(pda);
      if (!info) { console.log(`    ${label} oracleInitReceipt: MISSING (${pda.toBase58()})`); continue; }
      // Layout: disc(8) + vault_strategy_auth(32) + mint(32) + oracle(32) + ...
      // Oracle at byte 72, 32 bytes.
      if (info.data.length < 104) {
        console.log(`    ${label} receipt too short: ${info.data.length} bytes`); continue;
      }
      const oracle = new PublicKey(info.data.subarray(72, 104));
      console.log(`    ${label} ORACLE:  ${oracle.toBase58()}  (via ${pda.toBase58()})`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
