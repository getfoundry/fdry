import { useEffect, useState } from "react";
import { DepositWidget } from "../components/DepositWidget";
import { useLiveTreasury } from "../hooks/useLiveTreasury";

const VAULT_PUBKEY = "EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc";
const VAULT_MINT = "FwW1GEyvCx7q96wm4AYEGEUSFnNYozjxPwBaXWmcJeh7";
const CREATOR_WALLET = "8n7QzgDuEiQUxCXNb7VSiq3fenA2UjeMTUhoiPK7QGR8";
const FDRY_MINT = "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL";
const FDRY_POOL = "2jC1LpGY1ZjL9UerTFDmTNM4kc2AhHydK4tqqqgbJdhh";
const GECKO_API = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${FDRY_POOL}`;
const SOLANA_RPC = "https://solana-rpc.publicnode.com";

interface LedgerSnapshot {
  nav_sol?: number;
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
            <a href="#vision" className="hover:text-ink transition">Vision</a>
            <a href="#products" className="hover:text-ink transition">Products</a>
            <a href="#treasury" className="hover:text-ink transition">Treasury</a>
            <a href="#why" className="hover:text-ink transition">Why Foundry</a>
          </nav>
          <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="px-4 py-2 rounded-lg bg-molten text-white text-sm font-medium hover:opacity-90 transition">
            Try Unbrowse
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
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ember/20 bg-sunrise text-ember text-sm font-medium mb-8">
                  <span className="live-dot"></span>
                  Backed by NVIDIA Inception · now on-chain
                </div>
                <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight mb-6">
                  AI-native agents that{" "}
                  <span className="molten-text">empower small teams</span>.
                </h1>
                <p className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-10">
                  Specialized agents for code, video, and operations. Unbrowse is live. Revenue routes through an on-chain treasury on Solana — everything verifiable, no promises.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                  <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="px-6 py-3 rounded-xl bg-molten text-white font-medium shadow-lg shadow-ember/20 hover:opacity-95 transition">
                    Try Unbrowse →
                  </a>
                  <a href="#deposit" className="px-6 py-3 rounded-xl border border-line text-ink font-medium hover:bg-soft transition">
                    Deposit into treasury →
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
              <div className="text-sm font-medium text-ember mb-4 uppercase tracking-wider">Vision</div>
              <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-[1.1]">
                Tools we use to <span className="molten-text">scale ourselves</span>.
              </h2>
              <p className="text-lg text-muted leading-relaxed mb-8">
                Foundry is an AI-native startup building specialized agents to solve our own problems. When they work for us, we ship them. When they generate revenue, it flows back to an on-chain treasury — not to a fundraising round.
              </p>
              <p className="text-base text-muted/90 leading-relaxed">
                The result is a parent treasury with verifiable capital, a set of products shipping alongside it, and a buyback loop that compounds as products grow.
              </p>
            </div>
            <div className="space-y-4">
              <FeatureCard title="AI-native from day one" body="We build agents for ourselves first, then ship them. The agents that don't survive our own workflows don't survive at all." />
              <FeatureCard title="Specialized, not generic" body="Each agent does one thing well. Unbrowse is a shared route graph. The truth-optimised signal is a tiebreaker for allocation. Neither tries to be a platform." />
              <FeatureCard title="Transparent by construction" body="Capital is on-chain. Trades are on-chain. Product metrics are public. If you can't audit it, we haven't shipped it." />
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCTS */}
      <section id="products" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="text-sm font-medium text-ember mb-4 uppercase tracking-wider">Products</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">
              Specialized agents for <span className="molten-text">real work</span>.
            </h2>
            <p className="text-lg text-muted max-w-2xl mx-auto">
              From code to content to capital allocation — each agent is battle-tested in our own workflows before becoming a product.
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
              <h3 className="font-display text-2xl font-bold mb-3 tracking-tight">
                A shared route graph for AI agents.
              </h3>
              <p className="text-muted leading-relaxed mb-6">
                Browser automation for agents — cheaper, faster, and more reliable than every agent running its own headless browser. Skip page loads, image parsing, manual clicks. One graph, many agents, compounding coverage.
              </p>
              <div className="grid grid-cols-3 gap-3 pt-6 border-t border-line">
                <div>
                  <div className="text-xs text-muted mb-1">WAU</div>
                  <div className="font-display font-bold text-ink">197</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">API keys</div>
                  <div className="font-display font-bold text-ink">819</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">npm downloads</div>
                  <div className="font-display font-bold text-ink">5.4k</div>
                </div>
              </div>
              <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 mt-6 text-ember font-medium hover:gap-2.5 transition-all">
                Explore Unbrowse →
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
                A truth-weighted signal for capital rotation.
              </h3>
              <p className="text-muted leading-relaxed mb-6">
                A small model we trained on Scripture, used only as a tiebreaker on top of simple equal-weight allocation. Think of it as a conscience for the trading bot — it only gets a vote when it's confident, otherwise the treasury just holds the basket evenly. It does <span className="font-semibold text-ink">not</span> beat equal-weight yet — we ship EW by default and let the signal earn activation live, on-chain, where anyone can see the receipts.
              </p>
              <div className="grid grid-cols-3 gap-3 pt-6 border-t border-line">
                <div>
                  <div className="text-xs text-muted mb-1">cadence</div>
                  <div className="font-display font-bold text-ink">daily</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">default</div>
                  <div className="font-display font-bold text-ink">EW</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">activation gate</div>
                  <div className="font-display font-bold text-ink">≥ 0.5</div>
                </div>
              </div>
              <div className="text-xs text-muted/80 mt-4 italic">
                "The Lord detests dishonest scales, but accurate weights find favor with him." — Proverbs 11:1
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TREASURY */}
      <section id="treasury" className="py-24 bg-soft border-y border-line">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="text-sm font-medium text-ember mb-4 uppercase tracking-wider">Treasury</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">
              The parent <span className="molten-text">treasury</span>, on Solana.
            </h2>
            <p className="text-lg text-muted max-w-2xl mx-auto">
              A Symmetry vault where capital lives, trades settle, and product revenue flows back in as buybacks. No yield promise — just a public ledger.
            </p>
          </div>

          {/* Genesis state banner */}
          {live.navUsd === 0 && !live.loading && (
            <div className="max-w-5xl mx-auto mb-8 flex items-center gap-3 p-4 rounded-2xl border border-ember/20 bg-sunrise text-ember">
              <span className="live-dot"></span>
              <div className="text-sm">
                <span className="font-semibold">Genesis · seeding.</span>{" "}
                <span className="text-ember/80">The vault is live on-chain. You can deposit below — shares mint after the keeper processes the next batch.</span>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-4 gap-4 max-w-5xl mx-auto mb-10">
            <Stat label="NAV (SOL)" value={live.loading ? "…" : live.solBalance.toFixed(4)} />
            <Stat label="NAV (USD)" value={live.loading ? "…" : `$${live.navUsd.toFixed(2)}`} />
            <Stat label="Shares outstanding" value={live.loading ? "…" : live.sharesOutstanding.toLocaleString()} />
            <Stat label="SOL / USD" value={live.loading ? "…" : `$${live.solPrice.toFixed(2)}`} />
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-10">
            <Step n="01" title="Deposit">
              Send SOL or USDC to the Symmetry vault. Receive <span className="font-mono font-semibold">stFDRY</span> — share tokens that track your pro-rata slice. No minimum, no lockup.
            </Step>
            <Step n="02" title="Trade">
              A daily bot rebalances the basket via Jupiter. Every trade is a public tx. Equal-weight by default; the signal only gets a vote when it's confident.
            </Step>
            <Step n="03" title="Withdraw">
              Burn your shares, receive underlying assets pro-rata. The operator cannot freeze funds. 50 bp exit fee stays with remaining holders.
            </Step>
          </div>

          <div id="deposit" className="max-w-2xl mx-auto mb-8">
            <DepositWidget vaultMint={VAULT_MINT} vaultPubkey={VAULT_PUBKEY} solPriceUsd={live.solPrice} navPerShareUsd={live.navPerShareUsd} />
          </div>

          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl border border-line bg-white">
            <div className="flex flex-wrap gap-6 text-xs font-mono text-muted">
              <span>vault <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="text-ink hover:text-ember">{shortKey(VAULT_PUBKEY)}</a></span>
              <span>mint <a href={`https://solscan.io/token/${VAULT_MINT}`} target="_blank" rel="noopener" className="text-ink hover:text-ember">{shortKey(VAULT_MINT)}</a></span>
              <span>creator <a href={`https://solscan.io/account/${CREATOR_WALLET}`} target="_blank" rel="noopener" className="text-ink hover:text-ember">{shortKey(CREATOR_WALLET)}</a></span>
            </div>
            <div className="flex gap-2">
              <a href="/vault" className="px-4 py-2 rounded-lg bg-molten text-white text-sm font-medium hover:opacity-95 transition">
                Full transparency →
              </a>
              <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="px-4 py-2 rounded-lg border border-line text-ink text-sm font-medium hover:bg-soft transition">
                Verify on Solscan
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* WHY FOUNDRY */}
      <section id="why" className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="text-sm font-medium text-ember mb-4 uppercase tracking-wider">Why Foundry</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
              Why <span className="molten-text">this</span>, why now.
            </h2>
          </div>
          <div className="space-y-4">
            <FAQ q="Why specialized agents?">
              Generic AI tools try to do everything and end up doing nothing particularly well. We build agents that excel at one function — Unbrowse for shared browser routes, the truth-optimised signal for honest allocation. Each is battle-tested in our own workflows before we ship it.
            </FAQ>
            <FAQ q="Why an on-chain treasury?">
              Old plan: liquid staking via a third party with opaque accounting. New plan: a Symmetry vault on Solana where every deposit, trade, and buyback is a public transaction. If we're asking you to trust the economics, the economics shouldn't require trust.
            </FAQ>
            <FAQ q="How does revenue flow back to holders?">
              Products generate revenue; a share is converted to SOL and sent directly to the vault via <span className="font-mono">buyVaultTx</span>. NAV-per-share rises for every holder; no new shares mint to the product team. Every routing has an on-chain memo (<span className="font-mono">source_revenue_YYYY_W##</span>) and appears in <span className="font-mono">ledger/revenue.jsonl</span>. Policy per product (current cut, cadence, trigger) lives in the public repo under <span className="font-mono">docs/REVENUE_POLICY.md</span>. Current routed revenue: $0 — this is mechanism + reference implementation, not a binding commitment until the first routing lands on-chain.
            </FAQ>
            <FAQ q="What you are not being promised.">
              Not a yield product. Not a guaranteed return or APY. Not alpha — the ranker underperforms equal-weight in backtest, so the vault ships as disciplined EW rotation. This is experimental DeFi. Capital is at risk. Don't deposit what you can't afford to lose.
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
                Build with <span className="molten-text">AI-native tools</span>.
              </h2>
              <p className="text-lg text-muted max-w-2xl mx-auto mb-10">
                Unbrowse is live. The treasury is on-chain. The rest ships publicly.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="px-6 py-3 rounded-xl bg-molten text-white font-medium shadow-lg shadow-ember/20 hover:opacity-95 transition">
                  Try Unbrowse →
                </a>
                <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="px-6 py-3 rounded-xl border border-line text-ink font-medium hover:bg-soft transition">
                  Open the vault
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
              <div className="w-8 h-8 rounded-lg bg-molten flex items-center justify-center text-white font-display font-bold text-sm">F</div>
              <span className="font-display font-semibold">Foundry</span>
            </div>
            <p className="text-muted leading-relaxed">AI-native agents for small teams. Built for ourselves, refined for you.</p>
            <div className="mt-5 inline-flex items-center gap-2 text-xs text-muted">
              <span className="w-2 h-2 rounded-full bg-nvidia"></span>
              Backed by NVIDIA Inception
            </div>
          </div>
          <FooterCol title="Products" links={[
            { label: "Unbrowse", href: "https://www.unbrowse.ai" },
            { label: "Truth-optimised signal", href: "#products" },
            { label: "Treasury vault", href: "#treasury" },
            { label: "FDRY token", href: `https://solscan.io/token/${FDRY_MINT}` },
          ]} />
          <FooterCol title="On-chain" links={[
            { label: "Foundry dashboard", href: "/vault" },
            { label: "Vault on Solscan", href: `https://solscan.io/account/${VAULT_PUBKEY}` },
            { label: "Live ledger.json", href: "/ledger/latest.json" },
            { label: "Creator wallet", href: `https://solscan.io/account/${CREATOR_WALLET}` },
          ]} />
          <FooterCol title="Company" links={[
            { label: "X / Twitter", href: "https://x.com/getFoundry" },
            { label: "GitHub", href: "https://github.com/lekt9/fdry" },
            { label: "Contact", href: "mailto:lewis@getfoundry.app" },
          ]} />
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-line flex flex-wrap justify-between gap-3 text-xs text-muted">
          <span>© {new Date().getFullYear()} Foundry. On-chain since 2026.</span>
          <span>Not legal or financial advice. Experimental DeFi — capital at risk.</span>
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
