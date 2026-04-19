// Jupiter lite-api swap helpers. Routes FDRY ↔ SOL under the hood
// so users can deposit / withdraw in FDRY-denominated terms.

import { VersionedTransaction } from "@solana/web3.js";

const JUP_BASE = "https://lite-api.jup.ag/swap/v1";

export type JupQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: unknown[];
  [k: string]: unknown;
};

export async function fetchJupQuote(params: {
  inputMint: string;
  outputMint: string;
  amountRaw: number;
  slippageBps?: number;
}): Promise<JupQuote> {
  const url = new URL(`${JUP_BASE}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(params.amountRaw));
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 150));
  url.searchParams.set("restrictIntermediateTokens", "true");
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`jup quote ${r.status}`);
  return r.json();
}

export async function buildJupSwapTx(
  quote: JupQuote,
  userPublicKey: string,
): Promise<VersionedTransaction> {
  const r = await fetch(`${JUP_BASE}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 75_000,
    }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`jup swap ${r.status} ${body.slice(0, 200)}`);
  }
  const { swapTransaction } = await r.json();
  const raw = Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0));
  return VersionedTransaction.deserialize(raw);
}

export function priceImpactSafe(q: JupQuote): boolean {
  const p = parseFloat(q.priceImpactPct || "0");
  return p <= 5; // 5% hard ceiling
}
