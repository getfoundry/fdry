import { useEffect, useState } from "react";

const API = "https://voltr.getfoundry.app/api/naut";

// Defaults shown until /api/naut/vault_link responds. Real values come
// from the backend (env-driven on the VM).
const DEFAULT_STRATEGY_MODE: "paper" | "live" = "paper";
const DEFAULT_DEPLOY_PCT = 0.30;

type Position = {
  long?: string;
  short?: string;
  smyrna_medoid?: string;
  laodicea_medoid?: string;
  mark_pnl_bp?: number;
  bars_remaining?: number;
  holding?: boolean;
  entry_t?: string;
};

function fmtPct(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function fmtBpAsPct(bp: number | null | undefined) {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return "—";
  const pct = bp / 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function VaultStrategyPanel() {
  const [mode, setMode] = useState<"paper" | "live">(DEFAULT_STRATEGY_MODE);
  const [deployPct, setDeployPct] = useState<number>(DEFAULT_DEPLOY_PCT);
  const [position, setPosition] = useState<Position | null>(null);
  const [serviceLive, setServiceLive] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const linkRes = await fetch(`${API}/vault_link`, { cache: "no-store" });
        if (!alive) return;
        if (linkRes.ok) {
          const link = await linkRes.json();
          setServiceLive(Boolean(link?.service_ok));
          if (link?.mode === "live" || link?.mode === "paper") {
            setMode(link.mode);
          }
          if (typeof link?.deploy_pct_of_vault === "number") {
            setDeployPct(link.deploy_pct_of_vault);
          }
          // Build a Position-shaped object from the link payload so the
          // PositionCard renders without a second fetch.
          const p = link?.position;
          if (p?.holding) {
            setPosition({
              holding: true,
              long: p.long_ticker,
              smyrna_medoid: p.long_ticker,
              mark_pnl_bp: p.mark_pnl_bp,
              bars_remaining: p.bars_remaining,
              entry_t: p.entry_t,
            });
          } else {
            setPosition(null);
          }
        } else {
          setServiceLive(false);
        }
      } catch {
        if (alive) setServiceLive(false);
      }
    };
    load();
    const id = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const holding = Boolean(position?.holding);
  const longTicker = position?.long ?? position?.smyrna_medoid;
  const markPnlBp = position?.mark_pnl_bp;
  const barsRemaining = position?.bars_remaining;

  return (
    <section className="rounded-3xl border-2 border-line bg-white p-6 md:p-8 mb-10">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-xs font-mono text-ember uppercase tracking-wider mb-3">
            // strategy ↔ vault link
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-1 lowercase">
            paper trading. vault funds stay idle.
          </h2>
          <p className="text-sm md:text-base text-muted leading-relaxed max-w-3xl">
            We're rehearsing the strategy on paper while a third-party
            audit clears it for live deployment. Your deposited FDRY waits
            in the vault and is withdrawable any time, including before we
            go live.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium shrink-0 ${
            mode === "paper"
              ? "bg-amber-50 text-amber-800 border-amber-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              mode === "paper" ? "bg-amber-500" : "bg-emerald-500"
            }`}
          ></span>
          mode: {mode}
        </span>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-2">
        <PolicyCard
          title={`max ${fmtPct(deployPct)} deployed`}
          body={`When live, no more than ${fmtPct(deployPct)} of vault TVL is in a single underdog token at a time. The rest stays as idle FDRY in the vault.`}
        />
        <PolicyCard
          title={`${fmtPct(1 - deployPct)} always idle`}
          body="Idle FDRY is claimable on demand, so withdrawals don't force a position unwind. Most depositors can instant-redeem without touching the trade."
        />
        <PositionCard
          mode={mode}
          serviceLive={serviceLive}
          holding={holding}
          longTicker={longTicker}
          markPnlBp={markPnlBp}
          barsRemaining={barsRemaining}
        />
      </div>

      <p className="text-[10px] text-muted mt-5 font-mono lowercase">
        // status: {mode} · cap when live: {fmtPct(deployPct)} · vault: Bpr4...xBX1
      </p>
    </section>
  );
}

function PolicyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-4 rounded-2xl border border-line bg-soft">
      <div className="font-display font-semibold text-sm mb-2 lowercase">
        {title}
      </div>
      <p className="text-xs text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function PositionCard({
  mode,
  serviceLive,
  holding,
  longTicker,
  markPnlBp,
  barsRemaining,
}: {
  mode: "paper" | "live";
  serviceLive: boolean;
  holding: boolean;
  longTicker?: string;
  markPnlBp?: number;
  barsRemaining?: number;
}) {
  if (!serviceLive) {
    return (
      <div className="p-4 rounded-2xl border border-line bg-soft">
        <div className="font-display font-semibold text-sm mb-2 lowercase">
          service offline
        </div>
        <p className="text-xs text-muted leading-relaxed">
          Live data temporarily unavailable. Vault deposits and withdrawals
          continue to work directly on Solana.
        </p>
      </div>
    );
  }
  if (!holding) {
    return (
      <div className="p-4 rounded-2xl border border-line bg-soft">
        <div className="font-display font-semibold text-sm mb-2 lowercase">
          {mode === "paper" ? "paper · between trades" : "live · between trades"}
        </div>
        <p className="text-xs text-muted leading-relaxed">
          No active position right now.{" "}
          {mode === "paper"
            ? "Vault funds 100% idle. Next 4-hour bar evaluates a new entry."
            : "Vault funds 100% idle in FDRY. Next 4-hour bar evaluates a new entry."}
        </p>
      </div>
    );
  }
  return (
    <div className="p-4 rounded-2xl border border-ember/30 bg-sunrise">
      <div className="flex items-center justify-between mb-2">
        <div className="font-display font-semibold text-sm lowercase">
          {mode === "paper" ? "paper · long " : "live · long "}
          <span className="text-ember">{longTicker ?? "?"}</span>
        </div>
        <span
          className={`text-xs font-mono tabular-nums ${
            (markPnlBp ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {fmtBpAsPct(markPnlBp)}
        </span>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        {barsRemaining ?? "?"} bar(s) remaining (max 8h). Closes on rotation
        in profit, on -50% stop, or at hold timeout.
        {mode === "paper" ? " No real swap on Solana while in paper." : ""}
      </p>
    </div>
  );
}
