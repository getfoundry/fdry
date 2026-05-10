import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useWallet } from "@solana/wallet-adapter-react";
import { readLedger } from "../lib/positionLedger";

type Props = {
  vaultPubkey: string;
  navPerShareInAsset: number;
  assetSymbol: string;
  // Bumped by parent on deposit/withdraw success so we recompute.
  refreshKey?: number;
};

type Point = {
  ts: number;
  cumulativeShares: number;
  cumulativeCostBasis: number;
  markValue: number; // shares × live NAV (same for every row, for the trailing portion)
  pnl: number;
  kind: "deposit" | "withdraw" | "now";
};

function fmt(n: number, dp = 4): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Tip({ active, payload, assetSymbol }: { active?: boolean; payload?: Array<{ payload: Point }>; assetSymbol: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const pnlTone = p.pnl > 0 ? "text-emerald-700" : p.pnl < 0 ? "text-red-700" : "text-muted";
  return (
    <div className="rounded-xl border border-line bg-white p-3 font-mono text-xs shadow-sm">
      <div className="mb-1 text-muted">{new Date(p.ts).toLocaleString()}</div>
      <div>
        <span className="text-muted">event </span>
        <span className="uppercase">{p.kind}</span>
      </div>
      <div>
        <span className="text-muted">cost basis </span>
        <span>{fmt(p.cumulativeCostBasis)} {assetSymbol}</span>
      </div>
      <div>
        <span className="text-muted">mark value </span>
        <span>{fmt(p.markValue)} {assetSymbol}</span>
      </div>
      <div className={pnlTone}>
        <span className="text-muted">p&amp;l </span>
        <span>{p.pnl >= 0 ? "+" : ""}{fmt(p.pnl)} {assetSymbol}</span>
      </div>
    </div>
  );
}

export function PortfolioChart({ vaultPubkey, navPerShareInAsset, assetSymbol, refreshKey = 0 }: Props) {
  const { publicKey } = useWallet();
  const [tick, setTick] = useState(0);

  // Recompute on wallet / refreshKey change; also tick periodically to refresh "now" marker.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const data = useMemo<Point[]>(() => {
    if (!publicKey) return [];
    const ledger = readLedger(vaultPubkey, publicKey.toBase58());
    // Merge deposits + withdrawals into one chronologically-ordered event stream.
    type Ev = { ts: number; asset: number; shares: number; kind: "deposit" | "withdraw" };
    const events: Ev[] = [
      ...ledger.deposits.map((d) => ({ ...d, kind: "deposit" as const })),
      ...ledger.withdrawals.map((w) => ({ ...w, kind: "withdraw" as const })),
    ].sort((a, b) => a.ts - b.ts);

    if (events.length === 0) return [];

    let shares = 0;
    let costBasis = 0;
    const out: Point[] = [];
    for (const ev of events) {
      if (ev.kind === "deposit") {
        shares += ev.shares;
        costBasis += ev.asset;
      } else {
        // Reduce cost-basis pro-rata (same rule as recordWithdraw).
        const frac = shares > 0 ? Math.min(1, ev.shares / shares) : 1;
        costBasis = Math.max(0, costBasis * (1 - frac));
        shares = Math.max(0, shares - ev.shares);
      }
      const mark = shares * navPerShareInAsset;
      out.push({
        ts: ev.ts,
        cumulativeShares: shares,
        cumulativeCostBasis: costBasis,
        markValue: mark,
        pnl: mark - costBasis,
        kind: ev.kind,
      });
    }
    // Pin a "now" point so the mark-value line stretches to the current moment.
    const nowMark = shares * navPerShareInAsset;
    out.push({
      ts: Date.now(),
      cumulativeShares: shares,
      cumulativeCostBasis: costBasis,
      markValue: nowMark,
      pnl: nowMark - costBasis,
      kind: "now",
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, vaultPubkey, navPerShareInAsset, refreshKey, tick]);

  if (!publicKey) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-soft p-8 text-center text-sm text-muted">
        Connect a wallet to see your position over time.
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-soft p-8 text-center text-sm text-muted">
        No deposits recorded for this wallet yet. Your first deposit will seed this chart.
      </div>
    );
  }

  const last = data[data.length - 1];
  const totalPnl = last.pnl;
  const pnlPct = last.cumulativeCostBasis > 0 ? last.pnl / last.cumulativeCostBasis : 0;
  const pnlTone = totalPnl > 0 ? "text-emerald-700" : totalPnl < 0 ? "text-red-700" : "text-muted";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-xs text-muted font-mono lowercase">
          // {data.length - 1} event{data.length - 1 === 1 ? "" : "s"} · mark vs cost-basis
        </div>
        <div className={`text-sm font-mono tabular-nums ${pnlTone}`}>
          {totalPnl >= 0 ? "+" : ""}{fmt(totalPnl, 4)} {assetSymbol} ({(pnlPct * 100).toFixed(2)}%)
        </div>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="markFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF6F00" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#FF6F00" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="#eee" />
            <XAxis
              dataKey="ts"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={shortDate}
              stroke="#999"
              fontSize={11}
            />
            <YAxis
              stroke="#999"
              fontSize={11}
              tickFormatter={(n: number) => fmt(n, 2)}
              width={60}
            />
            <Tooltip content={<Tip assetSymbol={assetSymbol} />} />
            <ReferenceLine
              y={last.cumulativeCostBasis}
              stroke="#888"
              strokeDasharray="3 3"
              label={{ value: "cost basis", position: "insideTopRight", fill: "#666", fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="markValue"
              stroke="#FF6F00"
              strokeWidth={2}
              fill="url(#markFill)"
              dot={{ r: 3, fill: "#FF6F00" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default PortfolioChart;
