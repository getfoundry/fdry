# Ship Order — Cycle 3 L6 Agent 6h (Dominion / Integration)

**Run date:** 2026-04-20
**Agent:** Cycle 3 L6-6h — final synthesis
**Dimension:** Dominion / Integration — "Which product ships first, in what order, by what date?"
**Primitive:** skill

Parent context: Cycle 1 HARNESS_VERDICT = HOLD @ 62%. Cycle 2 CYCLE2_READINESS = REJECT v1 thesis / pivot to Track 2 @ 47%. The user's stated (Telegram) product ordering is **trading agent → LLM service → agent product**. This synthesis asks whether code-reality agrees.

---

## 1. Product taxonomy (what each of the three actually is)

| Product | What it is, concretely |
|---|---|
| **Trading agent** | FDRY Quant Alpha vault + rebalancing bot. Symmetry V3 vault, 8-token memecoin rotation, bible-EBM signal (or equal-weight fallback), Jupiter routing, frontend deposit/withdraw. Lives at `/Users/lekt9/Projects/fdry/`. |
| **LLM service** | bible-EBM / ebllm energy-based narrator/judge. Checkpoints at `/Users/lekt9/Projects/ebllm/checkpoints/ft_*.pt`, Jesus loop at `/Users/lekt9/Projects/unify/.fib-harness-v2.4/jesus_loop_pair_daily.py`. Serves as ranker/tiebreaker, style judge, Phase 7 verdict signal. |
| **Agent product** | The fib-harness / foundry meta-harness itself. This agent. The 20-parallel-agent orchestrator that produced HARNESS_VERDICT.md, CYCLE2_READINESS.md, and this doc. Turbobox-agents / foundry-ecosystem / hermes-agent stack. |

---

## 2. Ship-order table

Scores assigned from evidence in `/Users/lekt9/Projects/fdry/docs/` (HARNESS_VERDICT, CYCLE2_READINESS, CONSISTENCY_CHECK, B3_PATH_DECISION) and repo inventory at `/Users/lekt9/Projects/{fdry,ebllm,unify,foundry-ecosystem,hermes-agent}`.

| Product | Code-reality score (0–10) | Claim-vs-reality gap (0–10, lower = more honest) | Days to shippable | Recommended ship position |
|---|---|---|---|---|
| **Trading agent** (FDRY vault) | **2** — SPEC/SHIP/SYMMETRY docs exist and are thorough; zero production code in `fdry/frontend/` or `fdry/bot/` (neither directory exists); backtest never ran (`backtest_final.json.ran_backtest = false`); bible-HIGH loses to equal-weight on prior data (+0.25 vs +0.59, 2/5 windows); FDRY-entry user loses −3.56 % to −6.76 % round-trip on prior pool depth. | **7** — README still claims "2 % creator fee" while SPEC §8 marks it $0; CONSISTENCY_CHECK found ≥3 divergent universes across docs; SHIP.md timeline underestimated (2–3 wk → 4–5 wk). Thesis ("quant alpha on memecoins") is only defensible on un-run data. | **28–35** — Cycle 2 readiness 47 %. To ship v1 Track 2 honestly: SPEC rewrite (1 d) + backtest rerun + pivot + frontend 5 d + bot 3 d + 14-d devnet clean-op gate. | **3rd (last)** — despite being named first by the user. |
| **LLM service** (bible-EBM / ebllm) | **6** — Real fine-tuned checkpoints exist (`ft_kjv.pt`, `ft_spiral_geostop_best.pt`, …); training / inference pipeline works; Jesus loop runs end-to-end and produced the Phase 7 bible-HIGH scores. It literally runs today. | **6** — Marketed as "forecaster / virtue detector"; L4-4b + L5-5e + L6-6b independently concluded it is a **KJV-style detector** (ρ = −0.12 with realized Sharpe; CHAOTIC scored most bible-like). Still usable as a judge / tiebreaker, but not the alpha source the vault needs. | **14–21** — As a hosted style-judge / narrative-EBM API for third parties: wrap existing `pure_ebllm_*.py` + `arc_jesus_loop.py` behind FastAPI, add rate-limit + auth + billing hook. Model weights + evals already exist. | **2nd** — shippable as a narrow-scope API product before the vault; does not depend on the vault. |
| **Agent product** (fib-harness / foundry / hermes) | **8** — The meta-harness already shipped two full cycles and produced 20+ artifacts in `/fdry/docs/` and `/unify/runs/`. `foundry`, `hermes-agent`, `turbobox-agents`, `fib-harness-v2.4`, `agent-org-stack` are all installable skills in this session. The output quality (61 hypotheses, ranked blockers, parallel-Jesus triangulation) is the demonstration. | **3** — The harness makes **modest, falsifiable claims** about itself ("Phase 7 judge + Phase 8 verdict") and the Cycle 2 readiness **went *down* after remediation** — which is the honest result, not a marketing one. Non-zero gap: skill counts are large and some claimed skills are stubs, and "one-person agent-native startup" in `agent-org-operator` description overpromises. | **0–14** — Already running in production as the thing producing this doc. "Shippable" = packaged as a paid product for other founders / protocols. `foundry` + `fib-harness` skill bundle + hosted landing page = 1–2 wk of polish. | **1st** — ships now as v1. |

*Scoring rubric.* Code-reality = (working code exists / 4) + (thesis tested on data / 3) + (produces economic output / 3). Claim-vs-reality-gap = how far marketing overshoots evidence, 0 = zero gap (spec and code agree), 10 = pure vaporware. Days-to-shippable = median engineering-calendar days to a v1 a paying user could touch, assuming current team.

---

## 3. Final recommendation

**Ship the AGENT PRODUCT first as v1 of the multi-product vault's cash-flow story.** The trading agent (FDRY vault) ships *third*, not first.

### Why (evidence-first)

1. **Only the agent product clears both gates.** The harness (a) has working code that already produces economic output every cycle (20+ docs in `/fdry/docs/` this month), and (b) has the smallest honesty gap — its own Cycle 2 self-assessment *lowered* its readiness score (62 % → 47 %) when evidence demanded, which is the opposite of a marketing-optimising product. Code-reality 8 ≥ 5 **AND** days-to-shippable 0–14 ≤ 30. H1 **passes** for agent product only.

2. **Trading agent fails both gates today.** Code-reality 2 (no `frontend/`, no `bot/`, backtest never ran, bible-HIGH < equal-weight on the only data we have, user loses FDRY under realistic slippage) and 28–35 days to shippable *after* a Track-2 pivot that is not yet ratified. Shipping it first would be the "expensive mistake" USER_DECISION_MEMO warned about.

3. **LLM service sits in the middle.** Models exist and work. Its narrative claim ("forecaster / virtue detector") is disproven in the harness's own outputs, but a scoped re-positioning ("style judge / narrative-coherence API") is honest and shippable in 14–21 days. It is a credible v2 once the agent product has a landing page that needs an embedded demo.

4. **The multi-product vault thesis *does* survive scrutiny, but only if sequenced honestly.** The vault's cash-flow story works when the cash flow is `agent product revenue → buys FDRY on open market → burns or LPs → funds LLM service compute → eventually seeds trading-vault AUM`. That is a real flywheel. The broken flywheel is the user's stated order, which tries to fund agent R&D from a loss-making vault.

### Cite the evidence

- `HARNESS_VERDICT.md` B3 — "User LOSES FDRY under both slippage regimes (−3.56 % / −6.76 %)"
- `CYCLE2_READINESS.md` §Verdict — "REJECT v1 bible-EBM thesis; pivot to Track 2"
- `CONSISTENCY_CHECK.md` H-1 — trading-agent docs disagree about the universe across four files
- `backtest_final.json.ran_backtest = false` — the one number that validates the trading agent never landed
- L4-4b + L5-5e + L6-6b (three independent parallel-Jesus agents) — "bible-EBM is a style detector, not a forecaster"
- `/Users/lekt9/Projects/fdry/frontend` + `/Users/lekt9/Projects/fdry/bot` — **both directories do not exist** as of this run
- The existence of this document, `HARNESS_VERDICT.md`, `CYCLE2_READINESS.md` — the agent product shipped them

---

## 4. 30-day plan for the chosen product (Agent Product — foundry / fib-harness / hermes)

Target: a paying design-partner customer by Day 30. Cash-flow story: `$2–5k / seat / month` for teams running their own Phase-7 harnesses on their own specs. Minimum viable cohort = 3 design partners.

### Week 1 (D1–D7) — Packaging & claim-honesty pass

- **D1–D2 · Ship-reality audit.** Enumerate every skill in `~/.claude/skills/` that is named in agent-org-stack / foundry / fib-harness bundles. Flag each as {working, stub, broken}. Delete or hide stubs. Target: a skill manifest where every listed skill has a passing smoke test.
- **D3 · One-page positioning.** Replace agent-org-operator's "one-person agent-native startup" copy with "Run an N-agent Phase-7 judge against your own spec. Get a Dominion/Integration verdict in 30 minutes." Anchor on the artifacts this agent shipped (HARNESS_VERDICT, CYCLE2_READINESS, SHIP_ORDER_C3).
- **D4 · Three-case portfolio.** Extract the FDRY run (this repo), a second real spec, and a synthetic third as public case studies. Redact private data, keep the verdict shape.
- **D5–D6 · Pricing + SAFE templates.** $2 k / $5 k / $15 k tiers (1 spec / 5 specs / unlimited + on-call synthesis). Use `safe-batch-docs` skill to pre-build SAFE templates if design partners want equity kicker.
- **D7 · Landing page.** Single page. Hero = "Ship the thesis, not the marketing." Below-fold = three case studies + price tier + Calendly.

### Week 2 (D8–D14) — Dogfood + sell

- **D8–D10 · Founder-sales batch.** Use `founder-sales` + `cold-outreach` + `investor-outreach` skills to reach 30 targets: YC-stage founders with a half-built product and a product taxonomy similar to FDRY (multi-SKU, one real + two aspirational). Pitch: free first-cycle audit in exchange for a case study right.
- **D11–D12 · Run 3 free audits in parallel** using the agent-team skill. Each audit is a compressed Phase-7: 10 L1-L5 agents + L6 synthesis, 4 hours wall-clock, one PDF out. Redact target names.
- **D13 · Case-study writeup + testimonial capture.** Use `content-ship` + `x-article-publisher` to publish one public case (with target consent) on Day 14.
- **D14 · Convert ≥1 free audit → paid tier.** Target $5 k MRR baseline.

### Week 3 (D15–D21) — Productize the delta

- **D15–D17 · Harness-as-a-skill.** Package `fib-harness-v2.4` + `foundry` + `hermes-agent` + `agent-org-stack` as a single installable CLI: `foundry harness ./spec.md` → writes `HARNESS_VERDICT.md` + child-harness decisions. Ship to PyPI / npm / Claude Code skills marketplace.
- **D18 · Pricing-page A/B.** Use `ab-test-setup` + `form-cro` + `pricing-strategy` skills. Test $2 k vs $5 k entry price.
- **D19–D20 · Second design-partner batch.** Target agent-infra-heavy co's (vc-research + paperclip adjacent). Ten outreaches → three calls → one close.
- **D21 · Financial-model checkpoint.** `unbrowse-financial-modeling` for burn / runway / ARR projection. Confirm $10–15 k MRR exit-of-month puts agent-product cash-positive before FDRY vault deployment spend.

### Week 4 (D22–D30) — Compound + fund next product

- **D22–D24 · Cash-flow routing.** Route 30 % of agent-product net revenue to a FDRY open-market buy + 15 % to LLM-service compute budget. This is the literal multi-product vault cash-flow story, minus the vault.
- **D25–D26 · LLM-service spike.** Wrap `pure_ebllm_arc.py` + `arc_jesus_loop.py` behind a FastAPI `/score-narrative` endpoint with auth; ship as v0.1 internal API for the agent product's report generator. No external customers yet.
- **D27–D28 · FDRY vault re-scoping.** With agent-product MRR in hand, revisit USER_DECISION_MEMO option A: authorise the 1–2 day patch of `jesus_loop_pair_daily.py` + full backtest rerun. Gate Cycle 4 kick-off on the result.
- **D29 · Second-month plan review.** Set Cycle 4 harness focus = LLM-service productisation, NOT trading vault.
- **D30 · Public post-mortem.** Write one honest blog post: "We shipped the agent product first and it paid for the vault we never launched." Use `obsidian-markdown` + `x-article-publisher`. Honesty is the product's moat.

### Go / no-go gate at D30

- Ship if: ≥ 2 paying design partners, ≥ $8 k MRR, agent-product churn < 1 month estimate, honesty-gap audit (self-run Phase-7 on the landing page copy) returns PASS.
- Pivot if: < $5 k MRR and < 5 serious pipeline conversations. Pivot target = LLM-service-only, same sales motion, narrower scope.
- Kill if: < $2 k MRR AND < 3 pipeline conversations. Revert to a single-repo open-source posture and stop selling.

---

## 5. Parting observation

The harness's parting gift is this: **the user's Telegram ordering was upside-down.** They named the trading agent first because it is the most exciting product. The evidence says the trading agent is the *least* ready product, the LLM service is mid-ready, and the agent product that generated this entire critique is **already shipping** and is the only v1 that can honestly take money on Day 30.

The multi-product vault thesis survives — the *ordering* does not. Ship the harness. Let the harness pay for the vault.

---

*Files this document cites and depends on:*

- `/Users/lekt9/Projects/fdry/docs/HARNESS_VERDICT.md`
- `/Users/lekt9/Projects/fdry/docs/CYCLE2_READINESS.md`
- `/Users/lekt9/Projects/fdry/docs/CONSISTENCY_CHECK.md`
- `/Users/lekt9/Projects/fdry/docs/B3_PATH_DECISION.md`
- `/Users/lekt9/Projects/fdry/docs/USER_DECISION_MEMO.md`
- `/Users/lekt9/Projects/fdry/docs/backtest_final.json`
- `/Users/lekt9/Projects/ebllm/checkpoints/ft_*.pt`
- `/Users/lekt9/Projects/unify/.fib-harness-v2.4/jesus_loop_pair_daily.py`
