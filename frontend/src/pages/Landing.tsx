import { useEffect, useState } from "react";
import { DepositWidget } from "../components/DepositWidget";
import { useLiveTreasury } from "../hooks/useLiveTreasury";

const VAULT_PUBKEY = "Bpr49sQXsxwNXNMRWS2v3tTBGWu2QgZtdA83BX77xBX1";
const VAULT_MINT = "G8e9i9RADPsxJtiCJsGC4tSx2kgCkGbEkdn7aajt2nqW";
const CREATOR_WALLET = "HotWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const FDRY_MINT = "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL";
const FDRY_POOL = "2jC1LpGY1ZjL9UerTFDmTNM4kc2AhHydK4tqqqgbJdhh";
const GECKO_API = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${FDRY_POOL}`;
const SOLANA_RPC = "https://solana-rpc.publicnode.com";

interface LedgerSnapshot {
  nav_fdry?: number;
  nav_usd?: number;
  depositors?: number;
  ts?: string;
  shares_outstanding?: number;
}

export default function Landing() {
  const [snap, setSnap] = useState<LedgerSnapshot | null>(null);
  const live = useLiveTreasury(VAULT_PUBKEY, VAULT_MINT);
  const [mcap, setMcap] = useState<string>("—");
  const [supply, setSupply] = useState<string>("—");

  useEffect(() => {
    const loadSnap = async () => {
      try {
        const r = await fetch("/ledger/latest.json", { cache: "no-store" });
        if (r.ok) setSnap(await r.json());
      } catch { /* ignore */ }
    };
    loadSnap();
    const t = setInterval(loadSnap, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const loadToken = async () => {
      try {
        const rpc = await fetch(SOLANA_RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [FDRY_MINT] }),
        });
        const rpcJson = await rpc.json();
        const v = rpcJson?.result?.value;
        if (v?.amount && typeof v.decimals === "number") {
          const n = Number(v.amount) / Math.pow(10, v.decimals);
          setSupply(n.toLocaleString(undefined, { maximumFractionDigits: 0 }));
        }
        const g = await fetch(GECKO_API);
        const gj = await g.json();
        const fdv = parseFloat(gj?.data?.attributes?.fdv_usd ?? "0");
        if (fdv > 0) {
          setMcap(fdv >= 1_000_000 ? `$${(fdv / 1_000_000).toFixed(2)}M`
            : fdv >= 1_000 ? `$${(fdv / 1_000).toFixed(1)}K` : `$${fdv.toFixed(0)}`);
        }
      } catch { /* ignore */ }
    };
    loadToken();
  }, []);

  const shortKey = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

  return (
    <div className="min-h-screen bg-white text-ink">
      {/* NAV */}
      <header className="fixed top-0 inset-x-0 z-30 bg-white/80 backdrop-blur-md border-b border-line">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-molten flex items-center justify-center text-white font-display font-bold text-sm">F</div>
            <span className="font-display font-semibold tracking-tight">Foundry</span>
          </a>
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted">
            <a href="#vision" className="hover:text-ink transition">vision</a>
            <a href="#products" className="hover:text-ink transition">products</a>
            <a href="/vault" className="hover:text-ink transition">vault</a>
            <a href="#why" className="hover:text-ink transition">why</a>
          </nav>
          <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="px-4 py-2 bg-molten text-white text-sm font-mono hover:opacity-90 transition">
            [ try unbrowse → ]
          </a>
        </div>
      </header>

      {/* HERO */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div aria-hidden className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-3xl bg-gradient-to-br from-ember/20 via-flame/10 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="molten-ring shadow-2xl">
            <div className="bg-white rounded-[2.8rem] px-8 py-16 sm:px-16 sm:py-24 relative overflow-hidden">
              {/* floating sparks */}
              {[0,1,2,3,4,5].map((i) => (
                <span key={i} className="spark" style={{ left: `${15 + i * 14}%`, top: `${30 + (i % 3) * 18}%`, animationDelay: `${i * 0.35}s` }} />
              ))}
              <div className="relative max-w-4xl mx-auto text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ember/20 bg-sunrise text-ember text-sm font-mono mb-8">
                  <span className="live-dot"></span>
                  backed by nvidia · vault is on-chain lol
                </div>
                <h1 className="font-display text-5xl sm:text-6xl lg:text-[5.5rem] font-bold leading-[1.05] tracking-tight mb-6 lowercase text-balance">
                  forging the tools to{" "}
                  <span className="molten-text">compete with giants</span>.
                </h1>
                <p className="font-mono text-sm sm:text-base text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
                  tiny ai-native startup shipping specialized agents. unbrowse is live (free, go try). product revenue swaps into FDRY and drops straight into the vault. stFDRY holders just sit there and watch NAV go up. thats the whole mechanism lol.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center font-mono text-sm">
                  <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="group flex items-center justify-center gap-2 px-6 py-3 bg-molten text-white font-medium hover:opacity-95 active:translate-y-px transition-all shadow-lg shadow-ember/20">
                    [ try unbrowse <span className="group-hover:translate-x-0.5 transition-transform">→</span> ]
                  </a>
                  <a href="#deposit" className="group flex items-center justify-center gap-2 px-6 py-3 border border-ember/40 text-ember hover:bg-sunrise active:translate-y-px transition-all">
                    [ stake fdry <span className="group-hover:translate-x-0.5 transition-transform">→</span> ]
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* TRUST GRID */}
          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto">
            <TrustCard label="Backed by" value="NVIDIA Inception" accent="nvidia" />
            <TrustCard label="FDRY market cap" value={mcap} />
            <TrustCard label="FDRY supply" value={supply} />
            <TrustCard label="Unbrowse" value="197 WAU · live" />
          </div>
        </div>
      </section>

      {/* VISION */}
      <section id="vision" className="py-24 bg-soft border-y border-line">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// vision</div>
              <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-[1.1] lowercase">
                tools we use to <span className="molten-text">scale ourselves</span>.
              </h2>
              <p className="text-lg text-muted leading-relaxed mb-8">
                tiny ai-native startup. we build agents for ourselves first — if they survive our workflow they ship, if not they die. no venture round, no fake tvl. product revenue swaps into FDRY and drops into the vault. thats the whole loop.
              </p>
              <p className="text-base text-muted/90 leading-relaxed">
                result: a parent treasury w/ verifiable capital, products shipping next to it, and a buyback flywheel that compounds as the products grow. no rebalancing, no memecoin basket, no yield promise. just receipts.
              </p>
            </div>
            <div className="space-y-4">
              <FeatureCard title="ai-native day one" body="we dogfood everything. if it doesnt survive us, it doesnt ship. nothing is a demo." />
              <FeatureCard title="specialized not generic" body="each agent does one thing. unbrowse = shared browser routes. truth-signal = honest allocation tiebreaker. neither tries to be a platform." />
              <FeatureCard title="transparent by construction" body="capital on-chain. trades on-chain. metrics public. if u cant audit it, it didnt ship." />
            </div>
          </div>
        </div>
      </section>

      {/* DAVID — THE UNDERDOG BASKET */}
      <section id="david" className="py-24 border-b border-line">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// david</div>
              <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-[1.1] lowercase">
                david — the <span className="molten-text">outcome basket</span>.
              </h2>
              <p className="text-lg text-muted leading-relaxed mb-6">
                david is the small scalping bot sitting under the vault. every ~30s it clusters 39 solana tokens by recent behavior and picks the <span className="text-ink font-semibold">outcome</span> — the beaten-down token closest to the center of the laggard cluster, statistically overdue for a bounce. it goes long that one, holds 4h, exits. that's the whole algorithm. no ml, no ai — k-means + a pick-the-outcome rule.
              </p>
              <p className="text-base text-muted/90 leading-relaxed mb-6">
                <span className="text-ink font-semibold">in layman terms:</span> the vault uses some idle FDRY to bet on outcomes that are primed to appreciate. when the outcome pumps, the bot scalps it back into FDRY at a higher price — that's a <span className="text-ink font-semibold">buy on FDRY</span> funded by someone else's rally. every successful round-trip lifts nav-per-share for every stFDRY holder. giants pay &lt;1bp and see orderflow; we pay ~60bp to jupiter and publish every fill. david fights uphill, on purpose.
              </p>
              <p className="text-base text-muted/90 leading-relaxed">
                <span className="text-ink font-semibold">expect volatility — both FDRY and stFDRY.</span> scalps can miss. outcomes can keep bleeding. nav-per-share will wobble before it compounds. what you're buying is a transparent process, not a smooth yield. every trade lands on-chain — u can audit the full history anytime.
              </p>
              <blockquote className="mt-6 border-l-2 border-ember pl-4 py-1 text-ink italic font-mono text-sm lowercase">
                "forging the tools to compete with giants."
              </blockquote>
            </div>
            <div className="space-y-4">
              <FeatureCard title="pick the outcome" body="every 30s: 4 features per token (1h return, vol, drawdown, momentum), k-means k=7, pick the representative of the losing cluster, go long 4h with a 0.75% trailing stop. the beaten-down tokens mean-revert more than the champions continue." />
              <FeatureCard title="scalp back into FDRY" body="when the outcome appreciates, the bot closes and routes proceeds back into FDRY via jupiter. each successful cycle = net FDRY buy pressure + nav-per-share goes up. fees on by default — u can toggle." />
              <FeatureCard title="honest about volatility" body="we don't promise profit. outcomes can stay down. both FDRY and stFDRY will swing. what we promise: every trade on-chain, every timeframe on a fees-on/off toggle, every dead experiment in the commit log." />
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCTS */}
      <section id="products" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// products</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4 lowercase">
              specialized agents for <span className="molten-text">real work</span>.
            </h2>
            <p className="text-lg text-muted max-w-2xl mx-auto">
              code, content, capital — one thing each. if it survives our workflow it ships. if it ships it makes money. if it makes money the vault eats.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* UNBROWSE */}
            <div className="group rounded-3xl border border-line bg-white p-8 hover:shadow-xl transition">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-molten flex items-center justify-center text-white font-display font-bold">01</div>
                  <div>
                    <div className="font-display text-lg font-semibold">Unbrowse</div>
                    <div className="text-xs text-muted">shipped · available now</div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">live</span>
              </div>
              <h3 className="font-display text-2xl font-bold mb-3 tracking-tight lowercase">
                a shared route graph for ai agents.
              </h3>
              <p className="text-muted leading-relaxed mb-6">
                browser automation that isnt flaky. agents hit shared routes instead of spinning up a headless browser every time. cheaper, faster, coverage compounds. 100x faster, 95% cheaper, free &amp; open-source. go try it lol.
              </p>
              <div className="grid grid-cols-3 gap-3 pt-6 border-t border-line">
                <div>
                  <div className="text-xs text-muted mb-1 lowercase">wau</div>
                  <div className="font-display font-bold text-ink">197</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1 lowercase">api keys</div>
                  <div className="font-display font-bold text-ink">819</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1 lowercase">npm</div>
                  <div className="font-display font-bold text-ink">5.4k</div>
                </div>
              </div>
              <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 mt-6 text-ember font-mono text-sm hover:gap-2.5 transition-all">
                [ explore unbrowse → ]
              </a>
            </div>

            {/* EBM RANKER */}
            <div className="group rounded-3xl border border-line bg-white p-8 hover:shadow-xl transition">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-molten flex items-center justify-center text-white font-display font-bold">02</div>
                  <div>
                    <div className="font-display text-lg font-semibold">Truth-optimised signal</div>
                    <div className="text-xs text-muted">live · eval mode</div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">eval</span>
              </div>
              <h3 className="font-display text-2xl font-bold mb-3 tracking-tight">
                a truth-weighted signal for capital rotation.
              </h3>
              <p className="text-muted leading-relaxed mb-6">
                a tiny model we trained on a weird corpus (yes, really). it does <span className="font-semibold text-ink">not</span> drive the vault — stFDRY is 1:1 FDRY, receipts-only. the signal ships as its own thing, gets evaluated in public, and only earns activation if it beats the honest baseline. until then its just a side quest lol.
              </p>
              <div className="grid grid-cols-3 gap-3 pt-6 border-t border-line">
                <div>
                  <div className="text-xs text-muted mb-1">vault policy</div>
                  <div className="font-display font-bold text-ink">FDRY 1:1</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">rebalancing</div>
                  <div className="font-display font-bold text-ink">none</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">activation gate</div>
                  <div className="font-display font-bold text-ink">≥ 0.5</div>
                </div>
              </div>
              <div className="text-xs font-mono text-muted/80 mt-4 lowercase">
                {"// honest weights or gtfo — the whole thing is on-chain so u can verify every number urself"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TREASURY */}
      <section id="treasury" className="py-24 bg-soft border-y border-line">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// treasury</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">
              the parent <span className="molten-text">treasury</span>, on solana.
            </h2>
            <p className="text-lg text-muted max-w-2xl mx-auto">
              the vault is custody + working capital. FDRY sits inside, and lewis can draw against it to fund the quant fund + the other products hes building (unbrowse, the signal, whatevers next). he does his best to repay holders in FDRY over time via revenue buybacks — "over time" is proven by nav-per-share going up on the chart. no rebalancing, no basket, no yield promise. just receipts.
            </p>
          </div>

          {/* Genesis state banner */}
          {live.navUsd === 0 && !live.loading && (
            <div className="max-w-5xl mx-auto mb-8 flex items-center gap-3 p-4 rounded-2xl border border-ember/20 bg-sunrise text-ember font-mono text-sm">
              <span className="live-dot"></span>
              <div>
                <span className="font-semibold">genesis · seeding.</span>{" "}
                <span className="text-ember/80">vault is live on-chain. drop FDRY in below — stFDRY mints same tx, no keeper wait.</span>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-4 gap-4 max-w-5xl mx-auto mb-10">
            <Stat label="TVL (FDRY)" value={live.loading ? "…" : live.fdryBalance.toFixed(4)} />
            <Stat label="NAV (USD)" value={live.loading ? "…" : `$${live.navUsd.toFixed(2)}`} />
            <Stat label="Shares outstanding" value={live.loading ? "…" : live.sharesOutstanding.toLocaleString()} />
            <Stat label="SOL / USD" value={live.loading ? "…" : `$${live.solPrice.toFixed(2)}`} />
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-10">
            <Step n="01" title="deposit">
              drop in FDRY. u get <span className="font-mono font-semibold">stFDRY</span> back — a 1:1 claim on the vault's FDRY. no minimum, no lockup, no vibes check.
            </Step>
            <Step n="02" title="hold + fund">
              the vault is working capital. what sits inside funds the quant fund + the other products lewis is building — unbrowse, the signal, whatever ships next. lewis draws against it to keep things alive, and does his best to repay in FDRY over time via product revenue + scalps routed back in as <a href="/vault" className="text-ember hover:underline">on-chain buybacks</a>. "over time" isnt a promise — its a chart. watch nav-per-share. if the line goes up, repayment is happening. if it doesnt, it isnt. every tx is public.
            </Step>
            <Step n="03" title="withdraw">
              burn stFDRY to redeem your FDRY, pro-rata. instant. the operator cannot freeze funds — we literally cant.
            </Step>
          </div>

          <div id="deposit" className="max-w-2xl mx-auto mb-8">
            <DepositGate>
              <DepositWidget vaultMint={VAULT_MINT} vaultPubkey={VAULT_PUBKEY} />
            </DepositGate>
          </div>

          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border border-line bg-white">
            <div className="flex flex-wrap gap-6 text-xs font-mono text-muted">
              <span>vault <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="text-ink hover:text-ember">{shortKey(VAULT_PUBKEY)}</a></span>
              <span>mint <a href={`https://solscan.io/token/${VAULT_MINT}`} target="_blank" rel="noopener" className="text-ink hover:text-ember">{shortKey(VAULT_MINT)}</a></span>
              <span>creator <a href={`https://solscan.io/account/${CREATOR_WALLET}`} target="_blank" rel="noopener" className="text-ink hover:text-ember">{shortKey(CREATOR_WALLET)}</a></span>
            </div>
            <div className="flex gap-2">
              <a href="/vault" className="px-4 py-2 rounded-lg bg-molten text-white text-sm font-mono hover:opacity-95 transition">
                [ full transparency → ]
              </a>
              <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="px-4 py-2 rounded-lg border border-line text-ink text-sm font-mono hover:bg-soft transition">
                [ verify on solscan ]
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* WHY FOUNDRY */}
      <section id="why" className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// why foundry</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              why <span className="molten-text">this</span>, why now.
            </h2>
          </div>
          <div className="space-y-4">
            <FAQ q="why specialized agents?">
              generic ai tools try to do everything and end up doing nothing particularly well. we build agents that excel at one function — unbrowse for shared browser routes, the truth-optimised signal for honest allocation. each one gets battle-tested in our own workflows before we ship it.
            </FAQ>
            <FAQ q="why an on-chain treasury?">
              old plan: liquid staking via a third party with opaque accounting. new plan: a vault on solana where every deposit, buyback, and withdraw is a public tx. if we're asking u to trust the economics, the economics shouldnt require trust.
            </FAQ>
            <FAQ q="how does revenue flow back to holders?">
              products make money; a share is converted to FDRY (via jupiter) and deposited into the vault as buybacks. nav-per-share goes up for every holder; no new shares mint to the product team. every routing has an on-chain memo (<span className="font-mono">source_revenue_YYYY_W##</span>) and shows up in <span className="font-mono">ledger/revenue.jsonl</span>. policy per product (current cut, cadence, trigger) lives in the public repo at <span className="font-mono">docs/REVENUE_POLICY.md</span>. current routed revenue: $0 — this is mechanism + reference implementation, not a binding commitment until the first routing lands on-chain.
            </FAQ>
            <FAQ q="where does my FDRY actually go?">
              straight up: the vault is working capital for what lewis is building. lewis can draw against whats inside to fund the quant fund + the other products (unbrowse, the signal, whatevers next). he'll do his best to repay holders in FDRY over time — via product revenue buybacks and scalps routed back in. "over time" isnt a vibe, its a chart. if nav-per-share trends up, repayment is landing. if it doesnt, it isnt. no promises, just receipts. the chart is the proof.
            </FAQ>
            <FAQ q="wait — if i stake FDRY, is FDRY getting sold to buy stFDRY?">
              no. staking is a deposit, not a swap. u drop FDRY into the vault, u get stFDRY back as a receipt for ur share of the vault's FDRY. the FDRY stays inside the vault. stFDRY is just the claim ticket — it literally represents FDRY that's already sitting there.
              <br/><br/>
              the only time FDRY leaves the vault is when <span className="text-ink font-semibold">david</span> (the outcome bot) takes some idle FDRY and rotates it thru a trade — sell FDRY for an outcome token, wait for it to bounce, swap back into FDRY at a higher price. net effect when a trade works: <span className="text-ink font-semibold">more FDRY comes back than went out</span>, so nav-per-share climbs for every stFDRY holder. net effect when a trade misses: less FDRY comes back, nav dips. both show up on-chain.
              <br/><br/>
              <span className="text-ink font-semibold">short-term reality check:</span> yes, u'll see downward pressure sometimes. outcome scalps lose money too. both FDRY (the token) and stFDRY (the nav-per-share) will be volatile before they compound. this is discretionary treasury w/ a founder attached, not a yield product. dont deposit what u cant afford to watch wobble.
            </FAQ>
            <FAQ q="do u guys actually trade the vault?">
              default mode: pure custody. what u deposit is what u can withdraw. BUT — sometimes we like to scalp. <span className="text-ink font-semibold">david</span> has adaptors for jupiter / drift / kamino / raydium, so occasionally we may route some of the idle FDRY thru a short trade to try to push NAV higher. every one of those txs is on-chain + shows up in the activity feed on the <a href="/vault" className="text-ember hover:underline">vault page</a>. if u see weird stuff happening — its us cooking. dont expect consistent alpha; expect honest receipts.
            </FAQ>
            <FAQ q="what u are NOT being promised.">
              not a yield product. not a guaranteed return or apy. not alpha — the new vault does zero rotation. just FDRY custody: one stFDRY = one claim on one FDRY, nav rises only when revenue-funded buybacks land. this is experimental defi. capital is at risk. dont deposit what u cant afford to lose.
            </FAQ>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="molten-ring">
            <div className="bg-white rounded-[2.8rem] px-8 py-20 text-center">
              <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-6">
                build with <span className="molten-text">ai-native tools</span>.
              </h2>
              <p className="text-lg text-muted max-w-2xl mx-auto mb-10">
                unbrowse is live. the treasury is on-chain. the rest ships publicly.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="px-6 py-3 rounded-xl bg-molten text-white font-mono shadow-lg shadow-ember/20 hover:opacity-95 transition">
                  [ try unbrowse → ]
                </a>
                <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="px-6 py-3 rounded-xl border border-line text-ink font-mono hover:bg-soft transition">
                  [ open the vault ]
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-line py-12">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-4 gap-8 text-sm">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <img src="/logo.png" alt="Foundry" className="w-8 h-8 rounded-lg" />
              <span className="font-display font-semibold">foundry</span>
            </div>
            <p className="text-muted leading-relaxed">ai-native agents for small teams. built for ourselves, refined for u.</p>
            <div className="mt-5 inline-flex items-center gap-2 text-xs text-muted">
              <span className="w-2 h-2 rounded-full bg-nvidia"></span>
              backed by nvidia inception
            </div>
          </div>
          <FooterCol title="products" links={[
            { label: "unbrowse", href: "https://www.unbrowse.ai" },
            { label: "truth-optimised signal", href: "#products" },
            { label: "treasury vault", href: "#treasury" },
            { label: "FDRY token", href: `https://solscan.io/token/${FDRY_MINT}` },
          ]} />
          <FooterCol title="on-chain" links={[
            { label: "foundry dashboard", href: "/vault" },
            { label: "vault on solscan", href: `https://solscan.io/account/${VAULT_PUBKEY}` },
            { label: "live ledger.json", href: "/ledger/latest.json" },
            { label: "creator wallet", href: `https://solscan.io/account/${CREATOR_WALLET}` },
          ]} />
          <FooterCol title="company" links={[
            { label: "x / twitter", href: "https://x.com/getFoundry" },
            { label: "github", href: "https://github.com/lekt9/fdry" },
            { label: "contact", href: "mailto:lewis@getfoundry.app" },
          ]} />
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-line text-xs text-muted leading-relaxed">
          <p>
            <span className="font-semibold text-ink">legacy stFDRY</span> — an earlier symmetry-based vault (
            <a href="https://solscan.io/account/EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc" target="_blank" rel="noreferrer" className="font-mono underline hover:text-ink" title="EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc">EeDideZq…v9qc</a>
            ) is still on-chain with a small amount of legacy stFDRY outstanding (
            <a href="https://solscan.io/account/FwW1GEyvCx7q96wm4AYEGEUSFnNYozjxPwBaXWmcJeh7" target="_blank" rel="noreferrer" className="font-mono underline hover:text-ink" title="FwW1GEyvCx7q96wm4AYEGEUSFnNYozjxPwBaXWmcJeh7">FwW1GE…Jeh7</a>
            ). holders can redeem directly via symmetry's app. we no longer host a widget for it.
          </p>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-line flex flex-wrap justify-between gap-3 text-xs text-muted">
          <span>© {new Date().getFullYear()} foundry. on-chain since 2026.</span>
          <span>not legal or financial advice. experimental defi — capital at risk.</span>
        </div>
      </footer>
    </div>
  );
}

function TrustCard({ label, value, accent }: { label: string; value: string; accent?: "nvidia" }) {
  return (
    <div className="px-5 py-4 rounded-2xl bg-white border border-line shadow-sm text-center">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={`font-display text-base font-bold ${accent === "nvidia" ? "text-nvidia" : "molten-text"}`}>{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-5 rounded-2xl bg-white border border-line">
      <div className="text-xs text-muted mb-2 uppercase tracking-wider">{label}</div>
      <div className="font-display text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="p-6 rounded-2xl bg-white border border-line">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-sunrise text-ember flex items-center justify-center font-mono text-sm font-semibold">{n}</div>
        <h3 className="font-display text-lg font-semibold">{title}</h3>
      </div>
      <p className="text-muted leading-relaxed text-sm">{children}</p>
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6 rounded-2xl border border-line bg-white">
      <h3 className="font-display text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted leading-relaxed">{body}</p>
    </div>
  );
}

function FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-line rounded-2xl bg-white overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-soft transition">
        <span className="font-display font-semibold">{q}</span>
        <span className={`text-ember text-2xl leading-none transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && (
        <div className="px-6 pb-6 text-muted leading-relaxed">{children}</div>
      )}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <div className="font-display font-semibold mb-4">{title}</div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} rel="noopener" className="text-muted hover:text-ember transition">{l.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DepositGate({ children }: { children: React.ReactNode }) {
  const KEY = "fdry:risk-ack:v1";
  const [acked, setAcked] = useState<boolean>(() => {
    try { return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  const [checked, setChecked] = useState(false);

  if (acked) return <>{children}</>;

  const accept = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setAcked(true);
  };

  return (
    <div className="rounded-3xl border-2 border-ember/40 bg-sunrise/40 p-6 md:p-8">
      <div className="text-xs font-mono text-ember uppercase tracking-wider mb-3">// read this before u deposit</div>
      <h3 className="font-display text-xl font-bold mb-3 lowercase">operator has full discretion with vault assets</h3>
      <div className="text-sm text-ink/80 leading-relaxed space-y-3 font-mono lowercase mb-5">
        <p>
          the operator (creator wallet) can do literally whatever w/ the FDRY in the vault. not just trading — also: <span className="text-ink font-semibold">pay himself a salary, buy anthropic/openai/inference api credits, fund servers, cover legal, pay contractors, burn on experiments, w/e it takes to grow the business.</span> no pre-committed strategy, no whitelist of uses, no lockup.
        </p>
        <p>
          <span className="text-ink font-semibold">if he makes bad trades, overpays himself, or torches it on dead experiments, nav/share goes down and u eat the loss pro-rata.</span> upside: good trades + product revenue buybacks raise nav/share for every holder. this is a discretionary treasury w/ a founder attached, not a passive 1:1 wrapper.
        </p>
        <p>
          every move is on-chain + visible on the <a href="/vault" className="text-ember hover:underline">vault page</a> and solscan. operator cant freeze withdrawals, cant rug the share mint — u can always burn stFDRY and pull whatever share of the vault exists at that moment. transparency ≠ safety; u can watch the spend in real time.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer mb-4 select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 w-4 h-4 accent-ember cursor-pointer"
        />
        <span className="text-sm font-mono lowercase text-ink">
          i read this. i understand the operator has full discretion w/ vault assets, that nav can go down, and that im apeing at my own risk.
        </span>
      </label>
      <button
        onClick={accept}
        disabled={!checked}
        className="w-full px-4 py-3 rounded-xl bg-molten text-white font-mono text-sm hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        [ i understand, show the deposit widget → ]
      </button>
      <p className="text-xs text-muted mt-3 font-mono lowercase text-center">
        // gate only — nothing is submitted. full disclosure lives on the <a href="/vault" className="text-ember hover:underline">vault page</a>.
      </p>
    </div>
  );
}
