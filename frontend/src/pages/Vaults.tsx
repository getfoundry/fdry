import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  listVaults,
  fetchVaultOnChain,
  VaultOnChainInfo,
  VaultRegistryEntry,
  isCanonicalFdryVault,
} from "../lib/vaults";

type Row = {
  entry: VaultRegistryEntry;
  info: VaultOnChainInfo | null;
  error: string | null;
};

const fmt = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const shortAddr = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const bps = (n: number) => `${(n / 100).toFixed(2)}%`;

export default function VaultsPage() {
  const { connection } = useConnection();
  const entries = useMemo(() => listVaults(), []);
  const [rows, setRows] = useState<Row[]>(
    () => entries.map((entry) => ({ entry, info: null, error: null })),
  );

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const results = await Promise.all(
        entries.map(async (entry) => {
          try {
            const info = await fetchVaultOnChain(connection, entry.pubkey);
            return { entry, info, error: null } satisfies Row;
          } catch (e) {
            return { entry, info: null, error: (e as Error).message } satisfies Row;
          }
        }),
      );
      if (alive) setRows(results);
    };
    run();
    const id = setInterval(run, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [connection, entries]);

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="fixed top-0 inset-x-0 z-30 bg-white/80 backdrop-blur-md border-b border-line">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-molten flex items-center justify-center text-white font-display font-bold text-sm">F</div>
            <span className="font-display font-semibold tracking-tight">foundry</span>
            <span className="text-muted text-sm ml-2 hidden sm:inline">/ vaults</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <Link to="/" className="hover:text-ink transition">home</Link>
            <Link to="/vault" className="hover:text-ink transition">fdry vault</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-28 pb-24">
        <div className="mb-10">
          <div className="text-sm font-mono text-ember mb-3 lowercase tracking-wider">// vault directory</div>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight lowercase">
            every <span className="molten-text">vault</span> this frontend speaks to.
          </h1>
          <p className="text-muted mt-2 max-w-2xl font-mono text-sm">
            // driven by VITE_VAULT_PUBKEYS env var (comma-separated). the fdry treasury is pinned first. each row
            is a direct on-chain read — tvl, cap, fees, fresh every 30s.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {rows.map(({ entry, info, error }) => {
            const canonical = isCanonicalFdryVault(entry.pubkey);
            const cap = info && info.maxCap > 0n
              ? Number(info.maxCap) / Math.pow(10, info.assetDecimals)
              : null;
            const tvl = info?.totalAssetsBooked ?? 0;
            const utilization = cap && cap > 0 ? Math.min(1, tvl / cap) : null;
            const assetSym = entry.assetSymbol ?? (info?.name || "asset");
            const label = entry.label ?? info?.name ?? "unnamed vault";
            return (
              <Link
                to={`/vault?v=${entry.pubkey}`}
                key={entry.pubkey}
                className="group block p-5 rounded-3xl border border-line bg-white hover:border-ember/50 transition"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted">{shortAddr(entry.pubkey)}</span>
                    {canonical && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sunrise text-ember font-mono uppercase">canonical</span>}
                  </div>
                  <span className="text-[10px] font-mono text-muted group-hover:text-ember transition">open →</span>
                </div>
                <div className="font-display text-lg font-bold mb-1 lowercase">{label}</div>
                <div className="text-xs text-muted font-mono lowercase mb-4">
                  {info ? `asset: ${assetSym} · ${info.lpDecimals}-dec lp` : error ? `rpc error · ${error.slice(0, 60)}` : "loading…"}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Stat
                    label="tvl"
                    value={info ? `${fmt(tvl, 2)} ${assetSym}` : "…"}
                  />
                  <Stat
                    label="nav / share"
                    value={info ? fmt(info.navPerShareInAsset, 6) : "…"}
                  />
                  <Stat
                    label="cap"
                    value={cap == null ? "uncapped" : `${fmt(cap, 0)} ${assetSym}`}
                    sub={utilization != null ? `${(utilization * 100).toFixed(1)}% full` : undefined}
                  />
                </div>

                {info && (
                  <div className="mt-4 pt-3 border-t border-line text-[11px] font-mono text-muted leading-relaxed">
                    fees — perf mgr {bps(info.fees.managerPerformance)} · admin {bps(info.fees.adminPerformance)} ·
                    mgmt {bps(info.fees.managerManagement)} · redemption {bps(info.fees.redemption)}
                    {info.withdrawalWaitingPeriodSec > 0 && (
                      <> · withdraw wait {Math.round(info.withdrawalWaitingPeriodSec / 3600)}h</>
                    )}
                    {info.disabledOperations !== 0 && (
                      <> · <span className="text-red-700">ops disabled mask {info.disabledOperations}</span></>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>

        <p className="text-xs text-muted mt-10 text-center font-mono lowercase">
          // to add a vault: set VITE_VAULT_PUBKEYS=&lt;pubkey1&gt;,&lt;pubkey2&gt; in your .env and rebuild.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-3 rounded-2xl border border-line bg-soft">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">{label}</div>
      <div className="font-display text-sm font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
