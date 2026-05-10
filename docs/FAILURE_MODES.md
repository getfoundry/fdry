# FAILURE_MODES.md

**Dimension:** Creatures — the things that can go wrong in the wild.

This document enumerates every material failure mode for the fdry vault + EW-rotation bot + Unbrowse-fee stream. For each, we specify:

- **Shape:** what it looks like from the outside
- **Blast radius:** who gets hurt, and how badly
- **Detection:** how we (and anyone watching) know it happened
- **Operator action:** what Lewis does
- **Staker protection:** what structurally limits damage to depositors
- **Recovery:** can we undo or partially recover?

Every failure mode here is **detectable** — there is no silent/invisible version. If a failure is silent, it belongs in a different doc (an unknown-unknown), not here.

---

## 1. Strategy loses money (EW rotation underperforms)

The base rate failure. EW rotation is diversification, not alpha. Expect **30–40% of months to be down months** and multi-month drawdowns of 10–20% to occur within a single year at normal crypto vol.

- **Shape:** NAV per stFDRY declines across a month despite the basket being healthy and the bot running normally. No error, no incident — just red.
- **Blast radius:** Stakers bear the full loss in proportion to their share. No operator recovery promise, no backstop.
- **Detection:** Daily NAV snapshot on the frontend, ledger `nav_snapshot` entries, monthly performance report. Any staker can reproduce the NAV from on-chain Symmetry balances + Pyth marks.
- **Operator action:** None mechanical — the strategy is working as designed. Lewis publishes the monthly performance note, explains the drawdown, and does **not** tweak weights reactively. Changing strategy mid-drawdown is how EW rotation turns into discretionary trading, which is not what stakers signed up for.
- **Staker protection:** (a) EW rotation caps single-asset exposure by construction; (b) redemptions are always open — no gate, no lockup; (c) the SPEC is public, so the expected drawdown profile was disclosed up front.
- **Recovery:** Time. The strategy recovers on the next up cycle or it doesn't — that's the deal. No operator unwind.

---

## 2. Jupiter route fails during rebalance

A rebalance leg fails — Jupiter returns no route, the quote reverts, or slippage exceeds the configured `max_slippage_bps`.

- **Shape:** Keeper log shows a failed swap. The basket is temporarily off-target (e.g., target 25% SOL, actual 22%).
- **Blast radius:** Transient tracking error. No principal loss unless the market moves sharply before retry.
- **Detection:** Keeper emits `rebalance_failed` event to the ledger with error code. Monitoring alert fires if a rebalance fails **twice in a row** on the same leg.
- **Operator action:** Tier 1 — keeper auto-retries with fresh quote (up to 3 attempts, exponential backoff). Tier 2 — if all auto-retries fail, the keeper pauses that leg and pages Lewis. Lewis inspects the route manually, either (a) widens slippage tolerance for one execution, (b) splits the leg into smaller chunks, or (c) skips the leg until the next rebalance window if drift is within tolerance.
- **Staker protection:** Bounded drift — the rebalance scheduler won't compound failures. If a leg keeps failing, the bot falls back to the last known-good weights rather than spiraling. Max drift before forced intervention is documented per SPEC.
- **Recovery:** Full. The next successful rebalance restores the target weights. Tracking error from a single failed leg is typically < 50 bps.

---

## 3. Symmetry protocol exploit

A smart-contract-level exploit of Symmetry (the underlying basket protocol) drains the vault. This is the largest single-point-of-failure we accept by using Symmetry.

- **Shape:** Vault TVL drops sharply in a single block or short window. On-chain Symmetry balances no longer match NAV. Symmetry team or community flags the incident.
- **Blast radius:** **All vault funds at risk.** Potentially total loss. No operator recovery path — the vault is a client of Symmetry, not a custodian of the underlying routing.
- **Detection:** (a) NAV monitor detects step-function drop; (b) on-chain balance vs. expected-balance checker trips; (c) external signal (Symmetry post-mortem, security Twitter, etc.).
- **Operator action:** Immediately publish an incident notice with on-chain tx hashes. Pause deposits (withdrawals remain open for whatever residual balance exists). Coordinate with Symmetry team for any recovery action they offer. Do not promise a backstop Lewis cannot fund.
- **Staker protection:** Fully disclosed in the SPEC and on the stake page — "this vault depends on Symmetry; Symmetry risk is vault risk." Stakers accept this by depositing. Beyond disclosure, **there is no operator-funded protection** — this is the load-bearing acknowledgment of the product.
- **Recovery:** Partial, at best, and depends entirely on Symmetry's response. If Symmetry has insurance or compensates users, stakers receive pro-rata recovery. If not, the loss is realized.

---

## 4. Pyth oracle outage

Pyth stops publishing fresh prices for one or more vault assets, or publishes stale/anomalous prices.

- **Shape:** Pyth price feed `publish_time` is older than `max_staleness_seconds`, or price deviates from secondary source by > configured threshold.
- **Blast radius:** Without a price, the vault cannot safely rebalance or compute NAV. Trading against stale prices = adverse selection by arbitrageurs. So the vault must **pause**.
- **Detection:** Pre-trade check in the keeper rejects the rebalance and emits `oracle_stale` to the ledger. Monitoring alert fires immediately. Frontend NAV card shows "Paused — oracle stale."
- **Operator action:** Confirm the outage is Pyth-wide (check Pyth status page, other Pyth consumers). If Pyth recovers within the hour, resume automatically on next keeper tick. If prolonged, Lewis publishes a status update and decides whether to (a) wait it out, or (b) switch to a backup oracle per the SPEC's oracle-fallback clause (if configured).
- **Staker protection:** Pause-on-stale is a safe default — the vault holds its current basket rather than trading blind. Redemptions **remain open** and price at the last good oracle mark (stakers are not trapped).
- **Recovery:** Full and automatic once Pyth recovers. No manual intervention needed for a short outage.

---

## 5. HOT_WALLET compromised

The hot wallet (keeper signer) key is exfiltrated. Attacker can submit rebalance transactions on behalf of the bot.

- **Shape:** Unauthorized rebalance transactions appear on-chain signed by HOT_WALLET. Weights shift in ways inconsistent with the published signal.
- **Blast radius:** **Bounded.** HOT_WALLET can only shift weights within the vault — it cannot withdraw to external wallets, cannot change fee routing, cannot transfer roles. An attacker can grief via repeated suboptimal rebalances (burning trading fees and creating tracking error), but cannot drain principal.
- **Detection:** (a) Rebalance transactions that don't correspond to a bot-published signal on the ledger; (b) unusual rebalance frequency or direction; (c) on-chain alert for HOT_WALLET signing outside expected windows.
- **Operator action:** Immediately **rotate HOT_WALLET per SPEC §4.1** — CREATOR_WALLET revokes the compromised signer and installs a fresh one. Publish incident notice with affected tx range. Estimate and publish the tracking-error cost.
- **Staker protection:** Role separation is the protection. HOT_WALLET is deliberately low-privilege: weight-shift only, no drain capability, no role-transfer capability. Worst case is bounded trading loss, not catastrophic loss.
- **Recovery:** Rotate key, resume operations. Tracking error from attacker rebalances is realized loss — stakers bear it — but principal is preserved. Recovery complete within hours.

---

## 6. CREATOR_WALLET compromised

The creator wallet (highest-privilege role — can drain fees, transfer roles, reconfigure the vault) is compromised.

- **Shape:** Fee recipient changed, role transferred to an unknown address, or accumulated fees drained.
- **Blast radius:** **Catastrophic, but limited to future fees and role control — not principal.** An attacker cannot unilaterally drain staker deposits (those sit in Symmetry vaults and are governed by Symmetry's own role model). The attacker **can** (a) capture all future fee income, (b) transfer CREATOR_WALLET ownership to themselves permanently, and (c) potentially reconfigure strategy parameters in adversarial ways.
- **Detection:** (a) On-chain monitor watches CREATOR_WALLET for any tx — every CREATOR_WALLET tx should be pre-announced on the ledger; (b) fee-recipient change alert; (c) role-transfer alert. Any CREATOR_WALLET movement that wasn't scheduled is an incident.
- **Operator action:** If detected fast enough, race the attacker to rotate the key from a clean machine (this is a coin flip and often lost). If role is already transferred, the operator's administrative control is gone. Publish a full incident notice, explain exactly what the attacker can and cannot do, and communicate to stakers that **withdrawals remain open** — the attacker cannot block redemptions from Symmetry.
- **Staker protection:** (a) CREATOR_WALLET does not have custody of principal — principal lives in Symmetry vaults with Symmetry's own access controls; (b) withdrawal path is not gated by CREATOR_WALLET; (c) operationally, CREATOR_WALLET is held on a hardware wallet, offline between uses, per SPEC §4.1. Stakers should withdraw as a precaution during the incident.
- **Recovery:** Role cannot be recovered if transferred. Future fees are lost permanently. Stakers should exit, and the vault effectively winds down. A new vault can be launched under a new CREATOR_WALLET — but this one is gone.

---

## 7. Signal pipeline stale

The signal-producer bot stops publishing fresh weights (crashed, dependency down, signal source unreachable). The keeper is awake but has nothing fresh to act on.

- **Shape:** Latest signal timestamp older than `max_signal_age`. Keeper detects stale signal on its next tick.
- **Blast radius:** **Minimal.** The bot forces the **EW fallback** — rebalance to equal weights across the configured basket. This is the safe default and corresponds to the baseline strategy anyway.
- **Detection:** Keeper emits `signal_stale_fallback_ew` to the ledger. Monitoring alert fires after one stale tick. Frontend shows "Running on EW fallback."
- **Operator action:** Diagnose the signal pipeline (log check, restart the producer, fix the upstream). Fallback-to-EW means there is no time pressure — the vault is still operating, just on a more conservative policy. Fix, resume, publish brief note.
- **Staker protection:** The fallback **is** the conservative strategy. Losing the signal downgrades from "EW rotation" to "plain EW," which is the worst-case strategy stakers were already underwriting. No surprise.
- **Recovery:** Full. When signals resume, the keeper switches back to signal-driven rotation on the next scheduled rebalance.

---

## 8. Ledger publishing stops

The public transparency ledger (rebalance events, NAV snapshots, signal history) stops being written or stops being served.

- **Shape:** Ledger endpoint returns stale data, 404s, or the ledger-writer process is dead. On-chain vault and keeper continue operating normally.
- **Blast radius:** **No financial loss.** Transparency is lost — stakers cannot verify NAV or rebalance history from the ledger, and would have to reconstruct it from raw on-chain data.
- **Detection:** (a) Ledger heartbeat monitor; (b) frontend shows stale "last updated" timestamp; (c) external watchers who depend on the ledger notice immediately.
- **Operator action:** Restart the ledger writer, diagnose why it stopped, backfill missing entries from on-chain history. The keeper and vault don't need to stop — the ledger is a read path, not a write path for funds.
- **Staker protection:** (a) The ledger is a convenience layer; the **ground truth is on-chain** and any staker can reconstruct NAV from Symmetry balances + Pyth prices; (b) no vault action depends on ledger availability.
- **Recovery:** Full, with backfill. Missing entries are reconstructed from chain history. Trust cost is real but not financial — and worth acknowledging publicly when it happens.

---

## 9. Unbrowse monetization never ships

The Unbrowse revenue stream intended to feed the vault as fee inflow never materializes (product doesn't ship, doesn't monetize, or monetizes but routes elsewhere).

- **Shape:** Over months, vault sees no fee inflow from Unbrowse. Total vault return is **exactly the EW-rotation return, with no fee boost**.
- **Blast radius:** Zero downside to staked principal. The upside story ("EW rotation + Unbrowse fee share") collapses to just "EW rotation." The vault is still a functioning EW-rotation treasury, just without the revenue kicker.
- **Detection:** Trivial — the monthly report shows fee inflow = 0, and this is visible on-chain (CREATOR_WALLET fee-receiving address). Any staker can verify at any time.
- **Operator action:** Be honest. Publish the monthly note with fee inflow = 0 and acknowledge the Unbrowse-side delay or failure. Do **not** manufacture fee inflow from Lewis's own funds to mask the gap — that's a misleading signal. If Unbrowse is dead, update the SPEC to reflect the vault as pure EW-rotation treasury and let stakers decide to stay or leave.
- **Staker protection:** (a) Clear disclosure in the SPEC that the Unbrowse fee stream is **expected**, not **guaranteed**; (b) staker can redeem at any time if the thesis has changed; (c) base-case EW-rotation return is the real downside they underwrote, so this is not a surprise.
- **Recovery:** Not a recovery situation — it's a repricing. If Unbrowse ships later, fee inflow resumes. If it doesn't, the product is what it is.

---

## 10. Mass redemption event

50%+ of stakers redeem within a short window (hours to a day). This is the liquidity stress test.

- **Shape:** Large redemption queue. To honor redemptions, the vault must liquidate a large fraction of basket positions via Jupiter in compressed time.
- **Blast radius:** **Bounded slippage** on the liquidation path — stakers who redeem during the stampede receive NAV-less-slippage rather than pure NAV. Remaining stakers are **not disadvantaged** (the slippage is charged to the redeemers who are forcing the liquidation, via the redemption mechanism).
- **Detection:** Obvious — redemption-queue size on the frontend, on-chain redemption event volume spike, keeper logs large liquidation legs.
- **Operator action:** (a) Let the mechanism run — redemptions are unconditionally open, and the slippage pricing in the redemption path is designed exactly for this; (b) monitor Jupiter routes for each liquidation leg, widen slippage tolerance per SPEC if needed to clear the queue; (c) if slippage goes extreme (e.g., thin liquidity on a tail asset), chunk the liquidation over several hours rather than one block; (d) publish a status update explaining the dynamic.
- **Staker protection:** (a) The redeemer pays their own slippage — no socialized loss to remaining holders; (b) **no gates, no freezes** — redemptions are structurally always open; (c) slippage is capped per leg; legs that would blow the cap get chunked rather than executing at any price.
- **Recovery:** The vault survives a mass redemption with a smaller AUM — that's fine. If the event is a market-wide panic, remaining stakers ride out the storm on a smaller basket. No structural damage to the vault itself.

---

## Appendix: Detection coverage matrix

| # | Failure mode | Detection source | Alerts fire |
|---|---|---|---|
| 1 | Strategy drawdown | NAV snapshot + monthly report | N (expected) |
| 2 | Jupiter route fail | Keeper log + ledger event | Y (2nd consecutive) |
| 3 | Symmetry exploit | NAV monitor + balance check + external | Y (immediate) |
| 4 | Pyth outage | Pre-trade staleness check | Y (immediate) |
| 5 | HOT_WALLET compromise | On-chain signer monitor + ledger reconciliation | Y (immediate) |
| 6 | CREATOR_WALLET compromise | On-chain role monitor | Y (immediate, highest pri) |
| 7 | Signal stale | Keeper tick + ledger `signal_stale_fallback_ew` | Y (1st tick) |
| 8 | Ledger stopped | Ledger heartbeat + frontend stale timestamp | Y (heartbeat miss) |
| 9 | No Unbrowse revenue | Monthly report, fee wallet on-chain balance | N (expected if delayed) |
| 10 | Mass redemption | Redemption queue size + keeper liquidation volume | Y (threshold crossed) |

Every row has a detection source. No failure mode in this doc is silent.

---

## Appendix: Staker verification checklist

A staker who doesn't trust the operator's monitoring can verify each condition themselves:

1. **Drawdown real?** Reconstruct NAV from Symmetry balances × Pyth marks vs. supply of stFDRY.
2. **Route failure?** On-chain rebalance tx history; absence of expected rebalance at scheduled time.
3. **Symmetry exploit?** Compare expected Symmetry basket balance against what the vault's account actually holds on-chain.
4. **Oracle outage?** Query Pyth `publish_time` directly for each basket asset.
5. **HOT_WALLET misuse?** Any rebalance tx signed by HOT_WALLET without a corresponding ledger entry is suspicious.
6. **CREATOR_WALLET misuse?** Any CREATOR_WALLET tx should be pre-announced; unannounced tx = incident.
7. **Signal stale?** Check the signal producer's published timestamp against wall clock.
8. **Ledger stopped?** Ledger endpoint `last_updated` timestamp.
9. **Unbrowse revenue?** Inspect the fee-recipient wallet's on-chain inflow.
10. **Mass redemption?** On-chain redemption event volume.

If any of these checks diverges from what the operator is publishing, the staker should assume an incident is in progress and act accordingly (most often: redeem).
