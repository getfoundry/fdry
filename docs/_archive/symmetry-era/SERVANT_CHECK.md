# SERVANT CHECK — C7 L2 (Firmament)

**Question per component:** stakers, operator, or no one?
**Date:** 2026-04-20

---

## 1. Component classification

| Component | Locus | Serves | Evidence |
|---|---|---|---|
| Treasury vault (Symmetry V3, stFDRY 1:1 NAV claim) | on-chain | **stakers** | proportional-claim share token, NAV in SOL, `VAULT_V1_SHIP_PLAN.md` §1 |
| Equal-weight rebalance fallback | `bot/src/guards.ts` G7 | **stakers** | forces EW when confidence < 0.5 — strips overfit-alpha |
| Public daily ledger (JSON + `index.html`) | `ledger/` | **stakers** | verifiability; no login; JSON + page; `snapshot.ts` publishes NAV, holdings, tx log |
| Standalone HTML dashboard | `ledger/index.html` | **stakers** | static, read-only, self-contained page, fetches `latest.json` / `history.json` |
| 50 bp withdrawal fee | `scripts/createVault.ts:53` | **neutral** | `WITHDRAWAL_FEE_BP = 50  // soft retention`; stays in vault NAV, benefits remaining holders |
| 14-day own-capital window before external deposits | `VAULT_V1_SHIP_PLAN.md` §5 gate | **stakers (protective)** | "Public ledger live for 14 days … then opens to community" |
| Geofence + ToS click-through | `FRONTEND_SPEC.md` §7, `GeofenceGate.tsx` | **stakers (protective)** | blocks US/OFAC; reduces regulatory shutdown risk for deposited capital |
| Daily rebalance cron | `bot/src/main.ts` | **stakers** | enforces discipline: guards, idempotency, cooldown, max-delta, fail-closed |
| Telegram alerts to Lewis | `bot/src/alerts.ts` | **operator** | routed to `TELEGRAM_CHAT_ID`; informational only, no value flow |
| Creator fee (0 bp today) | `createVault.ts:48` | **operator (future)** | `CREATOR_FEE_BP = 0`; `SPEC.md` fee table discloses 2% target if Symmetry enables; currently $0 |

---

## 2. Extraction audit

### 2a. Hidden fees in code?
**None.** Every fee lever in `createVault.ts` is a named constant set to 0 except `WITHDRAWAL_FEE_BP = 50` (stays in NAV). Persisted to `docs/vault.json` as `fees_bp`. No hidden host-fee recipient: `host_platform = creator`, `host_fee_bps = 0`, `deposit_fee_bps = 0`, `management_fee_bps = 0`, `performance_fee_bps = 0`.

### 2b. Operator-benefit mechanics stakers can't see?
**None identified.** The only operator-benefit primitive is `CREATOR_WALLET` holding the creator-fee role + `withdrawVaultFeesTx` authority (SPEC §5, §8). Every fee claim is an on-chain tx surfaced via Solscan + the daily ledger (`VAULT_V1_SHIP_PLAN.md` §2.1, `snapshot.ts` exposes `fees_collected_sol`). The 50 bp withdrawal fee is routed to vault NAV, not operator (SPEC §8 fee table: "paid to: Vault (stays in NAV)").

### 2c. Path where operator gains while staker loses?
**None in v1 beyond normal market risk + disclosed Meteora round-trip slippage.** Risks are disclosed in `README.md` §8 ("honest caveats") and `SPEC.md` §9: round-trip can be net-negative in FDRY terms; creator fee architecturally exists but accrues $0 today. Rebalance authority is split: `HOT_WALLET` has `UPDATE_WEIGHTS` only; it cannot move funds to operator (`createVault.ts:280`, `authority_mask: "UPDATE_WEIGHTS"`). Guard G7 blocks active rankers below confidence floor, preventing over-fit operator conviction from draining NAV via excessive swap fees.

---

## 3. Disclosure surface

Operator-benefit is disclosed in:
- `SPEC.md` §8 fee table (row-by-row)
- `README.md` §8 caveats ("Creator fees currently accrue to $0")
- `VAULT_V1_SHIP_PLAN.md` §7 (legal framing: discretionary commitments)
- `ledger/` daily JSON (`fees_collected_sol`, `unbrowse_revenue_inflow_sol` fields in `snapshot.ts`)

---

## 4. Verdict JSON

```json
{
  "H1_every_component_serves_stakers_or_neutral": true,
  "H2_no_hidden_extraction_patterns": true,
  "H3_operator_benefit_disclosed_via_ledger": true,
  "notes": {
    "fees_nonzero": ["withdrawal:50bp (to NAV, not operator)"],
    "operator_surface": ["telegram alerts (info only)", "creator fee (0bp today, 2% disclosed in SPEC.md §8)"],
    "staker_protections": ["14d pre-gate", "EW fallback (G7)", "per-position cap 3000bp (G2)", "max-delta 4000bp (G8)", "cooldown 86400s (G9)", "confidence floor 0.5 (G7)", "geofence+ToS", "UPDATE_WEIGHTS-only hot wallet"]
  }
}
```
