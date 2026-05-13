# Foundry — unpossessed land

Per Josh 13:1 — the main conquest is done. These are the portions still
unposessed, each named with a bounded path forward.

---

## 1. Live trading / rebalance loop

**State**: `bot/src/signal.ts` and `bot/src/main.ts` exist with equal-weight
default and truth-optimised-signal activation gate (≥ 0.5 confidence). Not
running anywhere. `scripts/trade.ts` can call `makeDirectSwapTx` against the
vault with creator authority.

**Gating**: vault has $11.70 NAV. Trading 2-token basket at this size is
noise; minimum viable NAV for the bot to matter is probably $100+.

**Path**:
1. Get NAV > $100 (either more seed or ship to actual users)
2. Deploy `bot/src/main.ts` as a hosted cron (Railway / fly.io / pm2) with
   the creator key in env
3. Verify daily: signal file emitted, trade tx executes, ledger updated

**Pass**: first scheduled rebalance tx lands on-chain with creator as keeper,
visible in the Recent Activity log on /vault.

---

## 2. Revenue routing (Unbrowse → vault)

**State**: `routers/unbrowse.ts` stub exists. Landing page says "product
revenue flows back as buybacks." Currently routed revenue = $0.

**Gating**: Unbrowse needs a billing webhook (Stripe / x402 / whatever) that
fires on each paid invoice. Then route a share to vault via direct SOL
transfer (NOT `buyVaultTx` — avoids share dilution; pure NAV lift for
holders).

**Path**:
1. Wire Unbrowse billing to emit a per-invoice event
2. Router: receive event → convert USD share to SOL via Jupiter → send to
   vault account (`EeDi…v9qc`)
3. Log each transfer in `ledger/revenue.jsonl` for landing-page display

**Pass**: first revenue tx appears in vault's `getSignaturesForAddress`,
recognisable by a memo like `unbrowse:invoice_123`.

---

## 3. Withdraw flow browser end-to-end

**State**: Widget has a Withdraw tab that calls `sellVaultTx`. Never tested
from a browser.

**Path**: a holder of stFDRY (creator wallet has 11.687) clicks Withdraw in
the widget, signs `sellVaultTx`, waits for settlement, then uses the
"Swap SOL → FDRY on Jupiter ↗" deep-link the widget already provides.

**Pass**: stFDRY balance decreases in the creator wallet, SOL increases by
the expected pro-rata amount.

---

## 4. DNS apex on getfoundry.app

**State**: Custom domain configured in Cloudflare Pages. Earlier we couldn't
add the CNAME via API due to OAuth scope. Latest test shows
`https://getfoundry.app/vault` serves live — so apex is resolving. Might
already be solved.

**Path**: just confirm with `dig getfoundry.app` that the apex points to
the CF Pages project, and that both `getfoundry.app` and `www.getfoundry.app`
redirect consistently.

**Pass**: `curl -sI https://getfoundry.app` returns 200 and
`server: cloudflare`.

---

## 5. SDK patch durability

**State**: we patched `dist/index.js` of @symmetry-hq/sdk during the Path B
attempt. We reverted it today. If any future session resurrects the raydium_cpmm
oracle path, they'll need to re-apply.

**Path**: if resumed, convert to a real `pnpm patch @symmetry-hq/sdk@1.0.20`
so it survives installs. The exact diff is recorded in
`SYMMETRY_RAYDIUM_CPMM_ATTEMPT.md`.

---

## 6. Keeper automation

**State**: the keeper steps (rebalanceVaultTx, cancelRebalanceIntentTx) have
been running as-needed via scripts. Not automated.

**Path**: if the stuck-intent problem recurs, a cron that runs
`clearStaleIntents.ts` once a day keeps the house clean automatically.

**Pass**: one week of vault operation with zero human-run keeper intervention.

---

## 7. Unbrowse integration on landing narrative

**State**: landing references Unbrowse as a live product. Unbrowse itself
works (197 WAU). The narrative alignment between vault and Unbrowse is done.

**Path**: nothing to do here unless the Unbrowse surface changes.

---

## Accounting of today's work (2026-04-20)

- ✓ Vault created, seeded, lived
- ✓ Site deployed (getfoundry.app)
- ✓ Deposit widget renders + FDRY-denominated
- ✓ Real FDRY deposit path traced and working (1.684 stFDRY minted from test buy)
- ✓ Transparency dashboard (live RPC holdings, NAV, activity)
- ✓ Two bible-parallel resolutions logged (Horeb + feeding-of-5000)
- ✓ Path B (raydium_cpmm native) attempted, failed, retreated honestly, LP recovered
- ✗ Live trading loop (scoped, not deployed)
- ✗ Revenue routing (scoped, not wired)
- ✗ Browser-side withdraw test (shipped, untested)

Sunk cost for the day: ~$16 in Raydium pool-creation fees. Everything else
either shipped or documented for inheritance.
