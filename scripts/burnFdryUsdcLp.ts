#!/usr/bin/env tsx
/** burnFdryUsdcLp.ts — withdraw all LP from the FDRY/USDC CPMM pool. */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import { Raydium, TxVersion, Percent } from "@raydium-io/raydium-sdk-v2";

const POOL = "31pSFwJ7bkTw6t57gxLkZyeTK9DjoeEQHgPeYAoDhdDF";

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY!.trim();
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  const rpc = process.env.RPC_URL!;
  const kp = loadKp();
  const conn = new Connection(rpc, "confirmed");
  const raydium = await Raydium.load({
    connection: conn, owner: kp, cluster: "mainnet",
    disableFeatureCheck: true, blockhashCommitment: "confirmed",
  });
  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(POOL);
  const lpMint = new PublicKey(poolInfo.lpMint.address);
  const ataInfo = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { mint: lpMint });
  const lp = ataInfo.value.length ? new BN((ataInfo.value[0].account.data as any).parsed.info.tokenAmount.amount) : new BN(0);
  console.log(`pool reserves: ${rpcData.baseReserve} A, ${rpcData.quoteReserve} B`);
  console.log(`our LP: ${Number(lp.toString()) / 1e9}`);
  if (lp.isZero()) return console.log("no LP to burn");
  const { execute } = await raydium.cpmm.withdrawLiquidity({
    poolInfo, poolKeys,
    lpAmount: lp,
    slippage: new Percent(2, 100),
    txVersion: TxVersion.V0,
    computeBudgetConfig: { units: 400_000, microLamports: 75_000 },
  });
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`✓ withdrawn: https://solscan.io/tx/${txId}`);
}
main().catch(e => { console.error(e); process.exit(1); });
