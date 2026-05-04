import { useEffect, useState } from "react";
import { UnderdogEquityChart } from "./UnderdogEquityChart";

const API = "https://voltr.getfoundry.app/api/naut";

type Health = {
  ok: boolean;
  strategy?: string;
  last_cycle_t?: string;
  n_cycles?: number;
  n_errors?: number;
};

type Stats = {
  include_backfill: boolean;
  n_resolved: number;
  hit_rate: number;
  total_bp: number;
  profit_factor: number;
};

type StrategyPosition = {
  long?: string;
  short?: string;
  mark_pnl_bp?: number;
  bars_remaining?: number;
  holding?: boolean;
};

type Fire = {
  t?: string;
  long?: string;
  short?: string;
  tf?: string;
  pair_bp_net?: number;
  hit?: boolean;
  exit_reason?: string;
};

type Snapshot = {
  health: Health | null;
  stats: Stats | null;
  positions: Record<string, StrategyPosition>;
  brokerPositions: unknown[];
  fires: Fire[];
  error: string | null;
};

// Sizing: $5k / leg × 2 = $10k pair notional → 1 bp on pair = $1 P&L
const USD_PER_BP = 1.0;

const fmtBp = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? `${n >= 0 ? "+" : ""}${n.toFixed(1)} bp`
    : "...";

const fmtUsd = (n: number | undefined) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "...";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

const fmtBpUsd = (n: number | undefined) =>
  fmtUsd(typeof n === "number" ? n * USD_PER_BP : undefined);

const fmtPct = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n)
    ? `${(n * 100).toFixed(1)}%`
    : "...";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export function StrategyLivePanel() {
  const [snap, setSnap] = useState<Snapshot>({
    health: null,
    stats: null,
    positions: {},
    brokerPositions: [],
    fires: [],
    error: null,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [health, stats, positions, broker, fires] = await Promise.all([
          getJson<Health>("/health"),
          getJson<Stats>("/stats?include_backfill=0"),
          getJson<Record<string, StrategyPosition>>("/positions"),
          getJson<{ positions?: unknown[] }>("/positions/live"),
          getJson<{ fires?: Fire[] }>("/fires?include_backfill=0&limit=5"),
        ]);
        if (!alive) return;
        setSnap({
          health,
          stats,
          positions,
          brokerPositions: broker.positions ?? [],
          fires: fires.fires ?? [],
          error: null,
        });
      } catch (e) {
        if (!alive) return;
        setSnap((s) => ({ ...s, error: (e as Error).message }));
      }
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const openStrategy = Object.entries(snap.positions).filter(
    ([, p]) => p.holding,
  );
  const hasBrokerPositions = snap.brokerPositions.length > 0;

  return (
    <section className="rounded-3xl border-2 border-ember/30 bg-white p-6 md:p-8 mb-10">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-xs font-mono text-ember uppercase tracking-wider mb-3">
            // underdog feed
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-3 lowercase">
            we bet on underdogs.
          </h2>
          <p className="text-sm md:text-base text-muted leading-relaxed max-w-3xl">
            Long the most beaten-down token, short the one the crowd has
            already crowned. Every closed pair below is a real fire from the
            live service — backfilled history is excluded so the numbers can
            only get better by trading well.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${snap.health?.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${snap.health?.ok ? "bg-emerald-500" : "bg-red-500"}`}
          ></span>
          {snap.health?.ok ? "service live" : "service unavailable"}
        </span>
      </div>

      {snap.error && (
        <div className="mb-5 p-4 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-sm font-mono">
          {snap.error}
        </div>
      )}

      <UnderdogEquityChart />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <LiveStat
          label="closed live fires"
          value={snap.stats ? String(snap.stats.n_resolved) : "..."}
          sub="backfill excluded"
        />
        <LiveStat
          label="live $ p&l"
          value={fmtBpUsd(snap.stats?.total_bp)}
          sub={`${fmtBp(snap.stats?.total_bp)} · hit ${fmtPct(snap.stats?.hit_rate)}`}
        />
        <LiveStat
          label="profit factor"
          value={
            typeof snap.stats?.profit_factor === "number"
              ? `${snap.stats.profit_factor.toFixed(2)}x`
              : "..."
          }
          sub="live only"
        />
        <LiveStat
          label="broker positions"
          value={String(snap.brokerPositions.length)}
          sub={
            hasBrokerPositions
              ? "bridge reports open risk"
              : "no open broker risk"
          }
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-line bg-soft p-5">
          <h3 className="font-display font-semibold mb-3 lowercase">
            current strategy state
          </h3>
          {openStrategy.length === 0 ? (
            <p className="text-sm text-muted font-mono">
              no strategy position reported right now.
            </p>
          ) : (
            <div className="space-y-3">
              {openStrategy.map(([leg, p]) => (
                <div
                  key={leg}
                  className="rounded-xl border border-line bg-white p-4 text-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs text-muted">{leg}</span>
                    <div className="text-right">
                      <div
                        className={
                          (p.mark_pnl_bp ?? 0) >= 0
                            ? "text-emerald-700"
                            : "text-red-700"
                        }
                      >
                        {fmtBpUsd(p.mark_pnl_bp)}
                      </div>
                      <div className="text-[10px] text-muted">
                        {fmtBp(p.mark_pnl_bp)}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono">
                    long {p.long ?? "..."} / short {p.short ?? "..."}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    bars remaining: {p.bars_remaining ?? "..."}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-soft p-5">
          <h3 className="font-display font-semibold mb-3 lowercase">
            recent live closes
          </h3>
          {snap.fires.length === 0 ? (
            <p className="text-sm text-muted font-mono">no live closes yet.</p>
          ) : (
            <div className="space-y-2">
              {snap.fires
                .slice(-4)
                .reverse()
                .map((f, i) => (
                  <div
                    key={`${f.t}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white border border-line p-3 text-xs font-mono"
                  >
                    <span className="min-w-0 truncate">
                      {f.tf ?? "?"}: {f.long ?? "..."} / {f.short ?? "..."}
                    </span>
                    <span
                      className={
                        (f.pair_bp_net ?? 0) >= 0
                          ? "text-emerald-700"
                          : "text-red-700"
                      }
                    >
                      {fmtBpUsd(f.pair_bp_net)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted mt-5 font-mono lowercase">
        // sizing: $100k bankroll · $5k/leg · $10k pair notional · 1 bp = $1.
        src: voltr.getfoundry.app/api/naut · live-only fires, backfill
        excluded.
      </p>
    </section>
  );
}

function LiveStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="p-4 rounded-2xl border border-line bg-soft">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
        {label}
      </div>
      <div className="font-display text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted mt-1">{sub}</div>
    </div>
  );
}
