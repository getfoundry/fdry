#!/usr/bin/env tsx
/**
 * burnFdryWsolLp.ts — withdraw all our LP from the FDRY/WSOL CPMM pool
 * so we can redeploy that capital into a FDRY/USDC pool.
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import BN from "bn.js";
import { Raydium, TxVersion, Percent } from "@raydium-io/raydium-sdk-v2";

const POOL = "F6TSABcYeudY4ovxT2jzmabKw7xCdFowUbFtcQtmJnTi";

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY?.trim();
  if (!raw) throw new Error("CREATOR_KEY env missing");
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  const isDry = process.argv.includes("--dry-run");
  const rpc = process.env.RPC_URL!;
  const kp = loadKp();
  const conn = new Connection(rpc, "confirmed");

  console.log(`burning FDRY/WSOL LP · pool ${POOL} · wallet ${kp.publicKey.toBase58()}`);

  const raydium = await Raydium.load({
    connection: conn, owner: kp, cluster: "mainnet",
    disableFeatureCheck: true, blockhashCommitment: "confirmed",
  });

  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(POOL);
  console.log(`  pool: base=${poolInfo.mintA.symbol || poolInfo.mintA.address} quote=${poolInfo.mintB.symbol || poolInfo.mintB.address}`);
  console.log(`  reserves: ${Number(rpcData.baseReserve.toString()) / 10 ** poolInfo.mintA.decimals} A, ${Number(rpcData.quoteReserve.toString()) / 10 ** poolInfo.mintB.decimals} B`);

  // find our LP balance
  const lpMint = new PublicKey(poolInfo.lpMint.address);
  const ataInfo = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { mint: lpMint });
  const lpAmount = ataInfo.value.length
    ? new BN((ataInfo.value[0].account.data as any).parsed.info.tokenAmount.amount)
    : new BN(0);
  console.log(`  our LP: ${Number(lpAmount.toString()) / 1e9}`);

  if (lpAmount.isZero()) {
    console.log("no LP to burn");
    return;
  }
  if (isDry) {
    console.log("DRY RUN — stopping");
    return;
  }

  const { execute } = await raydium.cpmm.withdrawLiquidity({
    poolInfo, poolKeys,
    lpAmount,
    slippage: new Percent(2, 100),
    txVersion: TxVersion.V0,
    computeBudgetConfig: { units: 400_000, microLamports: 75_000 },
  });
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`  ✓ withdrawn: https://solscan.io/tx/${txId}`);
}

main().catch(e => { console.error(e); process.exit(1); });
