import { useEffect, useMemo, useState } from "react";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VoltrClient } from "@voltr/vault-sdk";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { recordDeposit, recordWithdraw } from "../lib/positionLedger";
import {
  buildDepositVaultIxs,
  buildInstantWithdrawVaultIxs,
  decimalAmountToBaseUnits,
} from "../lib/voltrUserClient";

const FDRY_MINT = "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL";
const FDRY_DECIMALS = 9;
// FDRY is classic SPL Token (verified in scripts/seedRangerFdryVault.ts) — hardcoded to skip a round-trip.
const ASSET_TOKEN_PROGRAM = TOKEN_PROGRAM_ID;

type Mode = "deposit" | "withdraw";
type Step =
  | "idle"
  | "connecting"
  | "building"
  | "signing"
  | "confirming"
  | "done_deposit"
  | "done_withdraw"
  | "error";

type Props = {
  vaultMint: string;    // LP / share mint (e.g. stFDRY-v2)
  vaultPubkey: string;  // Voltr vault pubkey
  // Asset this vault accepts. Defaults to FDRY for backwards-compat with the
  // canonical treasury page; other vaults (USDC, SOL, etc.) pass their own.
  assetMint?: string;
  assetDecimals?: number;
  assetSymbol?: string;       // e.g. "FDRY", "USDC"
  shareSymbol?: string;       // e.g. "stFDRY", "vUSDC"
  navPerShareInFdry?: number; // UI preview fallback; 1.0 at launch
  onPositionChange?: () => void; // fires after a successful deposit or withdraw
};

export function DepositWidget({
  vaultMint,
  vaultPubkey,
  assetMint,
  assetDecimals,
  assetSymbol,
  shareSymbol,
  navPerShareInFdry = 1,
  onPositionChange,
}: Props) {
  const fdryMint = assetMint ?? FDRY_MINT;
  const assetDecs = assetDecimals ?? FDRY_DECIMALS;
  const assetSym = assetSymbol ?? "FDRY";
  const shareSym = shareSymbol ?? "stFDRY";
  const [mode, setMode] = useState<Mode>("deposit");
  const { publicKey, signTransaction, disconnect: walletDisconnect } = useWallet();
  const { connection } = useConnection();
  const pubkey = publicKey;
  const [fdryBalance, setFdryBalance] = useState<number | null>(null);
  const [stFdryBalance, setStFdryBalance] = useState<number | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  const [amount, setAmount] = useState("1000");

  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txs, setTxs] = useState<Array<{ label: string; sig: string }>>([]);
  const [liveNav, setLiveNav] = useState<number | null>(null);

  const client = useMemo(() => new VoltrClient(connection), [connection]);

  const vaultPk = useMemo(() => new PublicKey(vaultPubkey), [vaultPubkey]);
  const vaultAssetMintPk = useMemo(() => new PublicKey(fdryMint), [fdryMint]);
  const lpMintPk = useMemo(() => new PublicKey(vaultMint), [vaultMint]);

  // Live NAV fetcher: totalFdry / lpSupply (base units, returns decimal)
  const fetchNav = async (): Promise<number | null> => {
    try {
      const vaultAssetIdleAuth = client.findVaultAssetIdleAuth(vaultPk);
      const vaultFdryAta = getAssociatedTokenAddressSync(
        vaultAssetMintPk, vaultAssetIdleAuth, true, ASSET_TOKEN_PROGRAM,
      );
      const [idleRes, supplyRes] = await Promise.all([
        connection.getTokenAccountBalance(vaultFdryAta).catch(() => null),
        connection.getTokenSupply(lpMintPk).catch(() => null),
      ]);
      const idleRaw = idleRes?.value?.amount ? BigInt(idleRes.value.amount) : 0n;
      const supplyRaw = supplyRes?.value?.amount ? BigInt(supplyRes.value.amount) : 0n;
      if (supplyRaw === 0n) return 1;
      // Asset and LP share the same decimals for this vault pattern, so the ratio is dimensionless.
      return Number(idleRaw) / Number(supplyRaw);
    } catch { return null; }
  };

  // Fetch NAV on mount and when vault changes
  useEffect(() => {
    let alive = true;
    fetchNav().then((n) => { if (alive && n != null) setLiveNav(n); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPubkey, fdryMint, vaultMint]);

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
            programId: TOKEN_PROGRAM_ID,
          }),
        ]);
        if (!alive) return;
        setSolBalance(sol / LAMPORTS_PER_SOL);
        let fdry = 0, stfdry = 0;
        for (const { account } of tokens.value) {
          const info = (account.data as { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } }).parsed.info;
          if (info.mint === fdryMint) fdry = info.tokenAmount.uiAmount ?? 0;
          if (info.mint === vaultMint) stfdry = info.tokenAmount.uiAmount ?? 0;
        }
        setFdryBalance(fdry);
        setStFdryBalance(stfdry);
      } catch { /* ignore */ }
    };
    load();
    const i = setInterval(load, 12_000);
    return () => { alive = false; clearInterval(i); };
  }, [pubkey, connection, vaultMint, fdryMint]);

  const disconnect = async () => {
    try { await walletDisconnect(); } catch { /* ignore */ }
    setTxs([]); setStep("idle");
  };

  const humanizeErr = (raw: string): string => {
    if (/0xbc4|custom.*3012|AccountNotInitialized/i.test(raw)) {
      return "LP account not created — try again (idempotent-create may have been skipped).";
    }
    if (/custom.*6015|InstantWithdrawNotAllowed/i.test(raw)) {
      return "Instant withdraw is disabled for this vault (shouldn't happen — contact team).";
    }
    if (/insufficient.*lamports|Transfer:.*insufficient/i.test(raw)) {
      return "Insufficient SOL in wallet for gas (~0.005 SOL needed).";
    }
    if (/insufficient funds/i.test(raw)) return "Insufficient token balance.";
    if (/User rejected|cancelled/i.test(raw)) return "You cancelled the signature.";
    if (/blockhash.*not found|Blockhash|block height exceeded/i.test(raw)) {
      return "Transaction expired. Try again.";
    }
    if (/custom.*6006|MaxCapExceeded|0x1776/i.test(raw)) {
      return "Vault is full — the max cap is reached. Ask the admin to raise max_cap via update_vault_config.";
    }
    if (/custom.*6000(?!\d)|InvalidAmount|0x1770(?!\d)/i.test(raw)) {
      return "Invalid amount — too small (dust) or otherwise rejected by the vault. Try a larger whole number.";
    }
    if (/custom.*6007|VaultNotActive|0x1777/i.test(raw)) {
      return `Vault is paused. Check back shortly; no ${assetSym} was taken.`;
    }
    const customMatch = raw.match(/custom program error:\s*(0x[0-9a-fA-F]+|\d+)/);
    if (customMatch) return `Program error ${customMatch[1]}. ${raw.slice(0, 160)}`;
    return raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
  };

  const sendAndConfirm = async (
    instructions: import("@solana/web3.js").TransactionInstruction[],
    label: string,
  ): Promise<string> => {
    if (!pubkey || !signTransaction) throw new Error("Connect wallet first");
    // The builder owns Voltr-specific setup ixs. This function only compiles,
    // asks the wallet to sign, submits, and confirms.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: pubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    setStep("signing");
    const signed = await signTransaction(tx);
    setStep("confirming");
    const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
    // Recovery trail — if confirm hangs, user still has the signature.
    console.log(`[${label}] sent:`, sig, `https://solscan.io/tx/${sig}`);
    setTxs((t) => [...t, { label, sig }]);

    // Confirm with a hard 90s timeout so the UI cannot hang forever.
    const confirmPromise = connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Confirmation timed out after 90s. Your tx may still land — check solscan with the signature above.")), 90_000),
    );
    await Promise.race([confirmPromise, timeout]);
    return sig;
  };

  const reloadBalances = async () => {
    if (!pubkey) return;
    try {
      const tokens = await connection.getParsedTokenAccountsByOwner(pubkey, {
        programId: TOKEN_PROGRAM_ID,
      });
      let fdry = 0, stfdry = 0;
      for (const { account } of tokens.value) {
        const info = (account.data as { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } }).parsed.info;
        if (info.mint === fdryMint) fdry = info.tokenAmount.uiAmount ?? 0;
        if (info.mint === vaultMint) stfdry = info.tokenAmount.uiAmount ?? 0;
      }
      setFdryBalance(fdry);
      setStFdryBalance(stfdry);
    } catch { /* ignore */ }
  };

  const depositFromFdry = async () => {
    if (!publicKey || !signTransaction || !pubkey) return;
    const amt = parseFloat(amount || "0");
    if (!amt || amt <= 0) return;
    setError(null); setTxs([]);

    try {
      setStep("building");
      const ixs = await buildDepositVaultIxs({
        client,
        payer: pubkey,
        vault: vaultPk,
        vaultAssetMint: vaultAssetMintPk,
        lpMint: lpMintPk,
        assetTokenProgram: ASSET_TOKEN_PROGRAM,
        amountBaseUnits: decimalAmountToBaseUnits(amount, assetDecs),
      });

      await sendAndConfirm(ixs, "Voltr deposit");

      setStep("done_deposit");
      // Cost-basis tally: asset deposited, shares minted (preview estimate).
      const navNow = (await fetchNav()) ?? liveNav ?? 1;
      if (navNow != null) setLiveNav(navNow);
      const sharesMinted = navNow > 0 ? amt / navNow : amt;
      recordDeposit(vaultPubkey, pubkey.toBase58(), amt, sharesMinted);
      onPositionChange?.();
      await reloadBalances();
    } catch (e) {
      const raw = (e as Error).message || String(e);
      setError(humanizeErr(raw));
      setStep("error");
    }
  };

  const withdrawToFdry = async () => {
    if (!publicKey || !signTransaction || !pubkey) return;
    setError(null); setTxs([]);

    const shares = parseFloat(amount || "0");
    if (!shares || shares <= 0) return;

    // Preflight: does the user have any shares to burn? (Book 1: never-deposited UX)
    try {
      const userLpAtaCheck = getAssociatedTokenAddressSync(
        lpMintPk, pubkey, false, TOKEN_PROGRAM_ID,
      );
      const bal = await connection.getTokenAccountBalance(userLpAtaCheck);
      const raw = bal?.value?.amount ? BigInt(bal.value.amount) : 0n;
      if (raw === 0n) {
        setError(`You have no ${shareSym} to withdraw. Deposit first.`);
        setStep("error");
        return;
      }
    } catch {
      // AccountNotFound → LP ATA doesn't exist yet.
      setError(`You have no ${shareSym} to withdraw. Deposit first.`);
      setStep("error");
      return;
    }


    try {
      setStep("building");
      const ixs = await buildInstantWithdrawVaultIxs({
        client,
        payer: pubkey,
        vault: vaultPk,
        vaultAssetMint: vaultAssetMintPk,
        assetTokenProgram: ASSET_TOKEN_PROGRAM,
        shareAmountBaseUnits: decimalAmountToBaseUnits(amount, assetDecs),
      });

      await sendAndConfirm(ixs, `Voltr instant withdraw → ${assetSym}`);

      setStep("done_withdraw");
      const navNow = (await fetchNav()) ?? liveNav ?? 1;
      if (navNow != null) setLiveNav(navNow);
      const assetOut = shares * navNow;
      recordWithdraw(vaultPubkey, pubkey.toBase58(), assetOut, shares);
      onPositionChange?.();
      await reloadBalances();
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

  // Use live NAV if loaded; fall back to prop (for stories/tests) or 1.0.
  const effNav = liveNav != null ? liveNav : (navPerShareInFdry ?? 1);
  const estSharesFromDeposit = effNav > 0 ? amt / effNav : 0;
  const estFdryFromWithdraw = amt * effNav;

  const depositBtnLabel =
    !pubkey ? "Connect wallet first"
      : !amtValid ? `Enter ${assetSym} amount`
      : step === "building" ? "Preparing deposit…"
      : step === "signing" ? "Sign in wallet →"
      : step === "confirming" ? "Confirming…"
      : step === "done_deposit" ? "Deposit submitted ✓"
      : `Deposit ${amount} ${assetSym} → ${shareSym}`;

  const withdrawBtnLabel =
    !pubkey ? "Connect wallet first"
      : !amtValid ? `Enter ${shareSym} amount`
      : step === "building" ? "Preparing withdraw…"
      : step === "signing" ? "Sign in wallet →"
      : step === "confirming" ? "Confirming…"
      : step === "done_withdraw" ? "Withdraw submitted ✓"
      : `Burn ${amount} ${shareSym} → ${assetSym}`;

  return (
    <div className="rounded-3xl border border-line bg-white p-6 md:p-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-ember font-medium mb-1">
            {mode === "deposit" ? `Deposit ${assetSym}` : "Instant withdraw"}
          </div>
          <h3 className="font-display text-xl md:text-2xl font-bold">Stake {assetSym}. Mint {shareSym}.</h3>
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
          <WalletMultiButton className="!text-xs !px-3 !py-1.5 !h-auto !rounded-full !bg-molten !text-white hover:!opacity-95 !font-sans !leading-none" />
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
              Amount ({mode === "deposit" ? assetSym : shareSym})
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
            <div className="space-y-1.5 font-mono text-xs">
              <Row label={`${amount} ${assetSym} in`} value="direct to vault" />
              {estSharesFromDeposit > 0 && (
                <Row label={`→ ≈ ${estSharesFromDeposit.toFixed(4)} ${shareSym}`} value="minted this block" />
              )}
              <div className="text-muted text-[11px] leading-relaxed pt-2 mt-2 border-t border-line">
                Single tx. Your {assetSym} goes directly into the {shareSym} vault. No keeper, no basket.
              </div>
            </div>
          </div>
        )}

        {mode === "withdraw" && amtValid && (
          <div className="p-4 rounded-2xl border border-dashed border-line bg-white text-sm">
            <div className="space-y-1.5 font-mono text-xs">
              <Row label={`Burn ${amount} ${shareSym}`} value="single tx" />
              <Row label={`→ ≈ ${estFdryFromWithdraw.toFixed(4)} ${assetSym}`} value="paid instantly" />
              <div className="pt-2 mt-2 border-t border-line text-muted leading-relaxed text-[11px]">
                The vault pays {assetSym} pro-rata instantly. No swap needed.
              </div>
            </div>
          </div>
        )}

        {/* SOL gas balance hint */}
        {pubkey && solBalance !== null && solBalance < 0.005 && (
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs">
            Your wallet has only {solBalance.toFixed(4)} SOL. You need ~0.005 SOL for gas.
          </div>
        )}

        {/* Action button */}
        <button
          onClick={mode === "deposit" ? depositFromFdry : withdrawToFdry}
          disabled={
            !pubkey || !amtValid || busy ||
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
                ? `Deposit confirmed. ${shareSym} is in your wallet.`
                : `Withdraw confirmed. ${assetSym} is in your wallet.`}
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
            <>You sign one tx: <span className="font-mono">Voltr deposit</span>. {assetSym} in, {shareSym} out — same block.</>
          ) : (
            <>You sign one tx: <span className="font-mono">Voltr instant withdraw</span>. {shareSym} burns, {assetSym} arrives — same block.</>
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
