import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DepositWidget } from "../components/DepositWidget";
import NavChart from "../components/NavChart";
import { PortfolioPanel } from "../components/PortfolioPanel";
import { PolymarketStrategyPanel } from "../components/PolymarketStrategyPanel";
import { VaultExplainerCard } from "../components/VaultExplainerCard";
import { useLiveTreasury } from "../hooks/useLiveTreasury";
import { useVaultInfo } from "../hooks/useVaultInfo";
import {
  findVaultEntry,
  isCanonicalFdryVault,
  listVaults,
} from "../lib/vaults";
import {
  CREATOR_WALLET_STR,
  FDRY_JUPITER_URL,
  LP_MINT_STR,
  VAULT_PUBKEY_STR,
} from "../lib/voltrConfig";

const fmtUsd = (n: number, d = 2) => {
  let digits = d;
  if (n > 0 && n < 1) {
    const firstSigPos = -Math.floor(Math.log10(n));
    if (firstSigPos >= d) digits = Math.min(8, firstSigPos + 3);
  }
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const fmtNum = (n: number, d = 4) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const shortAddr = (s: string) => `${s.slice(0, 4)}...${s.slice(-4)}`;
const fmtTs = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString() : "-");

export default function VaultPage() {
  const [searchParams] = useSearchParams();
  const selectedPubkey = searchParams.get("v") || VAULT_PUBKEY_STR;
  const entry = useMemo(() => findVaultEntry(selectedPubkey), [selectedPubkey]);
  const canonical = isCanonicalFdryVault(selectedPubkey);
  const allVaults = useMemo(() => listVaults(), []);
  const { info: chainInfo } = useVaultInfo(selectedPubkey);
  const live = useLiveTreasury(selectedPubkey, chainInfo?.lpMint ?? LP_MINT_STR);
  const ageSec = live.updatedAt
    ? Math.max(0, Math.floor((Date.now() - live.updatedAt) / 1000))
    : null;

  const assetMint = chainInfo?.assetMint ?? entry.assetMint;
  const lpMint = chainInfo?.lpMint ?? entry.lpMint ?? LP_MINT_STR;
  const assetDecimals = chainInfo?.assetDecimals ?? entry.assetDecimals ?? 9;
  const assetSymbol = entry.assetSymbol ?? (canonical ? "FDRY" : "asset");
  const shareSymbol = canonical ? "stFDRY" : `v${assetSymbol}`;
  const navPerShareInAsset = chainInfo?.navPerShareInAsset ?? 1;
  const creatorWallet = chainInfo?.manager ?? CREATOR_WALLET_STR;
  const withdrawalWaitSec = chainInfo?.withdrawalWaitingPeriodSec ?? null;
  const withdrawalWaitDays =
    withdrawalWaitSec === null ? null : Math.round(withdrawalWaitSec / 86_400);
  const [posRefresh, setPosRefresh] = useState(0);

  const bumpPortfolio = () => setPosRefresh((n) => n + 1);

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-line bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-6">
          <a href="/" className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-molten text-sm font-bold text-white">
              F
            </div>
            <span className="font-display font-semibold">foundry</span>
            <span className="ml-2 hidden text-sm text-muted sm:inline">/ transparency</span>
          </a>
          <nav className="flex shrink-0 items-center gap-3 text-sm text-muted sm:gap-4">
            {allVaults.length > 1 && (
              <select
                value={selectedPubkey}
                onChange={(e) => {
                  window.location.search = `?v=${e.target.value}`;
                }}
                className="rounded-full border border-line bg-soft px-3 py-1.5 font-mono text-xs outline-none transition hover:border-ember/50"
                title="switch vault"
              >
                {allVaults.map((v) => (
                  <option key={v.pubkey} value={v.pubkey}>
                    {(v.label ?? v.pubkey.slice(0, 8)).slice(0, 32)}
                  </option>
                ))}
              </select>
            )}
            <a href="/" className="hidden transition hover:text-ink sm:inline">
              home
            </a>
            <Link to="/vaults" className="hidden transition hover:text-ink sm:inline">
              vaults
            </Link>
            {canonical && (
              <a
                href={FDRY_JUPITER_URL}
                target="_blank"
                rel="noopener"
                className="hidden transition hover:text-ink md:inline"
              >
                buy FDRY
              </a>
            )}
            <a href="#deposit" className="transition hover:text-ink">
              deposit
            </a>
            <a
              href={`https://solscan.io/account/${selectedPubkey}`}
              target="_blank"
              rel="noopener"
              className="hidden transition hover:text-ink sm:inline"
            >
              solscan
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-20 pt-24 sm:px-6 sm:pb-24 sm:pt-28">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:mb-10 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 font-mono text-sm lowercase text-ember">
              // transparency
            </div>
            <h1 className="font-display text-[2.35rem] font-bold leading-[1.03] lowercase sm:text-4xl md:text-5xl">
              <span className="sm:hidden">
                <span className="molten-text">FDRY</span> vault, live.
              </span>
              <span className="hidden sm:inline">
                everything the <span className="molten-text">treasury</span> is doing.
              </span>
            </h1>
            <p className="mt-2 max-w-2xl font-mono text-sm text-muted">
              <span className="sm:hidden">
                // buy FDRY, deposit into the vault, verify the live state on-chain.
              </span>
              <span className="hidden sm:inline">
                // live state pulled straight from Solana RPC every 20s. withdraws use a
                3-day request queue, then claim. strategy evidence stays separate below.
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {live.error ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
                RPC error
              </span>
            ) : live.loading ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-ember/20 bg-sunrise px-3 py-1.5 text-xs font-medium text-ember">
                <span className="live-dot" />
                loading
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                live · {ageSec ?? 0}s ago
              </span>
            )}
          </div>
        </div>

        {live.error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 font-mono text-sm text-red-800">
            {live.error}
          </div>
        )}

        <section
          id="deposit"
          className="mb-8 grid items-start gap-6 sm:mb-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]"
        >
          <div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-2 font-mono text-sm lowercase text-ember">
                  // start here
                </div>
                <h2 className="font-display text-2xl font-bold lowercase md:text-3xl">
                  buy FDRY, deposit, get stFDRY
                </h2>
                <p className="mt-1 max-w-2xl font-mono text-sm lowercase text-muted">
                  buy FDRY on Jupiter, then deposit it into Voltr. two separate
                  steps, one clear path. exits are request → wait 3 days → claim.
                </p>
              </div>
              {canonical && (
                <a
                  href={FDRY_JUPITER_URL}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-ember/30 bg-sunrise px-4 py-2 text-sm font-semibold text-ember transition hover:bg-ember hover:text-white focus:outline-none focus:ring-2 focus:ring-ember focus:ring-offset-2 sm:whitespace-nowrap"
                >
                  Buy FDRY on Jupiter
                </a>
              )}
            </div>
            <DepositWidget
              vaultMint={lpMint}
              vaultPubkey={selectedPubkey}
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
              <p className="mt-1 font-mono text-sm lowercase text-muted">
                shares on-chain · cost-basis tracked locally · live P&amp;L
              </p>
            </div>
            <PortfolioPanel
              vaultPubkey={selectedPubkey}
              lpMint={lpMint}
              assetSymbol={assetSymbol}
              shareSymbol={shareSymbol}
              assetDecimals={assetDecimals}
              navPerShareInAsset={navPerShareInAsset}
              refreshKey={posRefresh}
            />
            <div className="mt-4 rounded-2xl border border-line bg-soft p-4 text-xs leading-relaxed text-muted">
              <span className="font-mono font-semibold text-ink">before deposit</span> ·
              Jupiter only buys FDRY for your wallet. Voltr mints stFDRY after
              you deposit. Withdrawals are not instant: request, wait 3 days, then
              claim your pro-rata share. Read{" "}
              <a href="#operator-discretion" className="text-ember hover:underline">
                exploratory work
              </a>{" "}
              before signing.
            </div>
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
          <Stat
            label="NAV (USD)"
            value={live.loading ? "..." : fmtUsd(live.navUsd)}
            sub={`${fmtNum(live.navUsd / (live.solPrice || 1), 4)} SOL equiv`}
            hint="// sum of vault token balances times price. native SOL rent not counted."
          />
          <Stat
            label="NAV / share"
            value={live.loading ? "..." : fmtUsd(live.navPerShareUsd, 4)}
            sub={`${fmtNum(live.sharesOutstanding, 3)} stFDRY outstanding`}
            hint="// NAV divided by shares outstanding."
          />
          <Stat
            label="SOL / USD"
            value={live.loading ? "..." : fmtUsd(live.solPrice)}
            sub="Pyth Hermes · live"
            hint="// SOL price from Pyth, refreshed every tick."
          />
          <Stat
            label="Native SOL (rent)"
            value={live.loading ? "..." : `${fmtNum(live.nativeSolBalance, 4)} SOL`}
            sub={fmtUsd(live.nativeSolBalance * live.solPrice)}
            hint="// rent SOL held by the vault account. FDRY lives in a PDA-owned ATA."
          />
          <Stat
            label="Withdraw lock"
            value={withdrawalWaitDays === null ? "..." : `${withdrawalWaitDays} days`}
            sub="request, wait, claim"
            hint="// on-chain withdrawal_waiting_period. instant withdraw is disabled while this is non-zero."
          />
        </section>

        <div className="mb-10 hidden font-mono text-xs lowercase text-muted sm:block">
          // reads: <code className="rounded bg-soft px-1 font-mono">getBalance(vault)</code>{" "}
          for rent SOL,{" "}
          <code className="rounded bg-soft px-1 font-mono">getTokenAccountBalance(idle_ata)</code>{" "}
          for FDRY held by Voltr's idle-auth PDA,{" "}
          <code className="rounded bg-soft px-1 font-mono">getTokenSupply(stFDRY_mint)</code>{" "}
          for shares, and{" "}
          <code className="rounded bg-soft px-1 font-mono">getSignaturesForAddress(vault)</code>{" "}
          for activity.
        </div>

        <section className="mb-10 rounded-3xl border border-line bg-white p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <h2 className="font-display text-xl font-semibold lowercase">
                nav / share over time
              </h2>
              <p className="mt-1 font-mono text-xs lowercase text-muted">
                // reconstructed from deposit and withdraw txs. each dot = one state change.
              </p>
            </div>
            <span className="font-mono text-xs text-muted">{assetSymbol}-denominated</span>
          </div>
          <NavChart vaultPubkey={selectedPubkey} lpMint={lpMint} />
        </section>

        <section className="mb-10 grid min-w-0 gap-6 md:grid-cols-5">
          <div className="min-w-0 rounded-2xl border border-line bg-white p-4 sm:rounded-3xl sm:p-6 md:col-span-3">
            <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h2 className="font-display text-xl font-semibold lowercase">live holdings</h2>
              <span className="font-mono text-xs lowercase text-muted sm:text-right">
                // direct from chain
              </span>
            </div>
            {live.loading ? (
              <div className="p-8 text-center text-sm text-muted">loading...</div>
            ) : live.holdings.length === 0 ? (
              <Empty
                title="no FDRY in the vault yet"
                body="deposits land instantly. stFDRY mints in the same tx, no keeper wait."
              />
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-soft text-muted">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">asset</th>
                      <th className="px-4 py-3 text-left font-medium">held at</th>
                      <th className="px-4 py-3 text-right font-medium">balance</th>
                      <th className="px-4 py-3 text-right font-medium">usd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.holdings.map((h) => (
                      <tr key={h.mint} className="border-t border-line">
                        <td className="px-4 py-3 font-mono font-semibold">
                          {h.symbol}
                          <a
                            href={`https://solscan.io/token/${h.mint}`}
                            target="_blank"
                            rel="noopener"
                            className="ml-2 text-xs text-muted hover:text-ember"
                          >
                            {shortAddr(h.mint)}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          {live.fdryAtaAddr ? (
                            <a
                              href={`https://solscan.io/account/${live.fdryAtaAddr}`}
                              target="_blank"
                              rel="noopener"
                              className="font-mono text-xs text-ember hover:underline"
                              title={live.fdryAtaAddr}
                            >
                              idle ATA {shortAddr(live.fdryAtaAddr)}
                            </a>
                          ) : (
                            <span className="font-mono text-xs text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {fmtNum(h.amount, h.decimals > 6 ? 6 : h.decimals)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(h.usd)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-line bg-soft/50">
                      <td colSpan={3} className="px-4 py-3 text-right font-semibold">
                        total nav
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">
                        {fmtUsd(live.navFromTokens)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 hidden font-mono text-xs lowercase text-muted sm:block">
              // clicking idle ATA opens the exact token account on Solscan. the balance
              there should match this table.
            </p>
          </div>

          <div className="min-w-0 space-y-4 rounded-2xl border border-line bg-soft p-4 sm:rounded-3xl sm:p-6 md:col-span-2">
            <h2 className="font-display text-xl font-semibold lowercase">addresses</h2>
            <div className="space-y-3 text-sm">
              <AddrRow label="vault" addr={selectedPubkey} />
              <AddrRow label="share mint (stFDRY)" addr={lpMint} isToken />
              <AddrRow label="creator / operator" addr={creatorWallet} />
              {live.fdryAtaAddr && (
                <AddrRow label="idle FDRY ATA" addr={live.fdryAtaAddr} />
              )}
              {live.idleAuthAddr && (
                <AddrRow label="idle-auth PDA" addr={live.idleAuthAddr} />
              )}
            </div>
            <div className="border-t border-line pt-3">
              <div className="mb-1 font-mono text-xs lowercase text-muted">// programs</div>
              <AddrRow label="voltr" addr="vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8" />
              <AddrRow label="lp mint (stFDRY)" addr="G8e9i9RADPsxJtiCJsGC4tSx2kgCkGbEkdn7aajt2nqW" isToken />
              <AddrRow label="FDRY asset mint" addr="2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL" isToken />
            </div>
            <div className="rounded-2xl border border-line bg-white p-4 font-mono text-xs lowercase leading-relaxed text-muted">
              // every number on this page is a direct RPC read. paste the pubkeys into
              Solscan and you should get the same state.
            </div>
          </div>
        </section>

        <section className="mb-10 rounded-3xl border-2 border-ember/30 bg-white p-6 md:p-8">
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase text-ember">// the strategy</span>
          </div>
          <h2 className="mb-4 font-display text-2xl font-bold lowercase md:text-3xl">
            <span className="molten-text">strategy work</span> is tracked, not promised.
          </h2>
          <div className="space-y-3 font-mono text-sm leading-relaxed text-ink/80 md:text-base">
            <p>
              The current strategy evidence comes from the linked public Polymarket
              account, not from hidden vault deployment or local paper logs. It is shown
              here so depositors can inspect what is being tested before any broader
              treasury decision.
            </p>
            <p>
              <span className="font-semibold text-ink">Current idea:</span> fade
              mid-event Polymarket rallies with a small account, monitor live positions,
              and keep spreads blocked after the 2026-05-15 review.
            </p>
            <p>
              <span className="font-semibold text-ink">Claim boundary:</span> no
              guaranteed return or market-beating claim. The panel can show open account
              state; it cannot promise future fills, outcomes, or gains.
            </p>
          </div>
        </section>

        <VaultExplainerCard />
        <PolymarketStrategyPanel />

        <section
          id="operator-discretion"
          className="mb-10 scroll-mt-24 rounded-3xl border-2 border-ember/30 bg-sunrise/40 p-6 md:p-8"
        >
          <div className="mb-3 flex items-baseline gap-3">
            <span className="font-mono text-xs uppercase text-ember">
              // read this before deposit
            </span>
          </div>
          <h2 className="mb-3 font-display text-2xl font-bold lowercase">
            exploratory work, no promised gains
          </h2>
          <div className="space-y-4 font-mono text-sm leading-relaxed text-ink/80">
            <p>
              This vault funds exploratory treasury work, not a promised yield strategy.
              The page exposes live holdings, the idle ATA, and recent transactions from
              Solana RPC and Solscan. That evidence lets you inspect what happened, but it
              does not protect NAV from bad routing, slippage, market moves, or protocol
              risk. Treat the vault as a transparent experiment, not a guarantee.
            </p>
            <p>
              The operator cut is <span className="font-semibold text-ink">0.69% of realized profits only.</span>{" "}
              If the vault has no realized profit, there is no profit cut; if NAV falls,
              stFDRY holders bear that loss pro-rata. This ties the fee to outcomes instead
              of deposits, while still leaving capital at risk. The honest promise is fee
              clarity and public evidence, not gains.
            </p>
          </div>
        </section>

        <section className="mb-10 rounded-3xl border border-line bg-white p-6">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-semibold lowercase">recent activity</h2>
            <a
              href={`https://solscan.io/account/${selectedPubkey}`}
              target="_blank"
              rel="noopener"
              className="font-mono text-xs text-ember hover:underline"
            >
              all txs on solscan
            </a>
          </div>
          {live.loading ? (
            <div className="p-8 text-center text-sm text-muted">loading...</div>
          ) : live.activity.length === 0 ? (
            <Empty
              title="no txs yet"
              body="deposits, swaps, and buybacks will stream here as they settle on Solana."
            />
          ) : (
            <ul className="divide-y divide-line">
              {live.activity.map((a) => {
                const ok = !a.err;
                return (
                  <li
                    key={a.signature}
                    className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={
                          "rounded-md px-2 py-0.5 font-mono text-xs uppercase " +
                          (ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
                        }
                      >
                        {ok ? "success" : "failed"}
                      </span>
                      <span className="text-sm">{a.humanKind}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted">
                      <span className="tabular-nums">{fmtTs(a.blockTime)}</span>
                      <a
                        href={`https://solscan.io/tx/${a.signature}`}
                        target="_blank"
                        rel="noopener"
                        className="font-mono text-ember hover:underline"
                      >
                        {a.signature.slice(0, 8)}...
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-5 space-y-1 rounded-2xl border border-line bg-soft p-4 text-xs leading-relaxed text-muted">
            <div>
              <span className="font-mono font-semibold text-ink">success</span> - tx landed
              on-chain and state changed.
            </div>
            <div>
              <span className="font-mono font-semibold text-ink">failed · LP ATA missing</span>{" "}
              - Voltr error 3012 <code className="font-mono">AccountNotInitialized</code>.
              Your stFDRY associated token account has not been created yet. Retry or create
              the ATA manually.
            </div>
            <div>
              <span className="font-mono font-semibold text-ink">
                failed · instant withdraw not allowed
              </span>{" "}
              - Voltr error 6015 <code className="font-mono">InstantWithdrawNotAllowed</code>.
              This vault has a 3-day withdraw queue. Use the withdraw tab to submit a request,
              wait for unlock, then claim.
            </div>
          </div>
        </section>

        <section className="mb-10 rounded-3xl border border-line bg-soft p-6 md:p-8">
          <h2 className="mb-6 font-display text-2xl font-bold lowercase">
            how it all fits
          </h2>
          <div className="grid gap-6 text-sm md:grid-cols-2">
            <Explainer step="1" title="you deposit">
              You sign a <code className="rounded bg-white px-1 font-mono">deposit</code>{" "}
              instruction against the Voltr program. FDRY moves into the vault idle ATA,
              and stFDRY mints to your wallet in the same transaction.
            </Explainer>
            <Explainer step="2" title="the vault explores">
              Deposited FDRY starts in the idle ATA. It can be used for exploratory
              treasury work: swaps, liquidity tests, routing experiments, and strategy
              research. No gain is promised. If realized profit exists, the operator cut
              is 0.69% of profit.
            </Explainer>
            <Explainer step="3" title="revenue can route back">
              When Unbrowse revenue routes to the vault, it can buy FDRY on-market and
              deposit it. That can raise NAV per share, but it is a mechanism to verify,
              not a promise of future gains.
            </Explainer>
            <Explainer step="4" title="you withdraw">
              You sign <code className="rounded bg-white px-1 font-mono">request_withdraw</code>{" "}
              first. Voltr escrows your stFDRY for 3 days, then you sign{" "}
              <code className="rounded bg-white px-1 font-mono">withdraw</code> to claim
              your pro-rata share of whatever the vault holds at that moment.
            </Explainer>
            <Explainer step="5" title="if something fails">
              Solana transactions are atomic. If a deposit or withdraw fails, the
              transaction reverts and your tokens stay in your wallet minus gas. The
              activity log gives you a signature to inspect.
            </Explainer>
          </div>
        </section>

        <p className="mt-8 text-center text-xs leading-relaxed text-muted/70">
          Not financial advice. Experimental on-chain treasury with exploratory work, no
          promised gains. Capital at risk; NAV can go down. Operator cut is 0.69% of
          realized profit only. Withdrawals use Voltr's 3-day request queue.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <div className="group relative rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="mb-2 text-xs uppercase text-muted">{label}</div>
      <div className="font-display text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
      {hint && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 hidden rounded-xl bg-ink p-3 text-xs leading-relaxed text-white shadow-xl group-hover:block">
          {hint}
        </div>
      )}
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-soft p-8 text-center">
      <div className="mb-1 font-display font-semibold">{title}</div>
      <div className="text-sm text-muted">{body}</div>
    </div>
  );
}

function AddrRow({ label, addr, isToken = false }: { label: string; addr: string; isToken?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-line/60 py-1.5 last:border-0">
      <dt className="min-w-0 text-sm text-muted">{label}</dt>
      <dd className="shrink-0">
        <a
          href={`https://solscan.io/${isToken ? "token" : "account"}/${addr}`}
          target="_blank"
          rel="noopener"
          className="font-mono text-xs text-ink hover:text-ember"
        >
          {shortAddr(addr)}
        </a>
      </dd>
    </div>
  );
}

function Explainer({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sunrise font-mono text-xs font-semibold text-ember">
          {step}
        </span>
        <h3 className="font-display font-semibold">{title}</h3>
      </div>
      <p className="leading-relaxed text-muted">{children}</p>
    </div>
  );
}
