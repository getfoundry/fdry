# FDRY Quant Alpha Vault — Frontend Specification

Authoritative companion to `docs/SPEC.md` §5 (Deposit) and §6 (Withdraw). Any SDK
signature below mirrors the SPEC_CHANGELOG-corrected signatures in `docs/SPEC.md`;
if the two disagree, `docs/SPEC.md` wins.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Build | **Vite** (`react-ts` template) | fast HMR, ESM-native, small runtime |
| UI | **React 18** + **TypeScript** (strict) | |
| Styling | **Tailwind CSS** | utility-first, ships no runtime |
| Components | **shadcn/ui** | copy-in primitives (Dialog, Button, Card, Toast, Form, Input, Slider, Skeleton) |
| Wallet | **@solana/wallet-adapter-react** + `@solana/wallet-adapter-react-ui` + `@solana/wallet-adapter-wallets` | Phantom, Backpack, Solflare at minimum |
| RPC | `@solana/web3.js` via Helius/Triton premium RPC (env-gated) | fall back to `clusterApiUrl('mainnet-beta')` in dev |
| Symmetry | `@symmetry-finance/symmetry-sdk` | Beta V3 mainnet |
| Jupiter | REST `https://lite-api.jup.ag/swap/v1` (or `https://api.jup.ag/swap/v1` for higher rate limits); **legacy `quote-api.jup.ag/v6` DNS no longer resolves** | v6 response shape is identical |
| Meteora | `@meteora-ag/dlmm` (and/or `@meteora-ag/cp-amm-sdk` depending on pool type) | pool-depth read only; no swaps through Meteora |
| State | `@tanstack/react-query` | caches quotes, balances, pool depth |
| Forms | `react-hook-form` + `zod` | deposit/withdraw validation |
| Env | `VITE_RPC_URL`, `VITE_VAULT_MINT`, `VITE_VAULT_PUBKEY`, `VITE_FDRY_MINT`, `VITE_FDRY_SOL_POOL`, `VITE_JUP_BASE`, `VITE_CF_GEOFENCE_KEY` | `.env.example` checked in |

Node 20 LTS. `pnpm` for installs. ESLint + Prettier. Vitest for unit tests of
`src/lib/*` (quote math, cap math, balance diff). No e2e in v1.

---

## 2. Directory Layout

```
~/Projects/fdry/frontend/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── .env.example
├── public/
│   └── tos.html
└── src/
    ├── main.tsx                       # ReactDOM root; wraps <WalletProviders>
    ├── App.tsx                        # router + layout; mounts DepositForm, WithdrawForm, VaultStats
    ├── providers/
    │   ├── WalletProviders.tsx        # ConnectionProvider + WalletProvider + WalletModalProvider
    │   └── QueryProvider.tsx          # react-query
    ├── components/
    │   ├── DepositForm.tsx            # FDRY amount in → SOL quote → Symmetry buy/lock
    │   ├── WithdrawForm.tsx           # vault-token amount in → sell/redeem → fan-out → FDRY
    │   ├── VaultStats.tsx             # NAV, AUM, tokens, last rebalance, daily PnL
    │   ├── RiskDisclosureModal.tsx    # gated on first connect (SPEC §9)
    │   ├── GeofenceGate.tsx           # blocks UI when CF header flags US/sanctioned
    │   ├── SlippagePreview.tsx        # shows expected FDRY-out, price impact, minReceived
    │   ├── DepositCapMeter.tsx        # pool-depth × 1% vs. requested amount
    │   └── ui/                        # shadcn-generated primitives
    ├── lib/
    │   ├── jupiter.ts                 # quote(), swapTx(), buildSwapInstructions() — lite-api.jup.ag/swap/v1
    │   ├── symmetry.ts                # wraps SDK: buyVaultTx, lockDepositsTx, sellVaultTx, redeemTokensTx, fetchVault
    │   ├── meteora.ts                 # getMeteoraPoolLiquidity(FDRY_SOL_POOL) — used for deposit cap
    │   ├── balances.ts                # getBalance(), getBalanceChange(), SPL + native SOL
    │   ├── tx.ts                      # signAndSend helpers, confirmation polling, retry
    │   ├── cap.ts                     # deposit cap math = poolLiq * 0.01
    │   └── constants.ts               # mints, decimals, slippage defaults
    ├── hooks/
    │   ├── useVault.ts                # react-query: sdk.fetchVault(VAULT_PUBKEY)
    │   ├── usePoolDepth.ts            # react-query: meteora pool liquidity, 30s stale
    │   ├── useJupQuote.ts             # debounced quote on amount change
    │   └── useDisclosureAck.ts        # localStorage flag, wallet-scoped
    └── styles/
        └── globals.css                # tailwind base + shadcn tokens
```

---

## 3. Deposit Flow (two-tx)

Mirrors SPEC §5 line-for-line. Any change here must land in SPEC first.

### 3.1 UX sequence

1. User connects wallet → first-connect triggers `RiskDisclosureModal` (§5).
2. If the user needs FDRY, the vault screen links directly to the Jupiter FDRY
   token page (`https://jup.ag/tokens/2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL`)
   from the deposit area. If wallet FDRY balance is below the entered deposit
   amount, the deposit widget should show that buy path before the disabled
   deposit action.
3. User types FDRY amount. `DepositCapMeter` shows `maxDeposit = poolLiq * 0.01`
   (read from `meteora.getMeteoraPoolLiquidity(FDRY_SOL_POOL)`). Submit disabled
   if over cap or `poolLiq === 0`.
4. `SlippagePreview` shows Jupiter quote (FDRY → SOL, `slippageBps: 200`) with
   expected SOL out, price impact %, route hops.
5. User clicks **Deposit**. Confirmation sheet lists the two txs that will be
   requested in sequence: "1/2 Swap FDRY → SOL (Jupiter)" and "2/2 Buy vault
   tokens + lock deposits (Symmetry)".
6. After tx1 confirms, measure `solReceived = getBalanceChange(userWallet, SOL_MINT)`.
7. Build Symmetry `buyVaultTx` with the measured SOL, then `lockDepositsTx`.
   Ship both via `sdk.signAndSendTxPayloadBatchSequence` (the SDK returns an
   ordered list of tx payloads; some entries may require sequential
   confirmation — the helper handles that).
8. Toast "Deposit queued. Keeper will execute within minutes; vault_token
   balance updates once keeper processes the intent." Link to explorer.

### 3.2 Implementation sketch — `src/components/DepositForm.tsx`

```typescript
// Matches SPEC §5 exactly. SDK signatures are SPEC_CHANGELOG-corrected.
async function deposit(userWallet: WalletAdapter, fdryAmount: bigint) {
  // 1. Deposit cap — pool-liquidity gate
  const poolLiq = await getMeteoraPoolLiquidity(FDRY_SOL_POOL);
  const maxDeposit = poolLiq * 0.01;
  if (Number(fdryAmount) > maxDeposit) {
    throw new Error(`Over cap: max ${maxDeposit}`);
  }

  // 2. Jupiter quote FDRY → SOL
  const quote = await jupiter.quote({
    inputMint: FDRY_MINT,
    outputMint: SOL_MINT,
    amount: fdryAmount,
    slippageBps: 200,
  });

  // 3. Build & sign swap tx
  const swapTx = await jupiter.swapTx(quote, userWallet);
  await userWallet.signAndSend(swapTx);

  // 4. Measure received SOL; build Symmetry buyVaultTx
  const solReceived = await getBalanceChange(userWallet, SOL_MINT);
  const buyBatch = await sdk.buyVaultTx({
    buyer: userWallet.publicKey,
    vault_mint: VAULT_MINT,
    contributions: [{ mint: SOL_MINT, amount: solReceived }],
  });
  await sdk.signAndSendTxPayloadBatchSequence(userWallet, buyBatch);

  // 5. Lock deposits so the keeper can pick up the intent
  const lockBatch = await sdk.lockDepositsTx({
    buyer: userWallet.publicKey,
    vault_mint: VAULT_MINT,
  });
  await sdk.signAndSendTxPayloadBatchSequence(userWallet, lockBatch);
}
```

### 3.3 Failure handling

- Tx1 confirms, tx2 rejected by user → user holds SOL. Show recovery banner:
  "You hold unswapped SOL from an incomplete deposit. [Resume] or [Swap back to FDRY]."
- Tx2 confirms, tx3 (lockDepositsTx) fails → buy is unlocked; keeper will not
  pick up. Show "Finish deposit" button that re-runs `lockDepositsTx` only.
- RPC timeout mid-confirmation → poll signature with exponential backoff, 90s cap.

---

## 4. Withdrawal Flow (fan-out, critical path)

Mirrors SPEC §6. This is the longest UX — N+2 signatures where N = vault token
count (currently 8–12 memecoins, capped by vault config).

### 4.1 UX sequence

1. User types vault-token amount or clicks "Withdraw 25% / 50% / 100%".
2. Call `sdk.fetchVault(VAULT_PUBKEY)`; show estimated basket composition.
3. `SlippagePreview` sums Jupiter quotes for each non-SOL basket leg → SOL,
   plus final SOL → FDRY (`slippageBps: 300`).
4. User clicks **Withdraw**. Modal explains: "This will ask you to sign
   approximately N+3 transactions. Do not close this tab."
5. Progress stepper tracks each tx:
   - `1. Sell vault tokens (keep_tokens)`
   - `2. Redeem tokens (consumes rebalance_intent)`
   - `3..N+2. Consolidate basket → SOL (per-mint)`
   - `N+3. Final SOL → FDRY`
6. Each leg shows tx signature + explorer link as it lands.

### 4.2 Implementation sketch — `src/components/WithdrawForm.tsx`

```typescript
async function withdraw(userWallet: WalletAdapter, vaultTokenAmount: bigint) {
  // 1. keep_tokens fast path — skips auction
  const vault = await sdk.fetchVault(VAULT_PUBKEY);
  const allMints = vault.tokens.map(t => t.mint);
  const sellBatch = await sdk.sellVaultTx({
    seller: userWallet.publicKey,
    vault_mint: VAULT_MINT,
    withdraw_amount: vaultTokenAmount,
    keep_tokens: allMints,
  });
  // Capture rebalance_intent — redeemTokensTx consumes it.
  const { rebalance_intent } = await sdk.signAndSendTxPayloadBatchSequence(
    userWallet,
    sellBatch,
  );

  const redeemBatch = await sdk.redeemTokensTx({
    keeper: userWallet.publicKey,
    rebalance_intent,
  });
  await sdk.signAndSendTxPayloadBatchSequence(userWallet, redeemBatch);

  // 2. User now holds pro-rata basket. Consolidate non-SOL → SOL.
  for (const mint of allMints) {
    if (mint === SOL_MINT) continue;
    const bal = await getBalance(userWallet, mint);
    if (bal === 0n) continue;
    const q = await jupiter.quote({
      inputMint: mint,
      outputMint: SOL_MINT,
      amount: bal,
    });
    await userWallet.signAndSend(await jupiter.swapTx(q, userWallet));
  }

  // 3. Final SOL → FDRY
  const totalSol = await getBalance(userWallet, SOL_MINT);
  const finalQuote = await jupiter.quote({
    inputMint: SOL_MINT,
    outputMint: FDRY_MINT,
    amount: totalSol,
    slippageBps: 300,
  });
  await userWallet.signAndSend(await jupiter.swapTx(finalQuote, userWallet));
}
```

### 4.3 Resumability

The withdraw flow has the largest blast radius for mid-flight aborts. Persist a
`WithdrawJournal` to `localStorage` keyed by wallet + `rebalance_intent`:

```ts
type WithdrawJournal = {
  wallet: string;
  rebalanceIntent: string;
  step:
    | 'sold'
    | 'redeemed'
    | `leg:${string}` // mint address of last-consolidated leg
    | 'final-swap-pending'
    | 'complete';
  legsRemaining: string[];         // mints not yet swapped to SOL
  startedAt: number;
  updatedAt: number;
};
```

On reload, if a non-terminal journal exists, surface "Resume withdrawal" in
`WithdrawForm`; re-read on-chain balances, skip legs already at 0, continue.

### 4.4 v1.5 optimization (not v1)

Per SPEC §6: bundle step-2 swaps + step-3 final swap into one versioned tx using
address lookup tables. v1 ships N+3 signatures; v1.5 reduces to 2–3.

---

## 5. Key UX Components

### 5.1 Deposit cap check — `DepositCapMeter`

- Source: `meteora.getMeteoraPoolLiquidity(FDRY_SOL_POOL)`.
- Formula: `maxDeposit = poolLiq * 0.01`.
- Rationale (SPEC §5): at ~$120k pool liquidity, 1% = $1.2k max, keeps FDRY→SOL
  slippage under ~2% and avoids whipsawing the chart.
- Display: linear gauge (amount-requested / maxDeposit). Submit button disabled
  when over cap, with inline error: `Over cap: max ${maxDeposit} FDRY`.
- Refetch every 30s via react-query; show staleness badge when > 60s old.

### 5.2 Slippage preview — `SlippagePreview`

- For deposit: single Jupiter quote (FDRY→SOL, 200 bps). Render expected SOL,
  price impact, minReceived, route hops.
- For withdraw: sum of per-mint quotes + final SOL→FDRY (300 bps). Render
  expected FDRY, effective round-trip loss bps, worst-case (minReceived).
- Debounce 300ms on amount changes; quotes via `useJupQuote`.

### 5.3 Risk disclosure modal — `RiskDisclosureModal`

- Trigger: first wallet-connect per browser per wallet (localStorage key
  `fdry.disclosure.ack.${pubkey}`).
- Must-scroll-to-bottom before the "I understand" button enables.
- Also presented as a checkbox-gated step inside `DepositForm` on first
  deposit per wallet — both signals must be true.

### 5.4 Vault stats — `VaultStats`

- AUM (USD), NAV, shares outstanding, token composition (pie), last rebalance
  timestamp, last signal tag, 7d/30d PnL vs. HODL-FDRY baseline.
- Link to daily NAV CSV (per SPEC §9 "Publish daily ledger / NAV for
  transparency").

---

## 6. Risk Disclosure Modal Text

Header: **Capital at risk. Read before depositing.**

Body — top, verbatim from SPEC §9:

> **Capital at risk. You may receive back fewer FDRY than you deposited.
> Strategy may lose money. No return is guaranteed. This vault is
> discretionary, not a passive yield product.**

Then four collapsible sections (rendered expanded on first view):

**Technical**
- Symmetry is BUSL-1.1 beta V3 mainnet software. Protocol risk exists.
- Jupiter route availability for memecoin basket fluctuates with liquidity events.
- Keeper auction delay means deposits are not "active in strategy" until the
  next keeper execution (typically minutes).
- FDRY/SOL pool is thin ($80k–$120k). External FDRY shocks transmit directly
  to your entry/exit slippage.
- Operator fee copy: 0.69% of realized profits only. No profit means no profit
  cut, and this must never be framed as a promise that profit will exist. If the
  on-chain Symmetry fee config is disabled, the UI must not imply an automatic
  protocol-level fee is already accruing.

**Strategy**
- Backtest: bible-HIGH beat HODL at 40bps in 3/5 daily windows on 2023 data.
  Suggestive, not definitive.
- Real Jupiter execution for small-medium memecoin swaps: ~30–50bps per hop.
  Backtest assumed 40bps total per rebalance — reality may be 40–80bps.
- Signal is off-chain. Bot downtime = vault sits at last-set weights (not
  catastrophic, but not working either).

**Tokenomics**
- FDRY is **not** locked by this architecture. Any such claim is false.
- Deposits create FDRY sell pressure. Withdrawals create FDRY buy pressure.
- Net chart effect over a cycle ≈ strategy PnL realized on exits.
- If FDRY pumps organically, your FDRY-denominated returns lag USD returns:
  you entered at low FDRY and exit at high FDRY = fewer FDRY back.

**Legal / operational**
- Pooled investment vehicle with discretionary management. Regulatory stance
  depends on jurisdiction. Not legal advice.
- US persons and residents of OFAC-sanctioned jurisdictions may not use
  this product.
- Daily ledger / NAV is published; verify NAV independently before and after
  each deposit.

Footer: checkbox `I have read and understand the above. I am not a US
person or a resident of a sanctioned jurisdiction.` → button **I understand,
continue**. Clicking writes the ack to localStorage and closes the modal.

---

## 7. Geofence Approach

Two layers. The network layer is load-bearing; the click-through is for
evidence and user attestation.

### 7.1 Network — Cloudflare IP block (load-bearing)

- Deploy the frontend behind **Cloudflare** (Pages or Workers in front of a
  static bucket).
- **WAF custom rule**: block requests where
  `ip.geoip.country in {"US"}` OR `ip.geoip.country in OFAC_LIST`
  (CU, IR, KP, SY, RU — keep list in Cloudflare dashboard, not in git).
  Response: 451 with a minimal static page explaining the block.
- **Worker** (optional, if we want softer UX): inject `CF-IPCountry` into a
  response header/cookie the SPA reads; `GeofenceGate.tsx` renders the block
  page client-side using the same country list. Worker is advisory; WAF is
  the hard gate.
- Tor/VPN egress IPs that advertise these geos are blocked by IP; others get
  through. This is a best-effort defense, not a perfect one — combined with
  the click-through, it demonstrates a good-faith filter.

### 7.2 Click-through ToS (evidence layer)

- `public/tos.html` (static, versioned in git with a content hash).
- `RiskDisclosureModal` includes checkbox: "I am not a US person or a
  resident of a sanctioned jurisdiction and I agree to the Terms at
  /tos.html (sha256: <hash>)."
- Ack record (pubkey, timestamp, tos hash, user-agent, CF-IPCountry) posted to
  a simple logging endpoint (e.g. Cloudflare Worker → KV). This is the record
  the operator can show if asked.

### 7.3 What this does **not** do

- Does not make the product legal in blocked jurisdictions — it reduces
  exposure, not eliminates it.
- Does not stop a determined VPN user. See SPEC §9 "legal / operational" —
  regulatory stance depends on jurisdiction; this is not legal advice.

---

## 8. Estimate & Critical Path

**Total: ~5 person-days** for a mid-level Solana frontend engineer, including
wallet-adapter setup, shadcn scaffolding, both flows, risk modal, geofence, and
unit tests for `lib/*`. Excludes bot wiring, vault deploy, and LP bootstrap.

Breakdown:

| Day | Work |
|---|---|
| 0.5 | Vite + Tailwind + shadcn + wallet-adapter scaffolding, env wiring, RPC |
| 0.5 | `src/lib/jupiter.ts`, `src/lib/meteora.ts`, `src/lib/symmetry.ts` wrappers + unit tests |
| 1.0 | `DepositForm` + `DepositCapMeter` + `SlippagePreview` + two-tx orchestration + failure recovery |
| **1.5** | **`WithdrawForm` fan-out + journal/resume + progress stepper — critical path** |
| 0.5 | `VaultStats` + daily NAV CSV link |
| 0.5 | `RiskDisclosureModal` + `GeofenceGate` + Cloudflare WAF rule + ToS page |
| 0.5 | QA: devnet vault end-to-end deposit & withdraw; Lighthouse + a11y pass |

**Critical path: withdraw fan-out.** Reasons:
- N+3 signatures where N = vault token count; any mid-flight abort leaves the
  user holding an arbitrary basket. Requires `WithdrawJournal` + resume UI +
  per-leg balance reconciliation. All other flows are linear.
- Jupiter quote reliability is per-mint; a single illiquid memecoin leg can
  stall the whole flow. Need per-leg "skip and continue / swap manually"
  escape hatch.
- The redeem step consumes `rebalance_intent` returned by `sellVaultTx` — the
  SDK surface for capturing that return value must be verified against the
  deployed SDK version before day 3.
- v1.5 ALT-bundling (SPEC §6) is explicitly deferred; v1 must ship with the
  linear N+3 flow working end-to-end.

Risks to the estimate:
- Symmetry SDK breaking changes between now and ship (+0.5 day).
- Meteora pool type (DLMM vs. CP-AMM) determines which SDK to use for depth
  reads — confirm before day 1 (+0.25 day if surprise).
- Wallet-adapter + Vite SSR/polyfill friction (Buffer, process) — budget
  +0.25 day if we hit the classic polyfill wall.

---

## 9. References

- `docs/SPEC.md` §5 — Deposit Flow (authoritative SDK signatures & params)
- `docs/SPEC.md` §6 — Withdrawal Flow (authoritative SDK signatures & params)
- `docs/SPEC.md` §9 — Risks & Honest Caveats (source of disclosure text)
- `docs/SYMMETRY.md` — Symmetry SDK details
- `docs/SHIP.md` — day-by-day ship checklist; this doc feeds Phase 2
