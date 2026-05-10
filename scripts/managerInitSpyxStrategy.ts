#!/usr/bin/env tsx
/**
 * managerInitSpyxStrategy.ts — initialize the SPYx strategy via Voltr
 * Jupiter-Spot adaptor on the slim-barbell vault.
 *
 * Ported from voltrxyz/spot-scripts/src/scripts/manager-initialize-spot.ts.
 *
 * Strategy pubkey IS the foreign mint (SPYx), not a derived PDA. The
 * init creates oracle-init-receipt PDAs for both asset (USDC) and
 * foreign (SPYx) so subsequent buy/sell swaps can verify oracle prices.
 *
 * DISCRIMINATOR: INITIALIZE_SPOT = [206, 194, 174, 21, 64, 192, 115, 9]
 *
 * REQUIRES env overrides (or defaults below):
 *   FOREIGN_ORACLE — Pyth/Switchboard oracle pubkey for SPY/USD on Solana
 *   ASSET_ORACLE   — Pyth oracle pubkey for USDC/USD (defaults to Save's)
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { VoltrClient } from "@voltr/vault-sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const DRY_RUN = (process.env.DRY_RUN ?? "1") !== "0";
const EXECUTE = process.env.EXECUTE === "1";
const WOULD_EXECUTE = !DRY_RUN && EXECUTE;

// Voltr Jupiter-Spot adaptor (mainnet)
const SPOT_ADAPTOR_PROGRAM_ID = new PublicKey(
  "EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM",
);

// Discriminator for INITIALIZE_SPOT (from voltrxyz/spot-scripts/src/constants/spot.ts)
const INITIALIZE_SPOT_DISCRIMINATOR = Buffer.from([206, 194, 174, 21, 64, 192, 115, 9]);

const ORACLE_INIT_RECEIPT_SEED = Buffer.from("oracle_init_receipt");

// SPYx (Backed Finance) mint on Solana Token-2022
const SPYX_MINT = new PublicKey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W");

// Default oracles — override via env
// USDC Pyth oracle (same one Save uses for USDC reserve)
const DEFAULT_USDC_ORACLE = new PublicKey("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX");
// SPY Pyth oracle — PLACEHOLDER. Look up on Pyth Network: "SPY/USD" Solana price
// feed. When Backed Finance registers SPYx with Pyth they'll publish this.
const DEFAULT_SPY_ORACLE_PLACEHOLDER = "<SET_FOREIGN_ORACLE_ENV — SPY/USD Pyth Solana pubkey>";

const SLIM_VAULT_JSON = path.resolve(__dirname, "..", "voltr", "slim-vault.json");

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createAtaIdempotentIx(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

async function main() {
  console.log(`# managerInitSpyxStrategy`);
  console.log(`DRY_RUN=${DRY_RUN}  EXECUTE=${EXECUTE}  wouldExecute=${WOULD_EXECUTE}`);

  if (!fs.existsSync(SLIM_VAULT_JSON)) {
    throw new Error(`${SLIM_VAULT_JSON} missing — run createSlimVault.ts first`);
  }
  const vaultInfo = JSON.parse(fs.readFileSync(SLIM_VAULT_JSON, "utf8")) as {
    vault: string; asset: string; assetTokenProgram: string;
  };
  const vault = new PublicKey(vaultInfo.vault);
  const vaultAssetMint = new PublicKey(vaultInfo.asset);
  const vaultAssetTokenProgram = new PublicKey(vaultInfo.assetTokenProgram);

  const assetOracle = new PublicKey(process.env.ASSET_ORACLE ?? DEFAULT_USDC_ORACLE);
  const foreignOracleRaw = process.env.FOREIGN_ORACLE ?? DEFAULT_SPY_ORACLE_PLACEHOLDER;
  if (foreignOracleRaw.startsWith("<")) {
    throw new Error(
      `FOREIGN_ORACLE env missing. Look up SPY/USD Solana Pyth oracle at https://pyth.network/price-feeds/equity-us-spy-usd`,
    );
  }
  const foreignOracle = new PublicKey(foreignOracleRaw);
  const foreignMint = SPYX_MINT;
  const foreignTokenProgram = TOKEN_2022_PROGRAM_ID;

  console.log(`  vault=${vault.toBase58()}`);
  console.log(`  foreignMint (SPYx)=${foreignMint.toBase58()}`);
  console.log(`  assetOracle (USDC)=${assetOracle.toBase58()}`);
  console.log(`  foreignOracle (SPY)=${foreignOracle.toBase58()}`);

  const rpc = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpc, "confirmed");
  const payerKp = loadKp();
  const payer = payerKp.publicKey;
  const client = new VoltrClient(conn);

  // Strategy pubkey IS the foreign mint
  const strategy = foreignMint;
  const { vaultStrategyAuth } = client.findVaultStrategyAddresses(vault, strategy);

  // Asset + foreign ATAs under strategyAuth
  const vaultAssetAta = deriveAta(vaultStrategyAuth, vaultAssetMint, vaultAssetTokenProgram);
  const vaultForeignAta = deriveAta(vaultStrategyAuth, foreignMint, foreignTokenProgram);

  // Oracle init receipts
  const [assetOracleInitReceipt] = PublicKey.findProgramAddressSync(
    [ORACLE_INIT_RECEIPT_SEED, vaultStrategyAuth.toBuffer(), vaultAssetMint.toBuffer()],
    SPOT_ADAPTOR_PROGRAM_ID,
  );
  const [foreignOracleInitReceipt] = PublicKey.findProgramAddressSync(
    [ORACLE_INIT_RECEIPT_SEED, vaultStrategyAuth.toBuffer(), foreignMint.toBuffer()],
    SPOT_ADAPTOR_PROGRAM_ID,
  );

  console.log(`  vaultStrategyAuth=${vaultStrategyAuth.toBase58()}`);
  console.log(`  vaultAssetAta=${vaultAssetAta.toBase58()}`);
  console.log(`  vaultForeignAta=${vaultForeignAta.toBase58()}`);
  console.log(`  assetOracleInitReceipt=${assetOracleInitReceipt.toBase58()}`);
  console.log(`  foreignOracleInitReceipt=${foreignOracleInitReceipt.toBase58()}`);

  const ixs: TransactionInstruction[] = [];
  ixs.push(createAtaIdempotentIx(payer, vaultAssetAta, vaultStrategyAuth, vaultAssetMint, vaultAssetTokenProgram));
  ixs.push(createAtaIdempotentIx(payer, vaultForeignAta, vaultStrategyAuth, foreignMint, foreignTokenProgram));

  const initStrategyIx = await client.createInitializeStrategyIx(
    {
      instructionDiscriminator: INITIALIZE_SPOT_DISCRIMINATOR,
    },
    {
      payer, manager: payer, vault, strategy,
      adaptorProgram: SPOT_ADAPTOR_PROGRAM_ID,
      remainingAccounts: [
        { pubkey: vaultAssetMint,           isSigner: false, isWritable: false },
        { pubkey: vaultAssetAta,            isSigner: false, isWritable: false },
        { pubkey: vaultAssetTokenProgram,   isSigner: false, isWritable: false },
        { pubkey: assetOracle,              isSigner: false, isWritable: false },
        { pubkey: assetOracleInitReceipt,   isSigner: false, isWritable: true  },
        { pubkey: vaultForeignAta,          isSigner: false, isWritable: false },
        { pubkey: foreignTokenProgram,      isSigner: false, isWritable: false },
        { pubkey: foreignOracle,            isSigner: false, isWritable: false },
        { pubkey: foreignOracleInitReceipt, isSigner: false, isWritable: true  },
      ],
    },
  );
  ixs.push(initStrategyIx);

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer, recentBlockhash: blockhash, instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  console.log(`\n-- simulating --`);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(`  sim.err=${JSON.stringify(sim.value.err)}`);
  for (const l of sim.value.logs ?? []) console.log(`    ${l}`);
  if (sim.value.err && WOULD_EXECUTE) {
    throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
  }

  console.log(`\n===PLAN===`);
  console.log(JSON.stringify({
    vault: vault.toBase58(),
    strategy: strategy.toBase58(),
    vaultStrategyAuth: vaultStrategyAuth.toBase58(),
    wouldExecute: WOULD_EXECUTE,
  }, null, 2));

  if (!WOULD_EXECUTE) {
    console.log(`\n[dry-run] no tx sent.`);
    return;
  }

  tx.sign([payerKp]);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false });
  console.log(`  sent: ${sig}`);
  const conf = await conn.confirmTransaction(sig, "confirmed");
  if (conf.value.err) throw new Error(`confirm err: ${JSON.stringify(conf.value.err)}`);
  console.log(`  confirmed ✓`);
  console.log(`  strategy (=SPYx mint): ${strategy.toBase58()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
