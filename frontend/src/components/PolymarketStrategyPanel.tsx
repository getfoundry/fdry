import { useEffect, useMemo, useState } from "react";

const POLYMARKET_WALLET = "0x86342c22D07d56eC456b965031ffA3774e111B5b";
const POLYMARKET_PROFILE_URL = `https://polymarket.com/profile/${POLYMARKET_WALLET}?tab=positions`;
const POLYMARKET_POSITIONS_URL = `https://data-api.polymarket.com/positions?user=${POLYMARKET_WALLET}`;

type Position = {
  asset: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  outcome: string;
  oppositeOutcome?: string;
  endDate?: string;
};

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(n) < 10 ? 2 : 0,
    maximumFractionDigits: Math.abs(n) < 10 ? 2 : 0,
  });

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const fmtPrice = (n: number) => `${Math.round(n * 100)}c`;

export function PolymarketStrategyPanel() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(POLYMARKET_POSITIONS_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`polymarket ${res.status}`);
        const next = (await res.json()) as Position[];
        if (!alive) return;
        setPositions(next);
        setUpdatedAt(new Date());
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const totals = useMemo(() => {
    return positions.reduce(
      (acc, p) => ({
        initial: acc.initial + (p.initialValue || 0),
        current: acc.current + (p.currentValue || 0),
        pnl: acc.pnl + (p.cashPnl || 0),
      }),
      { initial: 0, current: 0, pnl: 0 },
    );
  }, [positions]);

  const pnlPct = totals.initial > 0 ? (totals.pnl / totals.initial) * 100 : 0;
  const sorted = [...positions].sort((a, b) => Math.abs(b.currentValue) - Math.abs(a.currentValue));

  return (
    <section className="mb-10 rounded-3xl border-2 border-ember/30 bg-white p-6 md:p-8">
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="mb-3 font-mono text-xs uppercase tracking-wider text-ember">
            // live paper-strategy tracker
          </div>
          <h2 className="mb-2 font-display text-2xl font-bold lowercase md:text-3xl">
            polymarket shadow account, not vault capital.
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed text-muted md:text-base">
            The strategy currently runs as a small-account validation loop: fade sharp
            mid-event rallies, block spread markets, cap concurrent risk, and keep the
            FDRY vault separate while the evidence compounds. This panel reads the
            public Polymarket profile every 20s.
          </p>
        </div>
        <a
          href={POLYMARKET_PROFILE_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-line bg-soft px-4 py-2 text-sm font-semibold text-ink transition hover:border-ember/40 hover:bg-sunrise"
        >
          Open Polymarket
        </a>
      </div>

      {error && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 font-mono text-xs text-amber-900">
          live account read unavailable: {error}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <LiveMetric label="open positions" value={String(positions.length)} sub="public profile" />
        <LiveMetric label="current exposure" value={fmtUsd(totals.current)} sub={fmtUsd(totals.initial) + " cost"} />
        <LiveMetric
          label="open p&l"
          value={fmtUsd(totals.pnl)}
          sub={fmtPct(pnlPct)}
          tone={totals.pnl >= 0 ? "good" : "bad"}
        />
        <LiveMetric
          label="last refresh"
          value={updatedAt ? updatedAt.toLocaleTimeString() : "..."}
          sub="20s poll"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-line bg-soft p-5">
          <h3 className="mb-3 font-display font-semibold lowercase">rules reflected here</h3>
          <div className="space-y-3 text-sm leading-relaxed text-muted">
            <p>
              It is exploratory work: the account can lose money, sit idle, miss fills,
              or change routing as the evidence changes.
            </p>
            <p>
              Current doctrine from imabettingman: buy NO into mid-event rally
              overreactions, use the small account for observation, and block spreads
              after the 2026-05-15 review.
            </p>
            <p>
              No vault deployment is implied here. Depositors hold stFDRY and exit
              through the vault queue, not through this Polymarket account.
            </p>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="font-display font-semibold lowercase">open account positions</h3>
            <span className="font-mono text-xs text-muted">
              {POLYMARKET_WALLET.slice(0, 6)}...{POLYMARKET_WALLET.slice(-4)}
            </span>
          </div>
          {sorted.length === 0 ? (
            <div className="p-6 font-mono text-sm text-muted">
              no open Polymarket positions reported.
            </div>
          ) : (
            <div className="divide-y divide-line">
              {sorted.slice(0, 5).map((p) => (
                <a
                  key={p.asset}
                  href={`https://polymarket.com/event/${p.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="block p-4 transition hover:bg-soft"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {p.title}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted">
                        holding {p.outcome} · avg {fmtPrice(p.avgPrice)} · mark {fmtPrice(p.curPrice)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-xs">
                      <div className={p.cashPnl >= 0 ? "text-emerald-700" : "text-red-700"}>
                        {fmtUsd(p.cashPnl)}
                      </div>
                      <div className="text-muted">{fmtUsd(p.currentValue)}</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-5 font-mono text-[10px] lowercase leading-relaxed text-muted">
        // source: imabettingman local doctrine + Polymarket Data API positions.
        Displaying open account state only; closed trades and future edge are not promised.
      </p>
    </section>
  );
}

function LiveMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-soft p-4">
      <div className="mb-2 text-xs uppercase text-muted">{label}</div>
      <div className={`font-display text-xl font-bold tabular-nums ${color}`}>
        {value}
      </div>
      <div className="mt-1 font-mono text-xs text-muted">{sub}</div>
    </div>
  );
}
