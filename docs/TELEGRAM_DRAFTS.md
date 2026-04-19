# Telegram Post Drafts

Four posts to ship in sequence as the vault, Unbrowse revenue routing, and M3 lock program come online. Lowercase-friendly crypto style. No em-dashes. No yield claims. No guarantees. Every verifiable claim has a placeholder link Lewis fills in at publish time.

---

## POST 1 - Vault Live (ship TODAY, immediately after Symmetry vault creation confirms on chain)

**Trigger:** Send within 30 minutes of the Symmetry vault pubkey being visible on Solscan and the seed SOL transfer being confirmed. Timestamp: T0.

**Pre-publish checklist:**
- [ ] `createVault.ts` has run on mainnet and `docs/vault.json` has a real pubkey (not the 11111... placeholder)
- [ ] `seed.ts` has run and `ledger/latest.json` shows nav > 0
- [ ] git pushed and GitHub Pages returns 200 on the ledger url
- [ ] basket size in post matches actual universe in `createVault.ts` (currently 6 tokens)
- [ ] replace `[solscan link]`, `[ledger url]`, `[pyth feeds]` placeholders with real urls

**Draft:**

vault is live on symmetry. yes, it's on mainnet. no, i am not opening deposits yet.

i seeded it with roughly $10k of sol from my own wallet. no external deposits, and there won't be for 14 days while i run it on my own capital only.

the basket is 6 tokens with a daily rebalance. current signal is an equal-weight baseline, with the bible-HIGH ranker acting as a confidence-gated tiebreaker when it clears the threshold. when it doesn't clear, the vault just sits in EW and that's the whole point.

every rebalance, every holding, every drawdown is on the public ledger.

solscan: [solscan link]
ledger: [ledger url]
price feeds: [pyth feeds]

no deposit link. don't ask. i want two weeks of my own money getting bruised first.

verify: [solscan] [ledger] [pyth feeds]

---

## POST 2 - The Clarification (ship this week, 3 to 5 days after POST 1, once POST 1 has settled and questions have come in)

**Trigger:** Send when POST 1 has accumulated enough replies that the "no hallucination" and "solved RLHF" questions are visible in the chat, or by day 5 post-vault if the chat is quiet. Timestamp: T0 + 3 to 5 days.

**Pre-publish checklist:**
- [ ] link to the specific ledger snapshot that shows the gated vs ungated win-rate split (`[ledger url]`)
- [ ] confirm ship-plan timing still matches reality before sending

**Draft:**

owe the chat a cleanup on two things i said loose.

"no hallucination" was shorthand. what it actually means: the ranker is consistency-gated through an energy model, so when the gate doesn't fire, the system falls back to EW instead of inventing a pick. no, it's not a claim that the model can't be wrong. yes, it's a claim that it refuses to act when it's not sure.

"solved RLHF" was also shorthand and it was too big. the narrow version: i removed human labeling from the narrated-outcome ranker task specifically. that is one task. it does not generalize. i should not have phrased it the way i did.

live paper ledger so far: bible-HIGH beats EW on the confidence-gated subset, and underperforms or matches on the ungated tail. both numbers are posted. read them both: [ledger url]

ship plan from here: treasury vault today (done), unbrowse monetization in roughly 2 weeks, m3 lock program in 3 to 4 weeks pending audit.

thanks for the patience while i match the claims to the evidence.

---

## POST 3 - First Unbrowse Revenue Routed (ship in 2 to 3 weeks, when first Unbrowse payment clears and is swept to the vault)

**Trigger:** Send within 24 hours of the first Unbrowse revenue transaction being routed to the vault wallet and appearing as an inflow on the public ledger. Timestamp: T0 + 14 to 21 days.

**Pre-publish checklist:**
- [ ] inflow transaction visible on solscan, link it: `[solscan link]`
- [ ] ledger snapshot shows the inflow, link it: `[ledger url]`
- [ ] whitelist published in pinned message
- [ ] per-wallet cap published in pinned message

**Draft:**

first unbrowse revenue just hit the vault. yes, real revenue. no, not a test transfer.

inflow on solscan: [solscan link]
inflow on the ledger: [ledger url]

this is the mechanism i promised. unbrowse earns, vault receives, ledger shows it. no middle steps, no "trust me."

with that flywheel live and the 14-day own-capital window closed, i'm opening external deposits for trusted holders only for now. whitelist is in the pinned message. cap per wallet is posted. the cap exists because i'd rather grow slow and keep the ledger clean than onboard too fast and fumble a rebalance.

same basket, same daily rebalance, same signal stack, same public ledger. nothing about the strategy changes because the money got bigger.

---

## POST 4 - M3 Lock Program Live (ship in 3 to 4 weeks, the day the M3 lock contract finishes audit and deploys)

**Trigger:** Send the day the audited M3 lock contract is deployed to mainnet and the stake UI is reachable. Timestamp: T0 + 21 to 28 days.

**Pre-publish checklist:**
- [ ] audit report pdf/url published in pinned message
- [ ] lock contract address published in pinned message (`[solscan link]` for contract)
- [ ] stFDRY token mint address published in pinned message
- [ ] buyback schedule visible on ledger (`[ledger url]`)

**Draft:**

m3 lock program is live. yes, audited. no, not required.

lock FDRY for 90 days, get stFDRY back. stFDRY is transferable, so you are not stuck if life happens, you can sell the position without waiting out the lock. the underlying FDRY stays locked until the 90 days clear.

vault revenue gets routed to FDRY buyback on a schedule posted on the ledger: [ledger url]. the buyback is not a promise of price, it is a mechanism. the mechanism is visible, the volume is visible, the cadence is visible.

audit report is linked in the pinned message. contract addresses are in the pinned message. do not stake from a link that is not the pinned message.

contract on solscan: [solscan link]

ledger keeps doing what it has been doing since day one: showing the flows.

---

## Send Cadence Summary

| Post | Trigger | Earliest | Latest |
|---|---|---|---|
| 1 | Symmetry vault on chain + seed confirmed | T0 (today) | T0 + 2 hours |
| 2 | Questions accumulating OR day 5 post-vault | T0 + 3 days | T0 + 7 days |
| 3 | First Unbrowse revenue swept to vault | T0 + 14 days | T0 + 21 days |
| 4 | Audited M3 lock contract deployed | T0 + 21 days | T0 + 28 days |

Tone target across all four: founder being precise because precision is the product, not marketing copy. No celebration language. No price talk. No "moon." Every claim ties to something a reader can click and verify.

## Placeholder legend

Lewis fills these in at publish time. Do not send with any of these still in the post:

- `[solscan link]` - a solscan.io url for the relevant pubkey, transaction, or contract
- `[ledger url]` - the specific deep-link into `https://lekt9.github.io/fdry/ledger/` that shows the referenced state
- `[pyth feeds]` - a link to the Pyth price feeds used by the vault (pyth.network or the specific feed ids page)
