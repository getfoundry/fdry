import { useEffect, useState } from "react";
import { DepositGate } from "../components/DepositGate";
import { DepositWidget } from "../components/DepositWidget";
import { useLiveTreasury } from "../hooks/useLiveTreasury";

const VAULT_PUBKEY = "Bpr49sQXsxwNXNMRWS2v3tTBGWu2QgZtdA83BX77xBX1";
const VAULT_MINT = "G8e9i9RADPsxJtiCJsGC4tSx2kgCkGbEkdn7aajt2nqW";
const CREATOR_WALLET = "8n7QzgDuEiQUxCXNb7VSiq3fenA2UjeMTUhoiPK7QGR8";
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
  const [mcap, setMcap] = useState<string>("...");
  const [supply, setSupply] = useState<string>("...");

  useEffect(() => {
    const loadSnap = async () => {
      try {
        const r = await fetch("/ledger/latest.json", { cache: "no-store" });
        if (r.ok) setSnap(await r.json());
      } catch {
        /* ledger is optional */
      }
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
      } catch {
        /* public data can fail without blocking the page */
      }
    };
    loadToken();
  }, []);

  const shortKey = (k: string) => `${k.slice(0, 4)}...${k.slice(-4)}`;

  return (
    <div className="min-h-screen bg-white text-ink">
      <header className="fixed top-0 inset-x-0 z-30 bg-white/80 backdrop-blur-md border-b border-line">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-molten flex items-center justify-center text-white font-display font-bold text-sm">F</div>
            <span className="font-display font-semibold tracking-tight">Foundry</span>
          </a>
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted">
            <a href="#stack" className="hover:text-ink transition">stack</a>
            <a href="#aiko" className="hover:text-ink transition">aiko</a>
            <a href="#vault" className="hover:text-ink transition">vault</a>
            <a href="#why" className="hover:text-ink transition">why</a>
          </nav>
          <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="px-4 py-2 bg-molten text-white text-sm font-mono hover:opacity-90 transition">
            [ try unbrowse ]
          </a>
        </div>
      </header>

      <section className="relative pt-32 pb-20 overflow-hidden">
        <div aria-hidden className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-3xl bg-gradient-to-br from-ember/20 via-flame/10 to-transparent pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="molten-ring shadow-2xl">
            <div className="bg-white rounded-[2.8rem] px-8 py-16 sm:px-16 sm:py-24 relative overflow-hidden">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="spark" style={{ left: `${15 + i * 14}%`, top: `${30 + (i % 3) * 18}%`, animationDelay: `${i * 0.35}s` }} />
              ))}
              <div className="relative max-w-4xl mx-auto text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ember/20 bg-sunrise text-ember text-sm font-mono mb-8">
                  <span className="live-dot"></span>
                  nvidia inception backed - unbrowse live - aiko live
                </div>
                <h1 className="font-display text-5xl sm:text-6xl lg:text-[5.5rem] font-bold leading-[1.05] tracking-tight mb-6 lowercase text-balance">
                  foundry builds the small tools that let{" "}
                  <span className="molten-text">small teams move faster</span>.
                </h1>
                <p className="font-mono text-sm sm:text-base text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
                  Foundry is an AI company and public FDRY treasury. Unbrowse turns repeated browser work into reusable routes. Aiko serves fast, low-cost reasoning through an OpenAI-compatible LLM API. Aiko Agent is the next layer: a visible work runtime that can use tools, keep memory, and show its reasoning trail.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center font-mono text-sm">
                  <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="group flex items-center justify-center gap-2 px-6 py-3 bg-molten text-white font-medium hover:opacity-95 active:translate-y-px transition-all shadow-lg shadow-ember/20">
                    [ try unbrowse <span className="group-hover:translate-x-0.5 transition-transform">→</span> ]
                  </a>
                  <a href="#aiko" className="group flex items-center justify-center gap-2 px-6 py-3 border border-ember/40 text-ember hover:bg-sunrise active:translate-y-px transition-all">
                    [ read aiko <span className="group-hover:translate-x-0.5 transition-transform">→</span> ]
                  </a>
                  <a href="#vault" className="group flex items-center justify-center gap-2 px-6 py-3 border border-line text-ink hover:bg-soft active:translate-y-px transition-all">
                    [ open vault <span className="group-hover:translate-x-0.5 transition-transform">→</span> ]
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto">
            <TrustCard label="Backed by" value="NVIDIA Inception" accent="nvidia" />
            <TrustCard label="Unbrowse" value="197 WAU" />
            <TrustCard label="API keys" value="819" />
            <TrustCard label="FDRY market cap" value={mcap} />
          </div>
        </div>
      </section>

      <section id="stack" className="py-24 bg-soft border-y border-line">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// stack</div>
              <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-[1.1] lowercase">
                one company, three connected surfaces.
              </h2>
              <p className="text-lg text-muted leading-relaxed mb-8">
                Foundry ships tools for work that agents repeat often: browser tasks, reasoning calls, tool execution, and public treasury operations. The proof is practical: Unbrowse is already live, Aiko is serving as a fast LLM service, and the FDRY vault keeps the economics visible on-chain.
              </p>
              <p className="text-base text-muted/90 leading-relaxed">
                The link is operating leverage. When a workflow becomes reliable inside Foundry, it becomes a product. When a product earns revenue, the public treasury can show how capital moves back into FDRY. The site should make that loop simple enough to inspect without reading the repo.
              </p>
            </div>
            <div className="space-y-4">
              <FeatureCard title="Unbrowse is live" body="Shared browser routes replace repeated headless-browser work. Current public traction: 197 weekly active users, 819 API keys, and 5.4k npm downloads." />
              <FeatureCard title="Aiko is live" body="Aiko is a 35B-parameter mixture-of-experts model with about 3B parameters active per token, built for fast reasoning, tool use, structured outputs, and hallucination-resistant answers." />
              <FeatureCard title="Aiko Agent is next" body="The coming agent runtime makes each task visible as a tree of bounded cells: permissions, identity, engine, budget, scratch, outputs, tools, and inputs." />
            </div>
          </div>
        </div>
      </section>

      <section id="aiko" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// aiko</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4 lowercase">
              aiko is the reasoning layer.
            </h2>
            <p className="text-lg text-muted max-w-2xl mx-auto">
              The LLM service handles repeated reasoning calls today. The agent layer turns those calls into observable work tomorrow.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <ProductCard
              n="01"
              name="Aiko LLM"
              status="live"
              title="Fast reasoning as a service."
              body="Aiko is built for the calls that make products expensive: tool use, planning, extraction, classification, and structured answers. Its MoE shape gives it 35B parameters of stored capacity while only about 3B activate per token, which keeps latency and cost low enough for agent-scale traffic."
              metrics={[
                ["active params", "~3B"],
                ["first token", "<300ms"],
                ["cost target", "<$0.30/M"],
              ]}
            />
            <ProductCard
              n="02"
              name="Aiko Agent"
              status="coming"
              title="A visible runtime for real work."
              body="Aiko Agent is not a chat wrapper. Each job becomes a cell tree where every unit has a budget, permissions, inputs, tools, scratch space, and outputs. That makes long-running work inspectable, replayable, and easier to improve after each run."
              metrics={[
                ["runtime", "cell tree"],
                ["tools", "native"],
                ["memory", "witness trail"],
              ]}
            />
            <ProductCard
              n="03"
              name="Unbrowse"
              status="live"
              title="Reusable browser routes for agents."
              body="Unbrowse turns repeated website tasks into shared routes. Agents use the route instead of rebuilding a browser session every time, so coverage compounds and each future run gets cheaper, faster, and less fragile."
              metrics={[
                ["WAU", "197"],
                ["API keys", "819"],
                ["npm", "5.4k"],
              ]}
            />
          </div>
        </div>
      </section>

      <section id="vault" className="py-24 bg-soft border-y border-line">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// fdry vault</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4 lowercase">
              the public treasury is on solana.
            </h2>
            <p className="text-lg text-muted max-w-2xl mx-auto">
              FDRY is the capital surface for Foundry. The vault shows deposits, shares, withdrawals, and the current asset base directly from chain. It is experimental and discretionary, so the correct promise is visibility, not guaranteed yield.
            </p>
          </div>

          {live.navUsd === 0 && !live.loading && (
            <div className="max-w-5xl mx-auto mb-8 flex items-center gap-3 p-4 rounded-2xl border border-ember/20 bg-sunrise text-ember font-mono text-sm">
              <span className="live-dot"></span>
              <div>
                <span className="font-semibold">genesis state.</span>{" "}
                <span className="text-ember/80">The vault is live on-chain. Deposits mint stFDRY in the same transaction.</span>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-4 gap-4 max-w-5xl mx-auto mb-10">
            <Stat label="TVL (FDRY)" value={live.loading ? "..." : live.fdryBalance.toFixed(4)} />
            <Stat label="NAV (USD)" value={live.loading ? "..." : `$${live.navUsd.toFixed(2)}`} />
            <Stat label="Shares outstanding" value={live.loading ? "..." : live.sharesOutstanding.toLocaleString()} />
            <Stat label="FDRY supply" value={supply} />
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-10">
            <Step n="01" title="deposit">
              Deposit FDRY and receive <span className="font-mono font-semibold">stFDRY</span>, a share receipt for your pro-rata claim on the vault.
            </Step>
            <Step n="02" title="inspect">
              Watch the vault, ledger, and Solscan. If product revenue or treasury activity increases NAV per share, the chart should show it. If it does not, the chart should show that too.
            </Step>
            <Step n="03" title="withdraw">
              Burn stFDRY to redeem your pro-rata FDRY from the vault. The operator cannot block withdrawals through the frontend.
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
                [ full dashboard ]
              </a>
              <a href={`https://solscan.io/account/${VAULT_PUBKEY}`} target="_blank" rel="noopener" className="px-4 py-2 rounded-lg border border-line text-ink text-sm font-mono hover:bg-soft transition">
                [ solscan ]
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="why" className="py-24">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="text-sm font-mono text-ember mb-4 lowercase tracking-wider">// why</div>
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight lowercase">
              the simple version.
            </h2>
          </div>
          <div className="space-y-4">
            <FAQ q="what is foundry?">
              Foundry is a small AI company building tools for repeated digital work. Unbrowse handles browser routes. Aiko handles low-cost reasoning. Aiko Agent will connect reasoning, tools, memory, and visible execution into one runtime.
            </FAQ>
            <FAQ q="what is aiko llm as a service?">
              Aiko is a fast MoE language model served through an API shaped for production tasks. It is designed for high-volume reasoning, tool calls, structured outputs, summarization, extraction, and answers that can be checked.
            </FAQ>
            <FAQ q="what is coming with aiko agent?">
              Aiko Agent is the next product surface. It will show work as cells, not as a black-box chat transcript: each cell has permissions, a budget, inputs, tools, scratch memory, outputs, and a witness trail that can teach the next run.
            </FAQ>
            <FAQ q="why keep the treasury on-chain?">
              The treasury is public because the economics should be inspectable. Deposits, shares, withdrawals, and vault activity are visible on Solana, while the business side remains simple: ship products, earn revenue, and make capital movement observable.
            </FAQ>
            <FAQ q="what is not promised?">
              FDRY and stFDRY are experimental. This is not a yield product, not legal advice, and not financial advice. NAV can go down if treasury activity, trading, spending, or market prices move against the vault.
            </FAQ>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="molten-ring">
            <div className="bg-white rounded-[2.8rem] px-8 py-20 text-center">
              <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-6 lowercase">
                use the live tools, then inspect the treasury.
              </h2>
              <p className="text-lg text-muted max-w-2xl mx-auto mb-10">
                Unbrowse is available now. Aiko LLM is the service layer. Aiko Agent is the next execution layer. The FDRY vault keeps the public capital surface visible.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                <a href="https://www.unbrowse.ai" target="_blank" rel="noopener" className="px-6 py-3 rounded-xl bg-molten text-white font-mono shadow-lg shadow-ember/20 hover:opacity-95 transition">
                  [ try unbrowse ]
                </a>
                <a href="/vault" className="px-6 py-3 rounded-xl border border-line text-ink font-mono hover:bg-soft transition">
                  [ open vault ]
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line py-12">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-4 gap-8 text-sm">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <img src="/logo.png" alt="Foundry" className="w-8 h-8 rounded-lg" />
              <span className="font-display font-semibold">foundry</span>
            </div>
            <p className="text-muted leading-relaxed">AI infrastructure for small teams, live products, and an inspectable FDRY treasury.</p>
            <div className="mt-5 inline-flex items-center gap-2 text-xs text-muted">
              <span className="w-2 h-2 rounded-full bg-nvidia"></span>
              backed by nvidia inception
            </div>
          </div>
          <FooterCol title="products" links={[
            { label: "unbrowse", href: "https://www.unbrowse.ai" },
            { label: "aiko llm", href: "#aiko" },
            { label: "aiko agent", href: "#aiko" },
            { label: "fdry vault", href: "#vault" },
          ]} />
          <FooterCol title="on-chain" links={[
            { label: "vault dashboard", href: "/vault" },
            { label: "vault on solscan", href: `https://solscan.io/account/${VAULT_PUBKEY}` },
            { label: "live ledger.json", href: "/ledger/latest.json" },
            { label: "FDRY token", href: `https://solscan.io/token/${FDRY_MINT}` },
          ]} />
          <FooterCol title="company" links={[
            { label: "x / twitter", href: "https://x.com/getFoundry" },
            { label: "github", href: "https://github.com/getfoundry/fdry" },
            { label: "contact", href: "mailto:lewis@getfoundry.app" },
          ]} />
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-line flex flex-wrap justify-between gap-3 text-xs text-muted">
          <span>© {new Date().getFullYear()} foundry. on-chain since 2026.</span>
          <span>not legal or financial advice. experimental defi. capital at risk.</span>
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

function ProductCard({
  n,
  name,
  status,
  title,
  body,
  metrics,
}: {
  n: string;
  name: string;
  status: string;
  title: string;
  body: string;
  metrics: Array<[string, string]>;
}) {
  return (
    <div className="group rounded-3xl border border-line bg-white p-8 hover:shadow-xl transition">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-molten flex items-center justify-center text-white font-display font-bold">{n}</div>
          <div>
            <div className="font-display text-lg font-semibold">{name}</div>
            <div className="text-xs text-muted">{status}</div>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-sunrise text-ember text-xs font-medium border border-ember/20">{status}</span>
      </div>
      <h3 className="font-display text-2xl font-bold mb-3 tracking-tight">{title}</h3>
      <p className="text-muted leading-relaxed mb-6">{body}</p>
      <div className="grid grid-cols-3 gap-3 pt-6 border-t border-line">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <div className="text-xs text-muted mb-1">{label}</div>
            <div className="font-display font-bold text-ink">{value}</div>
          </div>
        ))}
      </div>
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
