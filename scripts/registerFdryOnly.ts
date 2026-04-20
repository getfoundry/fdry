#!/usr/bin/env tsx
/**
 * registerFdryOnly.ts — register FDRY in Symmetry using an existing Raydium CPMM pool.
 * Try different oracle configs until one works.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SymmetryCore } from "@symmetry-hq/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FDRY_MINT = "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FDRY_USDC_POOL = "31pSFwJ7bkTw6t57gxLkZyeTK9DjoeEQHgPeYAoDhdDF";

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}
function makeWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    signTransaction: async <T>(tx: T): Promise<T> => { (tx as any).sign([kp]); return tx; },
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => { txs.forEach((t: any) => t.sign([kp])); return txs; },
    payer: kp,
  };
}
function getVault(): string {
  const env = process.env.VAULT_PUBKEY?.trim();
  if (env) return env;
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "docs", "vault.json"), "utf-8")).vault_pubkey;
}

async function main() {
  const args = process.argv.slice(2);
  const lutIdx = parseInt(args.find(a => a.startsWith("--lut-index="))?.split("=")[1] ?? "10");
  const twap = parseInt(args.find(a => a.startsWith("--twap="))?.split("=")[1] ?? "60");

  const rpc = process.env.RPC_URL!;
  const kp = loadKp();
  const conn = new Connection(rpc, "confirmed");
  const sdk = new SymmetryCore({ connection: conn, network: "mainnet", priorityFee: 75_000 });
  const wallet = makeWallet(kp);
  const vault = getVault();

  console.log(`registering FDRY with raydium_cpmm oracle @ pool ${FDRY_USDC_POOL}`);
  console.log(`  lut_index=${lutIdx}  twap=${twap}s`);

  const addTx = await sdk.addOrEditTokenTx(
    { vault, manager: kp.publicKey.toBase58() },
    {
      token_mint: FDRY_MINT,
      active: true,
      min_oracles_thresh: 1,
      min_conf_bps: 50,
      conf_thresh_bps: 500,
      conf_multiplier: 1.0,
      oracles: [
        {
          oracle_type: "raydium_cpmm",
          account_lut_id: 0,
          account_lut_index: lutIdx,
          account: FDRY_USDC_POOL,
          weight_bps: 10000,
          is_required: true,
          conf_thresh_bps: 500,
          volatility_thresh_bps: 10000,
          max_slippage_bps: 300,
          min_liquidity: 25,
          staleness_thresh: 60,
          staleness_conf_rate_bps: 100,
          token_decimals: 9,
          twap_seconds_ago: twap,
          twap_secondary_seconds_ago: twap * 5,
          quote_token: "usdc" as any,
        },
      ],
    },
  );
  const res = await sdk.signAndSendTxPayloadBatchSequence({ txPayloadBatchSequence: addTx, wallet });
  console.log(`addToken:`, JSON.stringify(res).slice(0, 300));
}
main().catch(e => { console.error(e); process.exit(1); });
