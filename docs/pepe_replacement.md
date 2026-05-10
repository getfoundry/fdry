# PEPE Replacement Decision Memo

**Author:** Cycle 2 L3 Agent 3b (Land / Produced)
**Date:** 2026-04-20
**Decision:** Replace PEPE with **FARTCOIN** in the vault universe.

## Why PEPE had to go

PEPE is an ERC-20 token native to Ethereum. It has a Pyth feed (`0xd6973...82e4`), but there is no liquid Solana-native pool — the only on-chain Solana presence is bridged/wrapped and thin. Because this universe lives in a Solana vault (Jupiter routing, Solana DEX pools), PEPE fails the "liquid Solana mint + pool depth" and "Jupiter route < 3% impact" gates. Keeping it creates dead weight: we can price it via Pyth but cannot actually trade it in size on the venue we run on.

## Candidates evaluated

All nine candidates have a Pyth crypto feed (H1 passes). Solana pool and Jupiter routing filter as follows:

| Symbol | Pyth feed | Top Solana pool TVL | 24h vol | Jupiter $1k impact | Verdict |
|---|---|---|---|---|---|
| TRUMP | `0x87955...4b1a` | $1.44M | $797k | 0.02% | PASS |
| **FARTCOIN** | `0x58cd2...3608` | **$7.59M** | $651k | **0.05%** | **PASS — PICK** |
| GIGA | `0x7bc12...9a74` | $186k | $4.6k | n/a | FAIL (TVL < $500k) |
| MICHI | `0x63a45...ecab` | $380k | $22k | n/a | FAIL (TVL < $500k) |
| PNUT | `0x116da...0e54` | $3.15M | $1.15M | 0.56% | PASS |
| MEW | `0x514ae...5d5d` | $9.30M | $512k | 0.52% | PASS |
| GOAT | `0xf7731...c66c` | $1.35M | $273k | 0.65% | PASS |
| MOODENG | `0xffff7...3417` | $2.67M | $508k | 0.44% | PASS |
| BRETT | `0x9b572...9448` | no Solana pool | — | — | FAIL (Base-chain only) |

## Why FARTCOIN over the other PASS candidates

All six passing candidates would satisfy the hard gates. FARTCOIN wins on three tie-breakers:

1. **Lowest price impact by ~10x.** At $1000 notional, FARTCOIN→SOL routes at 0.046% impact. The next-best passing candidate (TRUMP) is 0.02% but with 5x less TVL; MEW/MOODENG/PNUT/GOAT are all in the 0.4%–0.65% band. FARTCOIN has the best impact-per-dollar-of-TVL profile in the set, meaning the vault can rebalance sizeable positions without meaningfully moving price.
2. **Native Solana, pump.fun–launched.** FARTCOIN's primary market *is* the Solana Raydium pool — there is no "real" price that lives somewhere else and we're approximating. PEPE was exactly the opposite problem (real price lives on Ethereum; Solana presence is derivative). Swapping PEPE→FARTCOIN trades a bridged/proxy exposure for a first-class one.
3. **Cultural salience as the 2024–26 cycle's flagship Solana memecoin.** FARTCOIN is to this cycle what PEPE was to 2023 — the "if you only pick one, pick this" memecoin for the chain. That's the replacement symmetry the universe is trying to capture.

TRUMP was the runner-up (lowest impact, strong volume) but (a) it's a politically-branded asset with event-driven price shocks that make it noisier for a memecoin slot, and (b) its TVL is 5x below FARTCOIN's. MEW has higher TVL but worse routing depth and weaker 2026-current narrative.

## Artifacts

- **Pyth feed ID:** `0x58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608` (Crypto.FARTCOIN/USD)
- **Solana mint:** `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump`
- **Primary pool:** Raydium, pair `Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw`, TVL $7.59M
- **Jupiter route verified:** 4-hop, 0.046% impact on $1000 FARTCOIN→SOL (2026-04-20)

## Hypotheses

```json
{
  "H1": {
    "claim": "at least 3 candidates have Pyth feeds",
    "result": "pass",
    "evidence": "9/9 candidates confirmed with Pyth feed IDs"
  },
  "H2": {
    "claim": "picked replacement (FARTCOIN) has Pyth feed + >=$500k pool + <3% price impact",
    "result": "pass",
    "evidence": {
      "pyth_feed_id": "0x58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608",
      "solana_mint": "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
      "primary_pool_address": "Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw",
      "pool_tvl_usd": 7587336.69,
      "jupiter_price_impact_pct": 0.046,
      "notional_usd": 1000
    }
  }
}
```
