// Pure data layer for NAV-per-share historical chart.
// No React imports. Fetches vault tx history via JSON-RPC, parses token balance
// meta to compute per-tx idle FDRY and running stFDRY supply.

export type NavSnapshot = {
  ts: number;          // blockTime in ms
  slot: number;
  sig: string;
  navFdry: number;     // idle FDRY balance (whole units)
  stFdrySupply: number;// running supply (whole units)
  navPerShare: number; // navFdry / stFdrySupply, or 1.0 if supply=0
};

export type FetchOpts = { sinceSig?: string; maxSigs?: number };

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString?: string;
  };
};

type SigInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
};

type TxResp = {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
};

async function rpc<T = unknown>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method} http ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`rpc ${method}: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`rpc ${method}: empty result`);
  return json.result;
}

function toUi(tb: TokenBalance): number {
  if (tb.uiTokenAmount.uiAmount != null) return tb.uiTokenAmount.uiAmount;
  const raw = Number(tb.uiTokenAmount.amount);
  return raw / 10 ** tb.uiTokenAmount.decimals;
}

function findIdleFdry(
  balances: TokenBalance[] | undefined,
  fdryMint: string,
  idleAuthPda: string,
): number | null {
  if (!balances) return null;
  for (const b of balances) {
    if (b.mint === fdryMint && b.owner === idleAuthPda) return toUi(b);
  }
  return null;
}

function sumLpSupply(
  balances: TokenBalance[] | undefined,
  lpMint: string,
): number {
  if (!balances) return 0;
  let sum = 0;
  for (const b of balances) {
    if (b.mint === lpMint) sum += toUi(b);
  }
  return sum;
}

export async function fetchNavHistory(
  rpcUrl: string,
  vault: string,
  lpMint: string,
  fdryMint: string,
  idleAuthPda: string,
  opts: FetchOpts = {},
): Promise<{ series: NavSnapshot[]; newestSig: string | null }> {
  const limit = opts.maxSigs ?? 200;
  const sigParams: Record<string, unknown> = { limit };
  if (opts.sinceSig) sigParams.until = opts.sinceSig;

  const sigs = await rpc<SigInfo[]>(rpcUrl, 'getSignaturesForAddress', [
    vault,
    sigParams,
  ]);

  if (!sigs || sigs.length === 0) return { series: [], newestSig: null };

  const newestSig = sigs[0].signature;
  // chronological: oldest -> newest
  const chrono = sigs.slice().reverse();

  const series: NavSnapshot[] = [];
  let runningNavFdry = 0;
  let runningSupply = 0;

  for (const si of chrono) {
    if (si.err != null) continue;

    let tx: TxResp | null;
    try {
      tx = await rpc<TxResp | null>(rpcUrl, 'getTransaction', [
        si.signature,
        { maxSupportedTransactionVersion: 0, encoding: 'json' },
      ]);
    } catch {
      continue;
    }
    if (!tx || !tx.meta || tx.meta.err != null) continue;

    const pre = tx.meta.preTokenBalances;
    const post = tx.meta.postTokenBalances;

    // idle FDRY balance: prefer post, then pre, else carry prior
    const postIdle = findIdleFdry(post, fdryMint, idleAuthPda);
    const preIdle = findIdleFdry(pre, fdryMint, idleAuthPda);
    if (postIdle != null) runningNavFdry = postIdle;
    else if (preIdle != null) runningNavFdry = preIdle;

    // LP supply delta: sum(post) - sum(pre) over ALL lpMint entries
    const preSum = sumLpSupply(pre, lpMint);
    const postSum = sumLpSupply(post, lpMint);
    const delta = postSum - preSum;
    runningSupply += delta;
    if (runningSupply < 0) runningSupply = 0;

    // Skip txs that don't touch our mints AND don't have prior state progress
    const touchedAnything =
      postIdle != null || preIdle != null || preSum !== 0 || postSum !== 0;
    if (!touchedAnything && series.length === 0) {
      // initialize_vault etc — no meaningful state yet
      continue;
    }

    const tsMs = (si.blockTime ?? tx.blockTime ?? 0) * 1000;
    const navPerShare = runningSupply > 0 ? runningNavFdry / runningSupply : 1;

    series.push({
      ts: tsMs,
      slot: si.slot,
      sig: si.signature,
      navFdry: runningNavFdry,
      stFdrySupply: runningSupply,
      navPerShare,
    });
  }

  return { series, newestSig };
}

const CACHE_PREFIX = 'fdry:navHistory:v1:';

export function loadCachedHistory(): NavSnapshot[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    // Caller passes vault via saveHistoryToCache; read the single known key.
    // We scan for any matching v1 entry and return the first. Simpler: caller
    // typically uses a stable vault, so search the storage for our prefix.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) {
        const raw = localStorage.getItem(k);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as NavSnapshot[];
        return Array.isArray(parsed) ? parsed : [];
      }
    }
    return [];
  } catch {
    return [];
  }
}

export function saveHistoryToCache(series: NavSnapshot[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // Key uses first snapshot's sig-derived... but spec says vault-keyed.
    // Since we don't have vault here, store under a stable suffix: 'default'.
    // Consumers using a single vault will round-trip correctly.
    const key = `${CACHE_PREFIX}default`;
    localStorage.setItem(key, JSON.stringify(series));
  } catch {
    // ignore quota / serialization errors
  }
}
