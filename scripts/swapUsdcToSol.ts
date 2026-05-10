#!/usr/bin/env tsx
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

function loadKp(): Keypair {
  const raw = process.env.CREATOR_KEY!.trim();
  if (raw.startsWith("[")) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function main() {
  const kp = loadKp();
  const conn = new Connection(process.env.RPC_URL!, "confirmed");
  const r = await conn.getParsedTokenAccountsByOwner(kp.publicKey, { mint: new (await import("@solana/web3.js")).PublicKey(USDC) });
  const usdc = r.value.length ? (r.value[0].account.data as any).parsed.info.tokenAmount.amount : "0";
  console.log(`usdc balance: ${Number(usdc) / 1e6} USDC`);
  if (Number(usdc) < 1_000_000) return console.log("nothing to swap");

  const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
  quoteUrl.searchParams.set("inputMint", USDC);
  quoteUrl.searchParams.set("outputMint", WSOL);
  quoteUrl.searchParams.set("amount", usdc);
  quoteUrl.searchParams.set("slippageBps", "100");
  const quote = await (await fetch(quoteUrl.toString())).json();
  console.log(`quote: ${Number(quote.outAmount) / 1e9} SOL`);

  const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote, userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 75_000,
    }),
  });
  const { swapTransaction } = await swapRes.json();
  const tx = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(swapTransaction, "base64")));
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const bh = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
  console.log(`✓ swapped: https://solscan.io/tx/${sig}`);
}
main().catch(e => { console.error(e); process.exit(1); });
