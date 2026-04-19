import { useEffect, useMemo, useRef, useState } from "react";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";
import { buildJupSwapTx, fetchJupQuote, type JupQuote } from "../lib/jupiter";

const RPC = "https://solana-rpc.publicnode.com";
const WSOL = "So11111111111111111111111111111111111111112";
const FDRY_MINT = "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL";

type PhantomLike = {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction<T extends VersionedTransaction | import("@solana/web3.js").Transaction>(tx: T): Promise<T>;
  signAllTransactions<T extends VersionedTransaction | import("@solana/web3.js").Transaction>(txs: T[]): Promise<T[]>;
};

function getPhantom(): PhantomLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: PhantomLike }; solana?: PhantomLike };
  const p = w.phantom?.solana ?? w.solana;
  return p && p.isPhantom ? p : null;
}

type Mode = "deposit" | "withdraw";
type Step =
  | "idle"
  | "connecting"
  | "quoting"
  | "building"
  | "signing_swap"
  | "confirming_swap"
  | "signing_buy"
  | "signing_lock"
  | "signing_sell"
  | "confirming_sell"
  | "done_deposit"
  | "done_withdraw"
  | "error";

type Props = {
  vaultMint: string;
  vaultPubkey: string;
  solPriceUsd?: number;
  navPerShareUsd?: number;
};

export function DepositWidget({ vaultMint, vaultPubkey: _vaultPubkey, solPriceUsd = 0, navPerShareUsd = 0 }: Props) {
  const [mode, setMode] = useState<Mode>("deposit");
  const [pubkey, setPubkey] = useState<PublicKey | null>(null);
  const [fdryBalance, setFdryBalance] = useState<number | null>(null);
  const [stFdryBalance, setStFdryBalance] = useState<number | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  const [amount, setAmount] = useState("1000");
  const [quote, setQuote] = useState<JupQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<Array<{ label: string; sig: string }>>([]);

  const connection = useMemo(() => new Connection(RPC, "confirmed"), []);
  const sdk = useMemo(
    () => new SymmetryCore({ connection, network: "mainnet", priorityFee: 75_000 }),
    [connection],
  );

  // Auto-reconnect trusted Phantom session
  useEffect(() => {
    const ph = getPhantom();
    if (!ph) return;
    ph.connect({ onlyIfTrusted: true })
      .then((r) => setPubkey(r.publicKey))
      .catch(() => { /* silent */ });
  }, []);

  // Balance poll
  useEffect(() => {
    if (!pubkey) {
      setFdryBalance(null);
      setStFdryBalance(null);
      setSolBalance(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const [sol, tokens] = await Promise.all([
          connection.getBalance(pubkey),
          connection.getParsedTokenAccountsByOwner(pubkey, {
            programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          }),
        ]);
        if (!alive) return;
        setSolBalance(sol / LAMPORTS_PER_SOL);
        let fdry = 0, stfdry = 0;
        for (const { account } of tokens.value) {
          const info = (account.data as { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } }).parsed.info;
          if (info.mint === FDRY_MINT) fdry = info.tokenAmount.uiAmount ?? 0;
          if (info.mint === vaultMint) stfdry = info.tokenAmount.uiAmount ?? 0;
        }
        setFdryBalance(fdry);
        setStFdryBalance(stfdry);
      } catch { /* ignore */ }
    };
    load();
    const i = setInterval(load, 12_000);
    return () => { alive = false; clearInterval(i); };
  }, [pubkey, connection, vaultMint]);

  // Quote fetch (debounced) — only for deposit side
  const quoteAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (mode !== "deposit") { setQuote(null); return; }
    const amt = parseFloat(amount || "0");
    if (!amt || amt <= 0) { setQuote(null); setQuoteErr(null); return; }
    setQuoteErr(null);
    const timer = setTimeout(async () => {
      quoteAbortRef.current?.abort();
      const ac = new AbortController();
      quoteAbortRef.current = ac;
      try {
        const raw = Math.floor(amt * 1_000_000_000); // FDRY decimals = 9
        const q = await fetchJupQuote({ inputMint: FDRY_MINT, outputMint: WSOL, amountRaw: raw, slippageBps: 150 });
        if (!ac.signal.aborted) setQuote(q);
      } catch (e) {
        if (!ac.signal.aborted) setQuoteErr((e as Error).message);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [mode, amount]);

  const connect = async () => {
    setError(null);
    const ph = getPhantom();
    if (!ph) {
      window.open("https://phantom.app/download", "_blank", "noopener");
      setError("Phantom not detected. Install it, then refresh.");
      return;
    }
    setStep("connecting");
    try {
      const r = await ph.connect();
      setPubkey(r.publicKey);
      setStep("idle");
    } catch (e) {
      setError((e as Error).message || "Connection cancelled");
      setStep("idle");
    }
  };

  const disconnect = async () => {
    try { await getPhantom()?.disconnect(); } catch { /* ignore */ }
    setPubkey(null); setTxs([]); setStep("idle");
  };

  const humanizeErr = (raw: string): string => {
    if (raw.includes("6075")) return "Symmetry 6075 · vault is in Genesis. Deposits unlock once the keeper processes the seed batch (~1 hour). No SOL was taken — tx failed atomically.";
    if (/insufficient.*lamports|Transfer:.*insufficient/i.test(raw)) return "Insufficient SOL in wallet for gas (~0.01 SOL needed).";
    if (/insufficient funds/i.test(raw)) return "Insufficient token balance.";
    if (/User rejected|cancelled/i.test(raw)) return "You cancelled the signature in Phantom.";
    if (/blockhash.*not found|Blockhash/i.test(raw)) return "Transaction expired. Try again.";
    return raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
  };

  const depositFromFdry = async () => {
    const ph = getPhantom();
    if (!ph || !pubkey || !quote) return;
    setError(null); setTxs([]);

    const walletForSdk = {
      publicKey: pubkey,
      signTransaction: ph.signTransaction.bind(ph),
      signAllTransactions: ph.signAllTransactions.bind(ph),
    };

    try {
      // 1. Jupiter swap FDRY -> SOL
      setStep("building");
      const swapTx = await buildJupSwapTx(quote, pubkey.toBase58());
      setStep("signing_swap");
      const signed = await ph.signTransaction(swapTx);
      setStep("confirming_swap");
      const swapSig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: swapSig, blockhash, lastValidBlockHeight }, "confirmed");
      setTxs((t) => [...t, { label: "Jupiter swap (FDRY → SOL)", sig: swapSig }]);

      // 2. Symmetry buyVaultTx — use slippage-protected threshold to be safe
      setStep("signing_buy");
      const safeSol = Number(quote.otherAmountThreshold);
      const buyTx = await sdk.buyVaultTx({
        buyer: pubkey.toBase58(),
        vault_mint: vaultMint,
        contributions: [{ mint: WSOL, amount: safeSol }],
        rebalance_slippage_bps: 150,
        per_trade_rebalance_slippage_bps: 150,
      });
      const buySigs = await sdk.signAndSendTxPayloadBatchSequence({
        txPayloadBatchSequence: buyTx,
        wallet: walletForSdk,
      });
      buySigs.flat().forEach((s) => setTxs((t) => [...t, { label: "Symmetry buyVault", sig: s }]));

      // 3. Symmetry lockDepositsTx
      setStep("signing_lock");
      const lockTx = await sdk.lockDepositsTx({
        buyer: pubkey.toBase58(),
        vault_mint: vaultMint,
      });
      const lockSigs = await sdk.signAndSendTxPayloadBatchSequence({
        txPayloadBatchSequence: lockTx,
        wallet: walletForSdk,
      });
      lockSigs.flat().forEach((s) => setTxs((t) => [...t, { label: "Symmetry lockDeposits", sig: s }]));

      setStep("done_deposit");
    } catch (e) {
      const raw = (e as Error).message || String(e);
      setError(humanizeErr(raw));
      setStep("error");
    }
  };

  const withdrawToFdry = async () => {
    const ph = getPhantom();
    if (!ph || !pubkey) return;
    setError(null); setTxs([]);

    const shares = parseFloat(amount || "0");
    if (!shares || shares <= 0) return;

    const walletForSdk = {
      publicKey: pubkey,
      signTransaction: ph.signTransaction.bind(ph),
      signAllTransactions: ph.signAllTransactions.bind(ph),
    };

    try {
      setStep("signing_sell");
      // stFDRY has 6 decimals — withdraw_amount is raw share units
      const rawShares = Math.floor(shares * 1_000_000);
      const sellTx = await sdk.sellVaultTx({
        seller: pubkey.toBase58(),
        vault_mint: vaultMint,
        withdraw_amount: rawShares,
        keep_tokens: [], // swap everything back to SOL/USDC by default
        rebalance_slippage_bps: 150,
        per_trade_rebalance_slippage_bps: 150,
      });
      setStep("confirming_sell");
      const sellSigs = await sdk.signAndSendTxPayloadBatchSequence({
        txPayloadBatchSequence: sellTx,
        wallet: walletForSdk,
      });
      sellSigs.flat().forEach((s) => setTxs((t) => [...t, { label: "Symmetry sellVault", sig: s }]));
      setStep("done_withdraw");
    } catch (e) {
      const raw = (e as Error).message || String(e);
      setError(humanizeErr(raw));
      setStep("error");
    }
  };

  const shortAddr = (k: PublicKey | null) =>
    k ? `${k.toBase58().slice(0, 4)}…${k.toBase58().slice(-4)}` : "";

  const amt = parseFloat(amount || "0");
  const amtValid = amt > 0;
  const busy = step !== "idle" && step !== "done_deposit" && step !== "done_withdraw" && step !== "error";

  // Preview calculations
  const solFromQuote = quote ? Number(quote.outAmount) / LAMPORTS_PER_SOL : 0;
  const usdFromQuote = solFromQuote * solPriceUsd;
  const estSharesFromDeposit = navPerShareUsd > 0 && usdFromQuote > 0 ? usdFromQuote / navPerShareUsd : 0;
  const priceImpact = quote ? parseFloat(quote.priceImpactPct || "0") : 0;

  const depositBtnLabel =
    !pubkey ? "Connect wallet first"
      : !amtValid ? "Enter FDRY amount"
      : !quote ? (quoteErr ? "No Jupiter route" : "Fetching quote…")
      : step === "building" ? "Building swap…"
      : step === "signing_swap" ? "Sign swap in Phantom →"
      : step === "confirming_swap" ? "Confirming swap…"
      : step === "signing_buy" ? "Sign deposit in Phantom →"
      : step === "signing_lock" ? "Sign lock in Phantom →"
      : step === "done_deposit" ? "Deposit submitted ✓"
      : `Deposit ${amount} FDRY → stFDRY`;

  const withdrawBtnLabel =
    !pubkey ? "Connect wallet first"
      : !amtValid ? "Enter stFDRY amount"
      : step === "signing_sell" ? "Sign sell in Phantom →"
      : step === "confirming_sell" ? "Confirming sell…"
      : step === "done_withdraw" ? "Sell submitted ✓"
      : `Withdraw ${amount} stFDRY`;

  return (
    <div className="rounded-3xl border border-line bg-white p-6 md:p-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-ember font-medium mb-1">
            {mode === "deposit" ? "Deposit FDRY" : "Withdraw to FDRY"}
          </div>
          <h3 className="font-display text-xl md:text-2xl font-bold">Join the Genesis vault.</h3>
        </div>
        {pubkey ? (
          <button
            onClick={disconnect}
            className="text-xs px-3 py-1.5 rounded-full border border-line text-muted hover:bg-soft transition"
            type="button"
          >
            {shortAddr(pubkey)} · disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            className="text-xs px-3 py-1.5 rounded-full bg-molten text-white hover:opacity-95 transition"
            type="button"
          >
            Connect Phantom
          </button>
        )}
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-soft rounded-full mb-5 w-fit">
        {(["deposit", "withdraw"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setAmount(m === "deposit" ? "1000" : "1"); setTxs([]); setStep("idle"); setError(null); }}
            className={
              "px-4 py-1.5 text-xs font-mono uppercase rounded-full transition " +
              (mode === m ? "bg-white shadow-sm text-ink" : "text-muted hover:text-ink")
            }
            type="button"
          >
            {m}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-2xl border border-line bg-soft">
          <div className="flex items-baseline justify-between mb-2">
            <label className="text-xs text-muted block">
              Amount ({mode === "deposit" ? "FDRY" : "stFDRY"})
            </label>
            {pubkey && (
              <button
                onClick={() => {
                  const b = mode === "deposit" ? fdryBalance : stFdryBalance;
                  if (b != null) setAmount(b.toString());
                }}
                className="text-xs text-ember hover:underline"
                type="button"
              >
                max: {mode === "deposit"
                  ? (fdryBalance?.toLocaleString() ?? "—")
                  : (stFdryBalance?.toFixed(6) ?? "—")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 bg-transparent font-display text-2xl font-bold tabular-nums outline-none"
              placeholder={mode === "deposit" ? "1000" : "1"}
              disabled={busy}
            />
            {mode === "deposit" && (
              <div className="flex gap-1">
                {["100", "1000", "10000"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className="px-2 py-1 text-xs rounded-md border border-line text-muted hover:bg-white transition"
                    type="button"
                  >
                    {Number(v).toLocaleString()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        {mode === "deposit" && amtValid && (
          <div className="p-4 rounded-2xl border border-dashed border-line bg-white text-sm">
            {!quote ? (
              <div className="text-muted">
                {quoteErr ? `Jupiter: ${quoteErr}` : "Fetching Jupiter route…"}
              </div>
            ) : (
              <div className="space-y-1.5 font-mono text-xs">
                <Row label={`${amount} FDRY`} value="input" />
                <Row label={`→ ${solFromQuote.toFixed(4)} SOL`} value={`≈ $${usdFromQuote.toFixed(2)}`} />
                {estSharesFromDeposit > 0 && (
                  <Row label={`→ ${estSharesFromDeposit.toFixed(4)} stFDRY`} value="minted after keeper settles" />
                )}
                <div className="pt-2 mt-2 border-t border-line flex justify-between text-muted">
                  <span>Jupiter price impact</span>
                  <span className={priceImpact > 2 ? "text-red-600" : ""}>
                    {priceImpact.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Slippage tolerance</span>
                  <span>1.50%</span>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "withdraw" && amtValid && (
          <div className="p-4 rounded-2xl border border-dashed border-line bg-white text-sm">
            <div className="space-y-1.5 font-mono text-xs">
              <Row label={`${amount} stFDRY`} value="burn shares" />
              <Row
                label={`→ ≈ $${(amt * navPerShareUsd).toFixed(2)} worth of SOL + USDC`}
                value="paid pro-rata"
              />
              <div className="pt-2 mt-2 border-t border-line text-muted leading-relaxed text-[11px]">
                You'll sign <code className="bg-soft px-1 rounded">sellVaultTx</code>. The keeper settles the basket (~1h during Genesis, ~5 min after), SOL and USDC land in your wallet. To finish at FDRY, swap them on Jupiter after — we link you directly.
              </div>
            </div>
          </div>
        )}

        {/* SOL gas balance hint */}
        {pubkey && solBalance !== null && solBalance < 0.01 && (
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs">
            Your wallet has only {solBalance.toFixed(4)} SOL. You need ~0.01 SOL for gas across the signatures.
          </div>
        )}

        {/* Action button */}
        <button
          onClick={mode === "deposit" ? depositFromFdry : withdrawToFdry}
          disabled={
            !pubkey || !amtValid || busy ||
            (mode === "deposit" && !quote) ||
            (mode === "deposit" && fdryBalance !== null && amt > fdryBalance) ||
            (mode === "withdraw" && stFdryBalance !== null && amt > stFdryBalance)
          }
          className="w-full py-4 rounded-2xl bg-molten text-white font-display font-semibold text-lg shadow-lg shadow-ember/20 hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          type="button"
        >
          {mode === "deposit" ? depositBtnLabel : withdrawBtnLabel}
        </button>

        {/* Success/error panels */}
        {(step === "done_deposit" || step === "done_withdraw") && (
          <div className="p-4 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-900">
            <div className="font-semibold text-sm mb-2">
              {step === "done_deposit"
                ? "Deposit submitted. stFDRY mints to your wallet after the keeper processes the batch."
                : "Sell submitted. SOL + USDC will appear in your wallet once the keeper settles."}
            </div>
            <div className="text-xs space-y-1 font-mono">
              {txs.map((t) => (
                <div key={t.sig}>
                  {t.label}:{" "}
                  <a href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noopener" className="underline hover:text-emerald-700">
                    {t.sig.slice(0, 10)}…{t.sig.slice(-6)} ↗
                  </a>
                </div>
              ))}
            </div>
            {step === "done_withdraw" && pubkey && (
              <a
                href={`https://jup.ag/swap/SOL-${FDRY_MINT}`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 mt-3 px-3 py-1.5 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-xs font-medium hover:bg-emerald-50"
              >
                Swap SOL → FDRY on Jupiter ↗
              </a>
            )}
          </div>
        )}

        {step === "error" && error && (
          <div className="p-4 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-sm">
            <div className="font-semibold mb-1">{mode === "deposit" ? "Deposit" : "Withdraw"} failed.</div>
            <div className="font-mono text-xs break-words">{error}</div>
          </div>
        )}

        <p className="text-xs text-muted/80 leading-relaxed">
          {mode === "deposit" ? (
            <>You sign three txs: <span className="font-mono">Jupiter swap</span> (FDRY → SOL) · <span className="font-mono">Symmetry buy</span> · <span className="font-mono">Symmetry lock</span>. All atomic — if any fails, earlier ones revert cleanly. Operator cannot freeze funds.</>
          ) : (
            <>You sign one tx: <span className="font-mono">Symmetry sell</span>. The vault pays you SOL + USDC pro-rata once the keeper settles. Swap those to FDRY on Jupiter in one click — we deep-link you there.</>
          )}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink">{label}</span>
      <span className="text-muted">{value}</span>
    </div>
  );
}
