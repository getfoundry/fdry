# FDRY Style Guide — Marketing & Comms

Purpose: prevent overclaim regression in future posts. Every public sentence about FDRY passes through this guide before it ships.

This is a living doc. When a claim is falsified, add it to the deny-list. When a new capability actually ships, move it from deny-list to allow-list.

---

## Things we say

These are the phrases we've earned the right to use. They map 1:1 to things a researcher can verify on-chain, in the repo, or in `/runs/`.

- **"treasury vault"** — the on-chain SOL-denominated vault that backs stFDRY.
- **"share of NAV"** — what stFDRY represents: a pro-rata claim on the vault's net asset value.
- **"public ledger"** — trades, rebalances, and NAV are visible on Solscan; nothing is hidden.
- **"equal-weight rotation"** (or **"EW fallback"** when technical) — the default allocation policy when the signal layer is inconclusive or disabled.
- **"share-of-Unbrowse-revenue"** — use *only after* monetization ships and revenue share is wired into the vault. Until then: don't say it.
- **"experimental"** — the honest frame. This is a research system, not a product.
- **"capital at risk"** — every public-facing post that mentions the vault, stFDRY, or returns must say this somewhere.

### Preferred framings

- "The vault holds SOL" — not "FDRY is locked."
- "NAV changed by X over window Y" — not "we returned X%."
- "Backtest across windows A/B/C shows..." — not "our strategy makes money."
- "You can verify this at [solscan link]" — whenever possible, link the primary source.

---

## Things we never say

These are the tripwires. If any of these phrases appear in a draft, stop and rewrite.

- **"passive yield"** / **"APY"** / **"APR"** — implies a fixed or expected return. FDRY has neither.
- **"guaranteed"** / **"risk-free"** — never. Not even rhetorically. Not even in jokes.
- **"solved [X]"** — if you want to say this, first run `/sanity-check` against the repo. If `/sanity-check` doesn't pass, you didn't solve it.
- **"no hallucination"** / **"no bugs"** / **"no losses"** — absence claims are unfalsifiable-until-falsified. Don't make them.
- **"FDRY is locked"** — the vault holds **SOL**, not FDRY. FDRY is the governance/share token. Conflating the two misleads.
- **"quant alpha"** — off-limits until the backtest consistently beats EW across **>=5/7 windows**. Until then we have a research experiment, not alpha.
- **"limited time"** / **"exclusive"** / **"whale alert"** — pump-cult vocabulary. We don't speak it.

### Adjacent traps to avoid

- "Audited" — unless a named third party has actually audited and published the report.
- "Institutional-grade" — meaningless; regulators read it as a promise.
- "Backed by" — only for assets literally in the vault, not for endorsements or inspirations.
- "DeFi 2.0" / "next-gen" — empty signalling.

---

## The 60-second rule

**If a researcher can falsify it in 60 seconds, don't post it.**

Before anything goes public, run it through these four tests. If any one fails, the claim doesn't ship.

### 1. The Solscan test
Does on-chain history match the claim?
- If the post implies a trade happened, the tx should be linkable.
- If the post implies NAV moved, the vault account should show it.
- If the post implies a rebalance cadence, on-chain frequency should match.

### 2. The Repo test
Does code implement what the claim says?
- If the post names a mechanism (e.g. "EW fallback", "signal weighting"), that code path exists and is reachable.
- If the post describes a safety (e.g. "slippage guard"), the guard is in the executing path, not a dead branch.

### 3. The Data test
If it's a performance claim, is the data in `/runs/` public?
- Backtest numbers come from a committed, reproducible run file.
- Windows, parameters, and seed are disclosed.
- Cherry-picked windows are called out as such, or not used.

### 4. The Regulator test
Could this be read as a promised return or a security offering?
- Read the draft as if you were the SEC / MAS / FCA. Would they see a yield promise?
- Read it as if you were a retail investor. Would they infer a guarantee?
- If either reading is plausible, rewrite.

---

## Revision process

Every post goes through this loop before it ships. No exceptions for "quick" posts — quick posts are the ones that overclaim.

1. **Draft the post.**
2. **Run it against this guide.** Check allow-list. Check deny-list. Run the four tests.
3. **Have bible-EBM score it** (optional but recommended for anything going to a channel with >100 readers).
4. **Let a non-technical friend read it.** Ask: *"If you put money in based on this, what would you expect?"* If they infer a guarantee, the post is wrong.
5. **If any test fails: rewrite.** Don't ship a version with a caveat bolted on. Rewrite from the claim up.

---

## Quick reference card

| Situation | Say this | Not this |
|---|---|---|
| Describing the vault | "treasury vault holding SOL" | "FDRY is locked" |
| Describing stFDRY | "share of NAV" | "yield token" / "APY bearing" |
| Describing returns | "NAV moved X over window Y" | "we returned X%" / "X% APY" |
| Describing the strategy | "equal-weight rotation" / "EW fallback" | "quant alpha" (until 5/7) |
| Describing the state | "experimental" | "production" / "proven" |
| Describing risk | "capital at risk" | (silence) |
| Describing verification | "public ledger — see solscan" | "trust us" |

---

## When in doubt

Default to the more conservative framing. The upside of a modest claim that turns out to be right is trust. The downside of an immodest claim that gets falsified is the whole project.

**We'd rather be boring and honest than viral and wrong.**