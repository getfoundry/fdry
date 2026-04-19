import { useEffect, useState } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const RPC = "https://solana-rpc.publicnode.com";
const HERMES_SOL =
  "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export type Holding = {
  mint: string;
  symbol: string;
  amount: number;
  decimals: number;
  usd: number;
};

export type Activity = {
  signature: string;
  blockTime: number | null;
  err: unknown | null;
  humanKind: string;
};

export type LiveTreasury = {
  solBalance: number;
  solPrice: number;
  navUsd: number;
  navFromTokens: number;
  sharesOutstanding: number;
  navPerShareUsd: number;
  solscanAccount: string;
  solscanMint: string;
  holdings: Holding[];
  activity: Activity[];
  loading: boolean;
  error: string | null;
  updatedAt: number;
};

const KNOWN_TOKENS: Record<string, { symbol: string; priceHint?: "SOL" | "USD" }> = {
  So11111111111111111111111111111111111111112: { symbol: "WSOL", priceHint: "SOL" },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", priceHint: "USD" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", priceHint: "USD" },
};

// Classify a failing or successful tx into a human word by inspecting its err field
// and (if available) the first program invoked. We keep this cheap — just err parsing.
function classifyErr(err: unknown): string {
  if (!err) return "success";
  const s = JSON.stringify(err);
  if (s.includes('"Custom":6075')) return "rejected · deposits locked";
  if (s.includes('"Custom":1')) return "rejected · program error 1";
  const m = s.match(/"Custom":(\d+)/);
  if (m) return `rejected · custom ${m[1]}`;
  return "rejected";
}

let pythPriceCache: { v: number; t: number } = { v: 0, t: 0 };
async function fetchSolPriceUsd(): Promise<number> {
  const now = Date.now();
  if (pythPriceCache.v && now - pythPriceCache.t < 15_000) return pythPriceCache.v;
  const r = await fetch(HERMES_SOL);
  if (!r.ok) throw new Error(`pyth ${r.status}`);
  const j = await r.json();
  const p = j?.parsed?.[0]?.price;
  if (!p?.price || typeof p.expo !== "number") throw new Error("pyth shape");
  const usd = Number(p.price) * Math.pow(10, p.expo);
  pythPriceCache = { v: usd, t: now };
  return usd;
}

async function fetchTokenAccounts(
  conn: Connection,
  owner: PublicKey,
): Promise<{ mint: string; amount: number; decimals: number }[]> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [
      owner.toBase58(),
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed" },
    ],
  };
  const r = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`tokens ${r.status}`);
  const j = await r.json();
  const accounts: Array<{
    account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmount: number } } } } };
  }> = j?.result?.value ?? [];
  return accounts.map((a) => {
    const info = a.account.data.parsed.info;
    return {
      mint: info.mint,
      amount: Number(info.tokenAmount.uiAmount) || 0,
      decimals: info.tokenAmount.decimals,
    };
  });
}

async function fetchRecentActivity(conn: Connection, address: PublicKey, limit = 12): Promise<Activity[]> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getSignaturesForAddress",
    params: [address.toBase58(), { limit }],
  };
  const r = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`sigs ${r.status}`);
  const j = await r.json();
  const sigs = (j?.result ?? []) as Array<{ signature: string; blockTime: number | null; err: unknown | null }>;
  return sigs.map((s) => ({
    signature: s.signature,
    blockTime: s.blockTime,
    err: s.err,
    humanKind: classifyErr(s.err),
  }));
}

export function useLiveTreasury(vaultPubkey: string, vaultMint: string) {
  const [state, setState] = useState<LiveTreasury>({
    solBalance: 0,
    solPrice: 0,
    navUsd: 0,
    navFromTokens: 0,
    sharesOutstanding: 0,
    navPerShareUsd: 0,
    solscanAccount: `https://solscan.io/account/${vaultPubkey}`,
    solscanMint: `https://solscan.io/token/${vaultMint}`,
    holdings: [],
    activity: [],
    loading: true,
    error: null,
    updatedAt: 0,
  });

  useEffect(() => {
    let alive = true;
    const conn = new Connection(RPC, "confirmed");
    const vaultPk = new PublicKey(vaultPubkey);
    const mintPk = new PublicKey(vaultMint);
    const load = async () => {
      try {
        const [balance, supply, solPrice, tokenAccounts, activity] = await Promise.all([
          conn.getBalance(vaultPk),
          conn.getTokenSupply(mintPk),
          fetchSolPriceUsd(),
          fetchTokenAccounts(conn, vaultPk),
          fetchRecentActivity(conn, vaultPk),
        ]);
        if (!alive) return;
        const solBalance = balance / LAMPORTS_PER_SOL;
        const supplyNum = Number(supply.value.amount) / Math.pow(10, supply.value.decimals);
        const holdings: Holding[] = tokenAccounts
          .filter((t) => t.amount > 0)
          .map((t) => {
            const known = KNOWN_TOKENS[t.mint];
            const symbol = known?.symbol ?? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`;
            const usd =
              known?.priceHint === "SOL"
                ? t.amount * solPrice
                : known?.priceHint === "USD"
                  ? t.amount
                  : 0;
            return { mint: t.mint, symbol, amount: t.amount, decimals: t.decimals, usd };
          });
        const navFromTokens = holdings.reduce((s, h) => s + h.usd, 0);
        const navUsd = navFromTokens; // tokens are the real NAV; native SOL is rent
        const navPerShareUsd = supplyNum > 0 ? navUsd / supplyNum : 0;
        setState((s) => ({
          ...s,
          solBalance,
          solPrice,
          navUsd,
          navFromTokens,
          sharesOutstanding: supplyNum,
          navPerShareUsd,
          holdings,
          activity,
          loading: false,
          error: null,
          updatedAt: Date.now(),
        }));
      } catch (e) {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      }
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [vaultPubkey, vaultMint]);

  return state;
}
