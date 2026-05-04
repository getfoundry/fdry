import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

const API = "https://voltr.getfoundry.app/api/naut";
// Bust browser cache when the JSON shape changes (cum→equity, etc).
const BACKTEST_URL = "/backtest_smyrna_4h.json?v=3";

// Portfolio sizing
const BANKROLL_START = 100_000; // $
// Live segment: 1 bp on the $10k pair notional VM is currently running = $1.
// Backtest segment: pair_notional varies per fire (dynamic Kelly), so the
// equity curve comes pre-computed in the JSON.
const LIVE_USD_PER_BP = 1.0;

type Fire = {
  t?: string | null;
  pair_bp_net?: number;
  pnl_usd?: number;
  pair_notional_usd?: number;
  frac?: number;
  hit?: boolean;
  exit_reason?: string;
};

type BacktestFire = {
  t: string;
  bp: number;
  frac: number;
  pair_notional: number;
  pnl_usd: number;
  equity: number;
  f_kelly_running: number | null;
};

type BacktestPayload = {
  name: string;
  sizing: string;
  sizing_params: {
    kelly_multiplier: number;
    warmup_n: number;
    warmup_default_frac: number;
    floor: number;
    ceil: number;
  };
  bankroll_start: number;
  window_days: number;
  n: number;
  final_equity: number;
  final_equity_fixed_10pct?: number;
  fires: BacktestFire[];
};

type Point = {
  idx: number;
  ts: number | null;
  equity_backtest: number | null;
  equity_live: number | null;
  phase: "backtest" | "live";
};

function fmtUsd(n: number | null | undefined, opts?: { signed?: boolean }) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `$${(n / 1_000_000).toFixed(2)}M`;
  else if (abs >= 10_000) body = `$${(n / 1000).toFixed(1)}k`;
  else if (abs >= 1000) body = `$${(n / 1000).toFixed(2)}k`;
  else body = `$${n.toFixed(0)}`;
  if (opts?.signed && n > 0) return `+${body}`;
  return body;
}

function fmtPct(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function fmtTs(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const p: Point | undefined = payload[0]?.payload;
  if (!p) return null;
  const value = p.phase === "backtest" ? p.equity_backtest : p.equity_live;
  const pct =
    typeof value === "number"
      ? (value - BANKROLL_START) / BANKROLL_START
      : null;
  return (
    <div className="rounded-xl border border-line bg-white p-3 font-mono text-xs shadow-sm">
      <div className="mb-1 text-muted">{fmtTs(p.ts)}</div>
      <div>
        <span className="text-muted">equity </span>
        <span
          className={
            typeof value === "number" && value >= BANKROLL_START
              ? "text-emerald-700"
              : "text-red-700"
          }
        >
          {fmtUsd(value)}
        </span>
        <span className="text-muted ml-1">({fmtPct(pct)})</span>
      </div>
      <div className="text-muted text-[10px] uppercase tracking-wider mt-1">
        {p.phase === "backtest" ? "40d backtest replay" : "live paper"}
      </div>
    </div>
  );
}

export function UnderdogEquityChart() {
  const [backtest, setBacktest] = useState<BacktestPayload | null>(null);
  const [fires, setFires] = useState<Fire[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(BACKTEST_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBacktest(d))
      .catch(() => setBacktest(null));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`${API}/fires?include_backfill=0&limit=1000`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`fires ${res.status}`);
        const data = await res.json();
        if (!alive) return;
        setFires((data.fires ?? []) as Fire[]);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const {
    points,
    transitionIdx,
    liveCount,
    backtestEndEquity,
    liveEquity,
  } = useMemo(() => {
    const bt = backtest?.fires ?? [];
    const liveSorted = (fires ?? [])
      .filter(
        (f) =>
          typeof f.pair_bp_net === "number" && Number.isFinite(f.pair_bp_net),
      )
      .sort((a, b) => {
        const aT = a.t ? Date.parse(a.t) : 0;
        const bT = b.t ? Date.parse(b.t) : 0;
        return aT - bT;
      });

    const pts: Point[] = [];
    let i = 0;
    let equity = BANKROLL_START;
    for (const r of bt) {
      equity = r.equity;
      pts.push({
        idx: i++,
        ts: r.t ? Date.parse(r.t) : null,
        equity_backtest: equity,
        equity_live: null,
        phase: "backtest",
      });
    }
    const btEnd = equity;

    const transition = pts.length;
    if (pts.length > 0 && liveSorted.length > 0) {
      pts[pts.length - 1].equity_live = btEnd;
    }
    let liveEq = btEnd;
    for (const f of liveSorted) {
      // Live segment uses the actual VM sizing ($10k pair notional = fixed,
      // not yet Kelly). 1 bp on $10k pair = $1 P&L. When the VM moves to
      // dynamic Kelly, this becomes f.pnl_usd from the API.
      // Prefer pnl_usd from the API (computed at close-time using the
      // Kelly-sized pair notional). Fall back to bp × $1 for any pre-Kelly
      // fires where the field is missing.
      const pnl =
        typeof f.pnl_usd === "number" && Number.isFinite(f.pnl_usd)
          ? f.pnl_usd
          : Number(f.pair_bp_net ?? 0) * LIVE_USD_PER_BP;
      liveEq += pnl;
      pts.push({
        idx: i++,
        ts: f.t ? Date.parse(f.t) : null,
        equity_backtest: null,
        equity_live: liveEq,
        phase: "live",
      });
    }

    return {
      points: pts,
      transitionIdx: liveSorted.length > 0 ? transition - 1 : -1,
      liveCount: liveSorted.length,
      backtestEndEquity: btEnd,
      liveEquity: liveEq,
    };
  }, [backtest, fires]);

  const hasBacktest = (backtest?.fires?.length ?? 0) > 0;
  const currentEquity = liveCount > 0 ? liveEquity : backtestEndEquity;
  const totalReturn = (currentEquity - BANKROLL_START) / BANKROLL_START;
  const liveDelta = liveEquity - backtestEndEquity;

  // Y-axis: floor at $0, give breathing room above the curve.
  const minEquity = Math.min(
    BANKROLL_START,
    ...points.map((p) =>
      Math.min(
        p.equity_backtest ?? Infinity,
        p.equity_live ?? Infinity,
      ),
    ),
  );
  const maxEquity = Math.max(
    BANKROLL_START,
    ...points.map((p) =>
      Math.max(
        p.equity_backtest ?? -Infinity,
        p.equity_live ?? -Infinity,
      ),
    ),
  );
  const yPad = (maxEquity - minEquity) * 0.08 || BANKROLL_START * 0.05;

  return (
    <div className="rounded-2xl border border-line bg-soft p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display font-semibold lowercase mb-1">
            $100k portfolio · backtest → live
          </h3>
          <p className="text-xs text-muted font-mono">
            $100k bankroll, dynamic quarter-Kelly sizing per fire (no
            lookahead, recomputed each fire from history). gray = 40d offline
            replay (174 fires), ember = live closes since cutover.
          </p>
        </div>
        <div className="text-right text-xs font-mono shrink-0 space-y-0.5">
          <div className="text-muted">portfolio</div>
          <div
            className={`text-2xl font-display tabular-nums ${
              currentEquity >= BANKROLL_START
                ? "text-emerald-700"
                : "text-red-700"
            }`}
          >
            {fmtUsd(currentEquity)}
          </div>
          <div className="text-muted text-[10px]">
            {fmtPct(totalReturn)} from $100k
          </div>
          {liveCount > 0 && (
            <div
              className={`text-[10px] mt-1 ${
                liveDelta >= 0 ? "text-emerald-700" : "text-red-700"
              }`}
            >
              live ({liveCount}): {fmtUsd(liveDelta, { signed: true })}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-mono mb-3">
          {error}
        </div>
      )}

      {!hasBacktest && fires === null ? (
        <div className="rounded-xl border border-line bg-white p-6 text-center text-sm text-muted font-mono">
          loading…
        </div>
      ) : (
        <div className="h-72 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid
                stroke="#e5e7eb"
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="idx"
                stroke="#9ca3af"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => {
                  if (v === 0) return "40d ago";
                  if (v === transitionIdx) return "live →";
                  if (v === points.length - 1 && transitionIdx >= 0) return "now";
                  return "";
                }}
              />
              <YAxis
                stroke="#9ca3af"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => fmtUsd(v)}
                domain={[minEquity - yPad, maxEquity + yPad]}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine
                y={BANKROLL_START}
                stroke="#9ca3af"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
                label={{
                  value: "$100k start",
                  position: "left",
                  fill: "#6b7280",
                  fontSize: 9,
                }}
              />
              {transitionIdx > 0 && (
                <ReferenceLine
                  x={transitionIdx}
                  stroke="#f97316"
                  strokeDasharray="3 3"
                  strokeOpacity={0.4}
                />
              )}
              {points.some((p) => p.equity_backtest !== null) && (
                <Line
                  type="monotone"
                  dataKey="equity_backtest"
                  stroke="#9ca3af"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
              {liveCount > 0 && (
                <Line
                  type="monotone"
                  dataKey="equity_live"
                  stroke="#f97316"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="text-[10px] text-muted mt-3 font-mono lowercase">
        // sizing rule (both backtest + live vm): pair_notional = clip(0.25 ×
        kelly(history), floor=5%, ceil=25%) × current_equity, warmup=20
        fires at 10%. live $ p&l comes from the api (pnl_usd computed at
        close using the kelly-sized pair). backtest src:
        notebooks/output/social_cluster_smyrna_2026-05-04 · live src:
        /api/naut/fires
      </p>
    </div>
  );
}
