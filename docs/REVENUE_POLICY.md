# Foundry revenue policy

How money flows *into* the vault from products Foundry ships.

This doc distinguishes **mechanism** (code that moves SOL) from **policy**
(what % each product commits, on what cadence). Mechanism is implemented and
public. Policy is per-product and appended here when committed.

---

## Principle

1. Product revenue is converted to SOL and sent to the vault via
   `buyVaultTx`. NAV-per-share rises; no new shares minted to the product team.
2. Every routing is an on-chain tx with a memo of shape
   `<source>_revenue_<YYYY>_W<##>` (or any unique stable tag). Memo is the
   attribution primary key.
3. All routings are appended to `ledger/revenue.jsonl`, one JSON line per tx,
   with source + amount_usd + amount_sol + sig + memo + ts.
4. The landing-page counter reads from that file; no server, no trust.
5. No retroactive edits. Wrong routing = new correcting entry.

---

## Mechanism (binding, implemented today)

Reference implementation: `routers/unbrowse.ts`. Copy-and-edit per product.

Pipeline (per routing):
1. Read `--amount-usd=<N> --source=<label>`
2. Pyth SOL/USD spot → compute SOL equivalent
3. If starting currency is USDC: Jupiter swap USDC → SOL
4. `sdk.buyVaultTx` with a WSOL contribution and the memo
5. `sdk.lockDepositsTx`
6. Append JSONL ledger line
7. Telegram alert (if configured)

Invocation:
```bash
tsx routers/unbrowse.ts --amount-usd=500 --source=unbrowse
```

Dry-run available: `--dry-run` prints the plan without signing.

---

## Policy (per source)

### Unbrowse

| Field | Value |
|---|---|
| **Status** | Live router, operator-triggered, no binding commitment yet |
| **Current cut** | Operator discretion per routing |
| **Suggested target** | 10% of gross USD revenue |
| **Suggested cadence** | Weekly, batched |
| **Trigger** | Manual CLI today; billing-webhook stub in `routers/unbrowse.ts` for later |
| **Memo format** | `unbrowse_revenue_YYYY_W##` |
| **Source label** | `unbrowse` |
| **Total routed to date** | $0 (ledger/revenue.jsonl empty) |

The "suggested" row is not binding until an actual routing lands on-chain with
that % — the first commit is the one the ledger records, not a claim in this
doc. If the operator routes 10% of one week's gross on 2026-W17, that sets
the precedent. If not, nothing binds.

### Future products

Each new product (trading bot revenue, any future agent) gets its own row in
this doc before its router is merged. Row must specify: status, current cut,
trigger, memo format, source label.

Onboarding checklist:
1. Copy `routers/unbrowse.ts` → `routers/<product>.ts`; replace `unbrowse`
   with `<product>` in source label, memo prefix, and the header comment.
2. Add a row to this file with honest status (almost always "no binding
   commitment yet" for a new product).
3. If the product has its own pricing token (not USD), add an oracle in
   `docs/oracles.json` and swap logic in the router.
4. First routing tx signature goes in the ledger; that's the precedent.

---

## What is NOT committed

- Foundry does not promise a specific % from any product.
- The landing-page language ("product revenue flows back as buybacks") is
  describing the mechanism and intent, not a legal commitment.
- stFDRY is a share token, not a revenue-share security. Holders' upside comes
  from NAV-per-share, which is driven by (a) trading PnL and (b) these
  routings if they happen. Neither is guaranteed.
- Rates may change. When they do, the change is a new row in this file and
  a memo on the next routing, not a retroactive edit.

---

## Why "suggested" instead of "binding"

Honest operator-discretion is better than an invented promise. A 10% commit
with no enforcement mechanism is less truthful than "we expect ~10% when
routing starts, set by the first on-chain precedent." The on-chain memo is
the real contract. This doc is its documentation.

The one thing this doc *does* bind: **every routing gets a memo and a ledger
line**. That part is mechanism, not policy, and it's load-bearing for the
transparency-treasury narrative.

---

Last updated: 2026-04-20
