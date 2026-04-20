#!/usr/bin/env tsx
/** Do a tiny swap (100 FDRY → USDC) through our pool to write an observation. */
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";

const POOL = "31pSFwJ7bkTw6t57gxLkZyeTK9DjoeEQHgPeYAoDhdDF";

function loadKp() {
  const raw = process.env.CREATOR_KEY!.trim();
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  const kp = loadKp();
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const raydium = await Raydium.load({
    connection: conn, owner: kp, cluster: "mainnet",
    disableFeatureCheck: true, blockhashCommitment: "confirmed",
  });
  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(POOL);
  console.log(`pool reserves: ${rpcData.baseReserve} A, ${rpcData.quoteReserve} B`);

  // Simple constant-product math: out = quoteReserve - (baseReserve * quoteReserve) / (baseReserve + in)
  const amountIn = new BN("100000000000"); // 100 FDRY in raw (9 decimals)
  const bx = rpcData.baseReserve;  // 92000 * 1e9
  const by = rpcData.quoteReserve; // 30 * 1e6
  const k = bx.mul(by);
  const newX = bx.add(amountIn);
  const estOut = by.sub(k.div(newX));
  console.log(`  est receive (pre-fee): ${estOut.toString()} raw USDC`);
  const { execute } = await raydium.cpmm.swap({
    poolInfo, poolKeys,
    inputAmount: amountIn,
    swapResult: { inputAmount: amountIn, outputAmount: estOut } as any,
    baseIn: true,
    slippage: 0.5,
    txVersion: TxVersion.V0,
    computeBudgetConfig: { units: 400_000, microLamports: 50_000 },
  });
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`  ✓ swap: https://solscan.io/tx/${txId}`);
}
main().catch(e => { console.error(e); process.exit(1); });
