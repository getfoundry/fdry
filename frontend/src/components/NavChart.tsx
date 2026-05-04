import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  fetchNavHistory,
  loadCachedHistory,
  saveHistoryToCache,
  type NavSnapshot,
} from "../lib/navHistory";

const FDRY_DEFAULT = "FDRYinP7iYSpZFfasofUiGU4eNu4fkXS6CqSBfwJbonK";
const IDLE_AUTH_PDA_DEFAULT = "8gZQYGVbhmBcBE9V7AapDUyxF3S6vPLhcyyJSQ7TnGoE";
const RPC_DEFAULT = "https://solana-rpc.publicnode.com";

type Props = {
  vaultPubkey: string;
  lpMint: string;
  fdryMint?: string;
  idleAuthPda?: string;
  rpcUrl?: string;
};

function shortDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmt(n: number, dp = 6): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const p: NavSnapshot = payload[0].payload;
  return (
    <div className="rounded-xl border border-line bg-white p-3 font-mono text-xs shadow-sm">
      <div className="mb-1 text-muted">{longDate(p.ts)}</div>
      <div>
        <span className="text-muted">nav/share </span>
        <span className="text-[#FF6F00]">{fmt(p.navPerShare)}</span>
        <span className="text-muted"> fdry</span>
      </div>
      <div>
        <span className="text-muted">stfdry supply </span>
        <span>{fmt(p.stFdrySupply, 4)}</span>
      </div>
      <div>
        <span className="text-muted">vault fdry </span>
        <span>{fmt(p.navFdry, 4)}</span>
      </div>
      <div className="mt-1">
        <a
          className="text-[#FF6F00] underline"
          href={`https://solscan.io/tx/${p.sig}`}
          target="_blank"
          rel="noreferrer"
        >
          tx on solscan
        </a>
      </div>
    </div>
  );
}

export function NavChart(props: Props) {
  const {
    vaultPubkey,
    lpMint,
    fdryMint = FDRY_DEFAULT,
    idleAuthPda = IDLE_AUTH_PDA_DEFAULT,
    rpcUrl = RPC_DEFAULT,
  } = props;

  const [series, setSeries] = useState<NavSnapshot[]>(() => loadCachedHistory());
  const [loading, setLoading] = useState<boolean>(series.length === 0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lastSig = series.length ? series[series.length - 1].sig : undefined;
        const { series: fresh } = await fetchNavHistory(
          rpcUrl,
          vaultPubkey,
          lpMint,
          fdryMint,
          idleAuthPda,
          lastSig ? { sinceSig: lastSig } : undefined,
        );
        if (cancelled) return;
        const bySig = new Map<string, NavSnapshot>();
        for (const s of series) bySig.set(s.sig, s);
        for (const s of fresh) bySig.set(s.sig, s);
        const merged = Array.from(bySig.values()).sort((a, b) => a.ts - b.ts);
        setSeries(merged);
        saveHistoryToCache(merged);
      } catch {
        // swallow — cached view still renders
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPubkey, lpMint, fdryMint, idleAuthPda, rpcUrl]);

  const count = series.length;

  const body = useMemo(() => {
    if (loading && count === 0) {
      return (
        <div className="h-[260px] flex items-center justify-center text-muted text-sm font-mono">
          loading nav history…
        </div>
      );
    }
    if (count === 0) {
      return (
        <div className="h-[260px] flex items-center justify-center text-muted text-sm font-mono text-center px-6">
          vault is fresh. deposit, trade, whatever — line appears here once
          something moves onchain.
        </div>
      );
    }
    return (
      <>
        {count === 1 && (
          <div className="mb-2 font-mono text-xs text-muted">
            just 1 snapshot so far — the story begins here.
          </div>
        )}
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={series}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              stroke="#00000010"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="ts"
              tickFormatter={(ms: number) => shortDate(ms)}
              tick={{ fontFamily: "monospace", fontSize: 11, fill: "#666" }}
              axisLine={{ stroke: "#00000020" }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              dataKey="navPerShare"
              tickFormatter={(n: number) => n.toFixed(4)}
              domain={["auto", "auto"]}
              tick={{ fontFamily: "monospace", fontSize: 11, fill: "#666" }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="stepAfter"
              dataKey="navPerShare"
              stroke="#FF6F00"
              strokeWidth={2}
              dot={{ r: 3, fill: "#FF6F00" }}
              activeDot={{ r: 5, fill: "#FF6F00" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </>
    );
  }, [loading, count, series]);

  return (
    <div className="rounded-3xl border border-line bg-white p-6">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="font-display text-2xl lowercase">nav / share</h2>
        <div className="font-mono text-xs text-muted">[ {count} points ]</div>
      </div>
      {body}
    </div>
  );
}

export default NavChart;
