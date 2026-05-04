import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { computePortfolio, readLedger, PortfolioView } from "../lib/positionLedger";
import PortfolioChart from "./PortfolioChart";

type Props = {
  vaultPubkey: string;
  lpMint: string;
  assetSymbol: string;
  shareSymbol: string;
  assetDecimals: number;
  navPerShareInAsset: number;
  // Refresh-token bumped by parent on deposit/withdraw success so we recompute.
  refreshKey?: number;
};

const fmt = (n: number, d = 4) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
const pct = (n: number) =>
  Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%` : "—";
const fmtTs = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : "—");

export function PortfolioPanel({
  vaultPubkey,
  lpMint,
  assetSymbol,
  shareSymbol,
  assetDecimals,
  navPerShareInAsset,
  refreshKey = 0,
}: Props) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sharesOnChain, setSharesOnChain] = useState<number | null>(null);
  const [view, setView] = useState<PortfolioView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) { setSharesOnChain(null); setView(null); return; }
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const userLp = getAssociatedTokenAddressSync(
          new PublicKey(lpMint), publicKey, false, TOKEN_PROGRAM_ID,
        );
        const bal = await connection.getTokenAccountBalance(userLp).catch(() => null);
        const raw = bal?.value?.amount ? BigInt(bal.value.amount) : 0n;
        const decimals = bal?.value?.decimals ?? assetDecimals;
        const shares = Number(raw) / Math.pow(10, decimals);
        if (!alive) return;
        setSharesOnChain(shares);
        const ledger = readLedger(vaultPubkey, publicKey.toBase58());
        setView(computePortfolio(ledger, shares, navPerShareInAsset));
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    const id = setInterval(run, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [publicKey, connection, vaultPubkey, lpMint, assetDecimals, navPerShareInAsset, refreshKey]);

  if (!publicKey) {
    return (
      <div className="rounded-3xl border border-dashed border-line bg-soft p-6 text-sm text-muted">
        Connect a wallet to see your portfolio position in this vault.
      </div>
    );
  }

  if (loading && !view) {
    return (
      <div className="rounded-3xl border border-line bg-white p-6 text-sm text-muted">
        loading position…
      </div>
    );
  }

  const hasPosition = (sharesOnChain ?? 0) > 0;
  const pnl = view?.unrealizedPnlAsset ?? 0;
  const pnlPct = view?.unrealizedPnlPct ?? 0;
  const pnlTone = pnl > 0 ? "text-emerald-700" : pnl < 0 ? "text-red-700" : "text-muted";
  const pnlBg = pnl > 0 ? "bg-emerald-50 border-emerald-200"
              : pnl < 0 ? "bg-red-50 border-red-200"
              : "bg-soft border-line";

  return (
    <div className="rounded-3xl border border-line bg-white p-6">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-ember font-medium mb-1">// your position</div>
          <h3 className="font-display text-xl font-semibold">portfolio</h3>
        </div>
        <span className="text-xs text-muted font-mono">nav/share: {fmt(navPerShareInAsset, 6)} {assetSymbol}</span>
      </div>

      {!hasPosition ? (
        <div className="p-5 rounded-2xl border border-dashed border-line bg-soft text-sm text-muted">
          No {shareSymbol} held in this wallet for this vault yet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Cell label={`shares (${shareSymbol})`} value={fmt(sharesOnChain ?? 0, 6)} />
            <Cell label={`value (${assetSymbol})`} value={fmt(view?.positionValueAsset ?? 0, 4)} />
            <Cell label={`cost basis (${assetSymbol})`} value={fmt(view?.costBasisAsset ?? 0, 4)} sub="// tracked locally" />
            <Cell
              label="unrealized p&l"
              value={`${pnl >= 0 ? "+" : ""}${fmt(pnl, 4)} ${assetSymbol}`}
              sub={pct(pnlPct)}
              tone={pnlTone}
            />
          </div>

          <div className="mb-4 p-4 rounded-2xl border border-line bg-soft">
            <PortfolioChart
              vaultPubkey={vaultPubkey}
              navPerShareInAsset={navPerShareInAsset}
              assetSymbol={assetSymbol}
              refreshKey={refreshKey}
            />
          </div>
          <div className={`p-4 rounded-2xl border ${pnlBg} text-xs font-mono leading-relaxed`}>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>first deposit: <span className="text-ink">{fmtTs(view?.firstDepositTs ?? null)}</span></span>
              <span>deposits: <span className="text-ink">{view?.depositsCount ?? 0}</span></span>
              <span>withdrawals: <span className="text-ink">{view?.withdrawalsCount ?? 0}</span></span>
            </div>
            <div className="mt-2 text-muted">
              // cost-basis is local-only (no indexer). burning shares reduces it pro-rata. if u clear
              localStorage the history is gone but shares/value stay truthful from chain.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="p-4 rounded-2xl border border-line bg-soft">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className={`font-display text-lg font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
      {sub && <div className={`text-xs mt-0.5 tabular-nums ${tone ?? "text-muted"}`}>{sub}</div>}
    </div>
  );
}
