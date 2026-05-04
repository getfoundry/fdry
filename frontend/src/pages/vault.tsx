import { useState, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useLiveTreasury } from "../hooks/useLiveTreasury";
import { useVaultInfo } from "../hooks/useVaultInfo";
import { DepositWidget } from "../components/DepositWidget";
import { PortfolioPanel } from "../components/PortfolioPanel";
import NavChart from "../components/NavChart";
import {
  findVaultEntry,
  isCanonicalFdryVault,
  listVaults,
} from "../lib/vaults";
import {
  VAULT_PUBKEY_STR,
  LP_MINT_STR,
  CREATOR_WALLET_STR,
} from "../lib/voltrConfig";

const fmtUsd = (n: number, d = 2) => {
  let digits = d;
  if (n > 0 && n < 1) {
    const firstSigPos = -Math.floor(Math.log10(n));
    if (firstSigPos >= d) digits = Math.min(8, firstSigPos + 3);
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtNum = (n: number, d = 4) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const shortAddr = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const fmtTs = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString() : "—");

export default function VaultPage() {
  const [searchParams] = useSearchParams();
  const selectedPubkey = searchParams.get("v") || VAULT_PUBKEY_STR;
  const entry = useMemo(() => findVaultEntry(selectedPubkey), [selectedPubkey]);
  const canonical = isCanonicalFdryVault(selectedPubkey);
  const allVaults = useMemo(() => listVaults(), []);

  // On-chain metadata for the active vault (asset/lp/decimals/fees/nav).
  const { info: chainInfo } = useVaultInfo(selectedPubkey);

  // Live treasury view is FDRY-specific (USD pricing, pyth, etc.) — only
  // meaningful for the canonical FDRY vault. For other vaults we still show
  // chain-derived stats from chainInfo.
  const live = useLiveTreasury(selectedPubkey, chainInfo?.lpMint ?? LP_MINT_STR);
  const ageSec = live.updatedAt ? Math.max(0, Math.floor((Date.now() - live.updatedAt) / 1000)) : null;

  // Derived display values for the active vault.
  const assetMint = chainInfo?.assetMint ?? entry.assetMint;
  const lpMint = chainInfo?.lpMint ?? entry.lpMint ?? LP_MINT_STR;
  const assetDecimals = chainInfo?.assetDecimals ?? entry.assetDecimals ?? 9;
  const assetSymbol = entry.assetSymbol ?? (canonical ? "FDRY" : "asset");
  const shareSymbol = canonical ? "stFDRY" : `v${assetSymbol}`;
  const navPerShareInAsset = chainInfo?.navPerShareInAsset ?? 1;

  // Portfolio refresh: bumped when DepositWidget reports success.
  const [posRefresh, setPosRefresh] = useState(0);
  const bumpPortfolio = () => setPosRefresh((n) => n + 1);

  const VAULT_PUBKEY = selectedPubkey;
  const VAULT_MINT = lpMint;
  const CREATOR_WALLET = chainInfo?.manager ?? CREATOR_WALLET_STR;

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="fixed top-0 inset-x-0 z-30 bg-white/80 backdrop-blur-md border-b border-line">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-molten flex items-center justify-center text-white font-display font-bold text-sm">F</div>
            <span className="font-display font-semibold tracking-tight">foundry</span>
            <span className="text-muted text-sm ml-2 hidden sm:inline">/ transparency</span>
          </a>
          <nav className="flex items-center gap-4 text-sm text-muted">
            {allVaults.length > 1 && (
              <select
                value={selectedPubkey}
                onChange={(e) => { window.location.search = `?v=${e.target.value}`; }}
                className="text-xs font-mono bg-soft border border-line rounded-full px-3 py-1.5 hover:border-ember/50 transition outline-none"
                title="switch vault"
              >
                {allVaults.map((v) => (
                  <option key={v.pubkey} value={v.pubkey}>
                    {(v.label ?? v.pubkey.slice(0, 8)).slice(0, 32)}
                  </option>
                ))}
              </select>
            )}
            <a href="/" className="hover:text-ink transition">home</a>
            <Link to="/vaults" className="hover:text-ink transition">vaults</Link>
            <a href="#deposit" className="hover:text-ink transition">deposit</a>
            <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="hover:text-ink transition">solscan ↗</a>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-24">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <div className="text-sm font-mono text-ember mb-3 lowercase tracking-wider">// transparency</div>
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight lowercase">
              everything the <span className="molten-text">treasury</span> is doing.
            </h1>
            <p className="text-muted mt-2 max-w-2xl font-mono text-sm">
              // live state pulled straight from solana rpc every 20s. no server, no indexer, no vibes. every number below comes from a public rpc read u can verify urself on solscan.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {live.error ? (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-medium">✗ RPC error</span>
            ) : live.loading ? (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sunrise text-ember border border-ember/20 text-xs font-medium"><span className="live-dot"></span> loading…</span>
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> live · {ageSec ?? 0}s ago</span>
            )}
          </div>
        </div>

        {live.error && (
          <div className="mb-6 p-4 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-sm font-mono">{live.error}</div>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat label="NAV (USD)" value={live.loading ? "…" : fmtUsd(live.navUsd)} sub={`${fmtNum(live.navUsd / (live.solPrice || 1), 4)} SOL equiv`} hint="// sum of vault token balances × price. not counting the native sol rent below." />
          <Stat label="NAV / share" value={live.loading ? "…" : fmtUsd(live.navPerShareUsd, 4)} sub={`${fmtNum(live.sharesOutstanding, 3)} stFDRY outstanding`} hint="// what one stFDRY is backed by rn. nav ÷ shares, thats it." />
          <Stat label="SOL / USD" value={live.loading ? "…" : fmtUsd(live.solPrice)} sub="Pyth Hermes · live" hint="// sol price from pyth. refreshed every tick, no cache." />
          <Stat label="Native SOL (rent)" value={live.loading ? "…" : `${fmtNum(live.nativeSolBalance, 4)} SOL`} sub={fmtUsd(live.nativeSolBalance * live.solPrice)} hint="// sol the vault account holds for rent-exempt minimum. not part of nav — the actual FDRY lives in a PDA-owned ATA below." />
        </section>

        <div className="text-xs text-muted mb-10 font-mono lowercase">
          // reads: <code className="font-mono bg-soft px-1 rounded">getBalance(vault)</code> for rent sol, <code className="font-mono bg-soft px-1 rounded">getTokenAccountBalance(idle_ata)</code> for FDRY held by voltr's idle-auth pda, <code className="font-mono bg-soft px-1 rounded">getTokenSupply(stFDRY_mint)</code> for shares, and <code className="font-mono bg-soft px-1 rounded">getSignaturesForAddress(vault)</code> for activity. the vault pubkey itself holds 0 FDRY directly — tokens live in the PDA-owned ATA (linked below).
        </div>

        <section className="rounded-3xl border border-line bg-white p-6 mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h2 className="font-display text-xl font-semibold lowercase">nav / share over time</h2>
              <p className="text-xs text-muted font-mono lowercase mt-1">// reconstructed from deposit &amp; withdraw txs on this vault. each dot = one state change.</p>
            </div>
            <span className="text-xs text-muted font-mono">{assetSymbol}-denominated</span>
          </div>
          <NavChart vaultPubkey={VAULT_PUBKEY} lpMint={VAULT_MINT} />
        </section>

        <section className="grid md:grid-cols-5 gap-6 mb-10">
          <div className="md:col-span-3 rounded-3xl border border-line bg-white p-6">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="font-display text-xl font-semibold lowercase">live holdings</h2>
              <span className="text-xs text-muted font-mono lowercase">// everything the vault owns, direct from chain</span>
            </div>
            {live.loading ? (
              <div className="p-8 text-center text-muted text-sm">loading…</div>
            ) : live.holdings.length === 0 ? (
              <Empty title="no FDRY in the vault yet" body="deposits land instantly. stFDRY mints in the same tx, no keeper wait lol." />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-soft text-muted">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">asset</th>
                      <th className="text-left px-4 py-3 font-medium">held at</th>
                      <th className="text-right px-4 py-3 font-medium">balance</th>
                      <th className="text-right px-4 py-3 font-medium">usd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.holdings.map((h) => (
                      <tr key={h.mint} className="border-t border-line">
                        <td className="px-4 py-3 font-mono font-semibold">
                          {h.symbol}
                          <a href={`https://solscan.io/token/${h.mint}`} target="_blank" rel="noopener" className="ml-2 text-xs text-muted hover:text-ember">{shortAddr(h.mint)} ↗</a>
                        </td>
                        <td className="px-4 py-3">
                          {live.fdryAtaAddr ? (
                            <a href={`https://solscan.io/account/${live.fdryAtaAddr}`} target="_blank" rel="noopener" className="font-mono text-xs text-ember hover:underline" title={live.fdryAtaAddr}>idle ATA {shortAddr(live.fdryAtaAddr)} ↗</a>
                          ) : (
                            <span className="font-mono text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtNum(h.amount, h.decimals > 6 ? 6 : h.decimals)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(h.usd)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-line bg-soft/50">
                      <td colSpan={3} className="px-4 py-3 text-right font-semibold">total nav</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{fmtUsd(live.navFromTokens)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted mt-3 font-mono lowercase">// clicking "idle ata" opens the exact token account on solscan — the balance there should match the number above, exactly. if it doesnt, the frontend is lying; open an issue.</p>
          </div>

          <div className="md:col-span-2 rounded-3xl border border-line bg-soft p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold lowercase">addresses</h2>
            <div className="space-y-3 text-sm">
              <AddrRow label="vault" addr={VAULT_PUBKEY} />
              <AddrRow label="share mint (stFDRY)" addr={VAULT_MINT} isToken />
              <AddrRow label="creator / operator" addr={CREATOR_WALLET} />
              {live.fdryAtaAddr && <AddrRow label="idle FDRY ATA (where deposits land)" addr={live.fdryAtaAddr} />}
              {live.idleAuthAddr && <AddrRow label="idle-auth PDA (ATA owner)" addr={live.idleAuthAddr} />}
            </div>
            <div className="pt-3 border-t border-line">
              <div className="text-xs text-muted mb-1 font-mono lowercase">// programs</div>
              <AddrRow label="voltr" addr="vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8" />
              <AddrRow label="lp mint (stFDRY)" addr="G8e9i9RADPsxJtiCJsGC4tSx2kgCkGbEkdn7aajt2nqW" isToken />
              <AddrRow label="FDRY asset mint" addr="2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL" isToken />
            </div>
            <div className="p-4 rounded-2xl bg-white border border-line text-xs font-mono text-muted leading-relaxed lowercase">
              {"// every number on this page is a direct rpc read. no server, no indexer, no vibes. if ur paranoid paste the pubkeys above into solscan and get the same numbers. thats the whole point lol"}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border-2 border-ember/30 bg-white p-6 md:p-8 mb-10">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-xs font-mono text-ember uppercase tracking-wider">// the strategy</span>
          </div>
          <h2 className="font-display text-2xl md:text-3xl font-bold mb-4 lowercase">
            <span className="molten-text">david</span> — can a retail-sized bot beat just holding sol?
          </h2>
          <div className="text-sm md:text-base text-ink/80 leading-relaxed space-y-3 font-mono lowercase">
            <p>
              david is a small scalping bot running under the vault. every ~30 seconds it clusters 39 solana tokens by how they're moving right now (1h return, recent vol, drawdown, vol-scaled momentum), runs k-means w/ k=7, picks the <span className="text-ink font-semibold">underdog</span> (token closest to the center of the laggard cluster — beaten-down + statistically overdue for a bounce), and opens a long for a fixed hold.
            </p>
            <p>
              <span className="text-ink font-semibold">the underdog framing is the whole point.</span> big funds pay &lt;1bp per trade and see orderflow. retail gets hit by ~60bp jupiter taker fees round-trip. most online "strategies" quote zero-fee returns and collapse once real fees land. david ships with a fees on/off toggle so u can see the actual gap urself. forging the tools to compete with giants, on purpose.
            </p>
            <p>
              <span className="text-ink font-semibold">only the 4h hold is honest enough to trade live.</span> shorter timeframes (1m/3m/5m/15m/60m) flip too often — a 1-min strat fires ~1,440x/day, fees eat ~864% annually, no edge survives. the 4h hold fires ~6x/day so fees stay tractable (~130% fee drag vs realistic 200-300% gross edge). the dashboard proves this empirically when u flip fees on.
            </p>
            <p>
              <span className="text-ink font-semibold">exit rules:</span> close after hold expires, 0.75% trailing stop cuts losses early. max 1 entry per 15 min. 30% of nav per trade. on-chain mirrors this exactly.
            </p>
            <p>
              <span className="text-ink font-semibold">how this feeds FDRY:</span> when an underdog bounces, david sells it back into FDRY at a higher price — that's a buy on FDRY funded by someone else's rally. every successful round-trip lifts nav-per-share for every stFDRY holder. when a scalp misses, less FDRY comes back + nav dips. expect volatility on both FDRY and stFDRY in the short term.
            </p>
            <p className="text-muted">
              <span className="text-ink">what we wont claim:</span> profitability until the 4h line stays above $10k w/ fees ON for 30+ days. market-beating. ai (its k-means + a pick-the-underdog rule). the process is the product.
            </p>
          </div>
        </section>


        <section className="rounded-3xl border-2 border-ember/30 bg-sunrise/40 p-6 md:p-8 mb-10">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-xs font-mono text-ember uppercase tracking-wider">// read this before u deposit</span>
          </div>
          <h2 className="font-display text-2xl font-bold mb-3 lowercase">operator has full discretion with vault assets</h2>
          <div className="text-sm text-ink/80 leading-relaxed space-y-3 font-mono lowercase">
            <p>
              the operator (creator wallet above) can do literally whatever w/ the FDRY sitting in the idle ata. not just trading/yield — also: <span className="text-ink font-semibold">pay himself a salary, buy anthropic/openai/inference api credits, fund servers, cover legal, pay contractors, burn on experiments, w/e it takes to grow the business.</span> there is no pre-committed strategy, no whitelist of venues, no approved-uses list, no lockup on operator-side decisions. the only hard constraint: u can always burn ur stFDRY and pull out whatever share of the vault exists at that moment.
            </p>
            <p>
              upside thesis: operator compounds the treasury — thru trades, yield, revenue buybacks, AND by spending it on unbrowse ops that generate more revenue that buys more FDRY back. downside: <span className="text-ink font-semibold">if operator makes bad trades, overpays himself, or torches it on dead experiments, nav/share goes down and u eat the loss pro-rata.</span> this is a discretionary treasury w/ a founder attached, not a passive 1:1 wrapper. dont ape if u arent ok w/ that.
            </p>
            <p>
              every move is on-chain and visible in the activity log below + solscan — incl. any transfer out of the idle ata, whether its a swap, a salary wire, or an api invoice. the operator cant freeze withdrawals, cant rug the share mint, cant mint shares out of thin air — those authorities sit w/ voltr program logic. but within those rails, capital allocation is fully discretionary. transparency ≠ safety; u can watch the spend happen in real time.
            </p>
          </div>
        </section>

        <section id="deposit" className="mb-10 grid md:grid-cols-2 gap-6">
          <div>
            <div className="mb-4">
              <h2 className="font-display text-2xl font-bold lowercase">deposit</h2>
              <p className="text-muted text-sm mt-1 font-mono lowercase">direct on-chain · any solana wallet · no custody</p>
            </div>
            <DepositWidget
              vaultMint={VAULT_MINT}
              vaultPubkey={VAULT_PUBKEY}
              assetMint={assetMint}
              assetDecimals={assetDecimals}
              assetSymbol={assetSymbol}
              shareSymbol={shareSymbol}
              navPerShareInFdry={navPerShareInAsset}
              onPositionChange={bumpPortfolio}
            />
          </div>
          <div>
            <div className="mb-4">
              <h2 className="font-display text-2xl font-bold lowercase">your position</h2>
              <p className="text-muted text-sm mt-1 font-mono lowercase">shares on-chain · cost-basis tracked locally · live p&amp;l</p>
            </div>
            <PortfolioPanel
              vaultPubkey={VAULT_PUBKEY}
              lpMint={VAULT_MINT}
              assetSymbol={assetSymbol}
              shareSymbol={shareSymbol}
              assetDecimals={assetDecimals}
              navPerShareInAsset={navPerShareInAsset}
              refreshKey={posRefresh}
            />
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-white p-6 mb-10">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-xl font-semibold lowercase">recent activity</h2>
            <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="text-xs text-ember hover:underline font-mono">[ all txs on solscan → ]</a>
          </div>
          {live.loading ? (
            <div className="p-8 text-center text-muted text-sm">loading…</div>
          ) : live.activity.length === 0 ? (
            <Empty title="no txs yet lol" body="deposits, swaps, and buybacks will stream here as they settle on solana." />
          ) : (
            <ul className="divide-y divide-line">
              {live.activity.map((a) => {
                const ok = !a.err;
                return (
                  <li key={a.signature} className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={"px-2 py-0.5 rounded-md text-xs font-mono uppercase " + (ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>{ok ? "success" : "failed"}</span>
                      <span className="text-sm">{a.humanKind}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted">
                      <span className="tabular-nums">{fmtTs(a.blockTime)}</span>
                      <a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noopener" className="text-ember hover:underline font-mono">{a.signature.slice(0, 8)}… ↗</a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-5 p-4 rounded-2xl bg-soft border border-line text-xs text-muted leading-relaxed space-y-1">
            <div><span className="font-mono font-semibold text-ink">success</span> — tx landed on-chain, state changed. thats it.</div>
            <div><span className="font-mono font-semibold text-ink">failed · rejected · LP ATA missing</span> — voltr error 3012 <code className="font-mono">AccountNotInitialized</code>. ur stFDRY ata hasnt been created yet — the deposit tx should create it in the same ix; if it didnt, retry or make the ata manually.</div>
            <div><span className="font-mono font-semibold text-ink">failed · rejected · instant withdraw not allowed</span> — voltr error 6015 <code className="font-mono">InstantWithdrawNotAllowed</code>. this vault ships with 0 wait so this shouldnt fire — if it does, file an issue ngl.</div>
            <div><span className="font-mono font-semibold text-ink">failed · rejected · custom N</span> — some other voltr program error. click the sig to see full logs on solscan.</div>
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-soft p-6 md:p-8 mb-10">
          <h2 className="font-display text-2xl font-bold mb-6 font-mono lowercase">// how it all fits</h2>
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <Explainer step="1" title="you deposit">
              u sign a <code className="font-mono bg-white px-1 rounded">deposit</code> ix against the voltr program from ur wallet. FDRY moves into the vault's idle ata, stFDRY mints to u in the same tx. no keeper, no wait.
            </Explainer>
            <Explainer step="2" title="operator runs the book">
              deposited FDRY starts in the idle ata. the operator has full discretion to move it — swap / lp / lend / trade to try to grow nav, or spend it on ops (salary, api credits, servers, contractors) to grow the underlying business. no pre-committed strategy, no approved-uses list. nav/share reflects whatever the vault currently holds, marked to market.
            </Explainer>
            <Explainer step="3" title="revenue routes back">
              when an unbrowse customer pays, a share of that revenue buys FDRY on-market and drops it in the vault. total nav goes up → nav-per-share goes up → every holder benefits pro-rata, no claim step. this is the mechanism that closes the loop on operator spending.
            </Explainer>
            <Explainer step="4" title="you withdraw">
              sign a <code className="font-mono bg-white px-1 rounded">withdraw</code> ix. stFDRY burns, ur pro-rata share of whatever the vault currently holds returns to ur wallet, all same tx. no exit fee, no lockup. operator literally cant block this.
            </Explainer>
            <Explainer step="5" title="if something fails">
              solana txs are atomic. if any step fails (insufficient balance, missing ata, voltr state check), the whole tx reverts and ur FDRY stays in ur wallet minus gas. every failure is visible in the activity log above w/ a sig u can trace.
            </Explainer>
          </div>
        </section>

        <p className="text-xs text-muted/70 mt-8 text-center leading-relaxed">
          not financial advice. experimental on-chain treasury w/ discretionary operator — capital at risk, nav can go down if operator trades badly, pays himself too much, or spends it on things that dont return. dont ape what u cant afford to lose lol. operator cant freeze funds; withdraw any time.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <div className="p-5 rounded-2xl border border-line bg-white group relative">
      <div className="text-xs text-muted mb-2 uppercase tracking-wider">{label}</div>
      <div className="font-display text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
      {hint && (
        <div className="absolute inset-x-0 top-full mt-1 z-10 hidden group-hover:block p-3 rounded-xl bg-ink text-white text-xs leading-relaxed shadow-xl">{hint}</div>
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-8 text-center rounded-2xl bg-soft border border-dashed border-line">
      <div className="font-display font-semibold mb-1">{title}</div>
      <div className="text-sm text-muted">{body}</div>
    </div>
  );
}

function AddrRow({ label, addr, isToken = false }: { label: string; addr: string; isToken?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-line/60 last:border-0">
      <dt className="text-muted text-sm">{label}</dt>
      <dd>
        <a href={`https://solscan.io/${isToken ? "token" : "account"}/${addr}`} target="_blank" rel="noopener" className="font-mono text-xs text-ink hover:text-ember">{shortAddr(addr)} ↗</a>
      </dd>
    </div>
  );
}

function Explainer({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-2xl bg-white border border-line">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-6 h-6 rounded-md bg-sunrise text-ember flex items-center justify-center text-xs font-mono font-semibold">{step}</span>
        <h3 className="font-display font-semibold">{title}</h3>
      </div>
      <p className="text-muted leading-relaxed">{children}</p>
    </div>
  );
}
