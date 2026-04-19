import { useLiveTreasury } from "../hooks/useLiveTreasury";
import { DepositWidget } from "../components/DepositWidget";

const VAULT_PUBKEY = "EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc";
const VAULT_MINT = "FwW1GEyvCx7q96wm4AYEGEUSFnNYozjxPwBaXWmcJeh7";
const CREATOR_WALLET = "8n7QzgDuEiQUxCXNb7VSiq3fenA2UjeMTUhoiPK7QGR8";

const fmtUsd = (n: number, d = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
const fmtNum = (n: number, d = 4) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d > 0 ? Math.min(d, 4) : 0, maximumFractionDigits: d });
const shortAddr = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const fmtTs = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString() : "—");

export default function VaultPage() {
  const live = useLiveTreasury(VAULT_PUBKEY, VAULT_MINT);
  const ageSec = live.updatedAt ? Math.max(0, Math.floor((Date.now() - live.updatedAt) / 1000)) : null;

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* NAV */}
      <header className="fixed top-0 inset-x-0 z-30 bg-white/80 backdrop-blur-md border-b border-line">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-molten flex items-center justify-center text-white font-display font-bold text-sm">F</div>
            <span className="font-display font-semibold tracking-tight">Foundry</span>
            <span className="text-muted text-sm ml-2 hidden sm:inline">/ transparency</span>
          </a>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href="/" className="hover:text-ink transition">Home</a>
            <a href="#deposit" className="hover:text-ink transition">Deposit</a>
            <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="hover:text-ink transition">Solscan ↗</a>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-28 pb-24">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
          <div>
            <div className="text-sm font-medium text-ember mb-3 uppercase tracking-wider">Transparency</div>
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              Everything the <span className="molten-text">treasury</span> is doing.
            </h1>
            <p className="text-muted mt-2 max-w-2xl">
              Live state pulled directly from Solana RPC every 20 seconds. No server in between; every number here is derived from public on-chain data you can verify yourself on Solscan.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {live.error ? (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-medium">
                ✗ RPC error
              </span>
            ) : live.loading ? (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sunrise text-ember border border-ember/20 text-xs font-medium">
                <span className="live-dot"></span> loading…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> live · {ageSec ?? 0}s ago
              </span>
            )}
          </div>
        </div>

        {live.error && (
          <div className="mb-6 p-4 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-sm font-mono">
            {live.error}
          </div>
        )}

        {/* STATS */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Stat label="NAV (USD)" value={live.loading ? "…" : fmtUsd(live.navUsd)} sub={`${fmtNum(live.navUsd / (live.solPrice || 1), 4)} SOL equiv`} hint="Sum of all token balances × their USD price. Excludes the vault account's native rent." />
          <Stat label="NAV / share" value={live.loading ? "…" : fmtUsd(live.navPerShareUsd, 4)} sub={`${fmtNum(live.sharesOutstanding, 3)} stFDRY outstanding`} hint="What one stFDRY share is backed by today. NAV ÷ shares." />
          <Stat label="SOL / USD" value={live.loading ? "…" : fmtUsd(live.solPrice)} sub="Pyth Hermes · live" hint="SOL price from Pyth Network. Refreshed with every tick." />
          <Stat label="Native SOL (rent)" value={live.loading ? "…" : `${fmtNum(live.solBalance, 4)} SOL`} sub={fmtUsd(live.solBalance * live.solPrice)} hint="SOL held directly by the vault account for rent. Not part of NAV — the investable assets live in token accounts below." />
        </section>

        <div className="text-xs text-muted mb-10">
          Every number above is derived from three RPC reads: <code className="font-mono bg-soft px-1 rounded">getBalance(vault)</code>, <code className="font-mono bg-soft px-1 rounded">getTokenAccountsByOwner(vault)</code>, and <code className="font-mono bg-soft px-1 rounded">getTokenSupply(stFDRY_mint)</code>.
        </div>

        {/* HOLDINGS */}
        <section className="grid md:grid-cols-5 gap-6 mb-10">
          <div className="md:col-span-3 rounded-3xl border border-line bg-white p-6">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="font-display text-xl font-semibold">Live holdings</h2>
              <span className="text-xs text-muted">all SPL token accounts owned by the vault</span>
            </div>
            {live.loading ? (
              <div className="p-8 text-center text-muted text-sm">loading…</div>
            ) : live.holdings.length === 0 ? (
              <Empty title="Vault has no token holdings yet" body="Once a deposit clears the Symmetry keeper, WSOL or USDC will appear here. Until then, this stays zero." />
            ) : (
              <div className="overflow-hidden rounded-2xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-soft text-muted">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Asset</th>
                      <th className="text-left px-4 py-3 font-medium">Mint</th>
                      <th className="text-right px-4 py-3 font-medium">Balance</th>
                      <th className="text-right px-4 py-3 font-medium">USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.holdings.map((h) => (
                      <tr key={h.mint} className="border-t border-line">
                        <td className="px-4 py-3 font-mono font-semibold">{h.symbol}</td>
                        <td className="px-4 py-3">
                          <a href={`https://solscan.io/token/${h.mint}`} target="_blank" rel="noopener" className="font-mono text-xs text-muted hover:text-ember">
                            {shortAddr(h.mint)} ↗
                          </a>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtNum(h.amount, h.decimals > 6 ? 6 : h.decimals)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtUsd(h.usd)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-line bg-soft/50">
                      <td colSpan={3} className="px-4 py-3 text-right font-semibold">Total NAV</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums">{fmtUsd(live.navFromTokens)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="md:col-span-2 rounded-3xl border border-line bg-soft p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold">Addresses</h2>
            <div className="space-y-3 text-sm">
              <AddrRow label="Vault" addr={VAULT_PUBKEY} />
              <AddrRow label="Share mint (stFDRY)" addr={VAULT_MINT} isToken />
              <AddrRow label="Creator / operator" addr={CREATOR_WALLET} />
            </div>
            <div className="pt-3 border-t border-line">
              <div className="text-xs text-muted mb-1">Programs</div>
              <AddrRow label="Symmetry" addr="BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate" />
            </div>
            <div className="p-4 rounded-2xl bg-white border border-line text-xs italic text-muted leading-relaxed">
              "The Lord detests dishonest scales, but accurate weights find favor with him." — Proverbs 11:1
            </div>
          </div>
        </section>

        {/* DEPOSIT */}
        <section id="deposit" className="mb-10">
          <div className="mb-4">
            <h2 className="font-display text-2xl font-bold">Deposit</h2>
            <p className="text-muted text-sm mt-1">Direct on-chain · Phantom wallet · no custody</p>
          </div>
          <div className="max-w-2xl">
            <DepositWidget vaultMint={VAULT_MINT} vaultPubkey={VAULT_PUBKEY} solPriceUsd={live.solPrice} navPerShareUsd={live.navPerShareUsd} />
          </div>
        </section>

        {/* ACTIVITY */}
        <section className="rounded-3xl border border-line bg-white p-6 mb-10">
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-display text-xl font-semibold">Recent on-chain activity</h2>
            <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="text-xs text-ember hover:underline">
              all txs on Solscan ↗
            </a>
          </div>
          {live.loading ? (
            <div className="p-8 text-center text-muted text-sm">loading…</div>
          ) : live.activity.length === 0 ? (
            <Empty title="No transactions yet" body="Deposits, trades, and buybacks will stream here as they settle on Solana." />
          ) : (
            <ul className="divide-y divide-line">
              {live.activity.map((a) => {
                const ok = !a.err;
                return (
                  <li key={a.signature} className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={"px-2 py-0.5 rounded-md text-xs font-mono uppercase " + (ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                        {ok ? "success" : "failed"}
                      </span>
                      <span className="text-sm">{a.humanKind}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted">
                      <span className="tabular-nums">{fmtTs(a.blockTime)}</span>
                      <a href={`https://solscan.io/tx/${a.signature}`} target="_blank" rel="noopener" className="text-ember hover:underline font-mono">
                        {a.signature.slice(0, 8)}… ↗
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-5 p-4 rounded-2xl bg-soft border border-line text-xs text-muted leading-relaxed space-y-1">
            <div><span className="font-mono font-semibold text-ink">success</span> — tx landed on-chain and state changed.</div>
            <div><span className="font-mono font-semibold text-ink">failed · rejected · deposits locked</span> — Symmetry error 6075. The vault is in Genesis and won't accept new buys until the keeper processes the seed batch. No SOL is taken; failed txs roll back atomically.</div>
            <div><span className="font-mono font-semibold text-ink">failed · rejected · custom N</span> — some other Symmetry program error. Click the signature to see full logs on Solscan.</div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="rounded-3xl border border-line bg-soft p-6 md:p-8 mb-10">
          <h2 className="font-display text-2xl font-bold mb-6">How the whole thing works</h2>
          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <Explainer step="1" title="You deposit">
              You sign a <code className="font-mono bg-white px-1 rounded">buyVaultTx</code> + <code className="font-mono bg-white px-1 rounded">lockDepositsTx</code> pair in Phantom. The SDK wraps your SOL into WSOL and moves it into the vault's token account. You don't get shares yet — that happens in step 2.
            </Explainer>
            <Explainer step="2" title="Keeper processes the batch">
              Symmetry runs an off-chain keeper that watches for locked deposits. When it fires, it mints stFDRY proportional to your contribution vs the NAV, and the WSOL is added to the vault's basket. During Genesis this can take an hour. After that it's usually a few minutes.
            </Explainer>
            <Explainer step="3" title="The bot rebalances">
              A cron reads the target weights from a signal file and calls Jupiter via Symmetry's <code className="font-mono bg-white px-1 rounded">makeDirectSwapTx</code>. Every trade is a public tx on this page. Default is equal-weight across the basket; the truth-optimised ranker only gets a vote when its confidence crosses a threshold.
            </Explainer>
            <Explainer step="4" title="Revenue routes back">
              When an Unbrowse customer pays, a share of it is converted to SOL and sent directly to the vault as a buyback. NAV rises → NAV-per-share rises → every holder benefits proportionally, no claim step.
            </Explainer>
            <Explainer step="5" title="You withdraw">
              You sign <code className="font-mono bg-white px-1 rounded">sellVaultTx</code> + <code className="font-mono bg-white px-1 rounded">redeemTokensTx</code>. You get back underlying assets pro-rata (not cash — whatever's in the basket). 50 bp exit fee stays with remaining holders. Operator cannot block this.
            </Explainer>
            <Explainer step="6" title="If something fails">
              Solana transactions are atomic. If any step fails (slippage, insufficient balance, Genesis lock), the entire tx reverts and your SOL stays in your wallet minus gas. Every failure is visible in the activity log above with a signature you can trace.
            </Explainer>
          </div>
        </section>

        <p className="text-xs text-muted/70 mt-8 text-center leading-relaxed">
          Not financial advice. Experimental on-chain treasury — capital at risk. Don't deposit what you can't afford to lose. Operator cannot freeze funds; withdraw any time.
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
        <div className="absolute inset-x-0 top-full mt-1 z-10 hidden group-hover:block p-3 rounded-xl bg-ink text-white text-xs leading-relaxed shadow-xl">
          {hint}
        </div>
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
        <a
          href={`https://solscan.io/${isToken ? "token" : "account"}/${addr}`}
          target="_blank"
          rel="noopener"
          className="font-mono text-xs text-ink hover:text-ember"
        >
          {shortAddr(addr)} ↗
        </a>
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
