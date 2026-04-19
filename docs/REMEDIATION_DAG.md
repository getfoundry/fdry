# Remediation DAG — Cycle 2 L2 Agent 2a (Firmament / Separation)

Source: `docs/HARNESS_VERDICT.md` §Remediation sequence (items 1..9).
Dimension: dependency structure (what depends on what, what's the critical path).
Primitive: hybrid (prose + ASCII DAG).

---

## Item index (as numbered in HARNESS_VERDICT.md)

| # | Ref | Title | Raw effort |
|---|-----|-------|-----------|
| 1 | B5 | HOT rotation runbook → SPEC §4.x | 30 min |
| 2 | N6, N1 | Jupiter endpoint + SDK param names in SPEC §5/§6/§7 | 45 min |
| 3 | B4 | Rewrite SPEC §8 "Expected income" to $0/yr + SYMMETRY.md fee table | 20 min |
| 4 | B2 | Pick replacement memecoin for PEPE (Pyth + ≥$500k pool) | 2 hrs |
| 5 | B1 | Add `--tokens`/`--cost_bps` to `jesus_loop_pair_daily.py`, rerun, write `runs/spec_final_backtest/` | 1–2 days |
| 6 | B3 | Pick architectural path (grow pool / market honestly / pivot Track 2); update SPEC §1 | ~1 day |
| 7 | N3, N4 | Patch pipeline to emit per-token weight vectors; cover universe mismatch | 1 day |
| 8 | N7 | Write `SIGNAL_CONTRACT.md` | 20 min |
| 9 | N2 | Update SHIP.md timeline to 4–5 weeks | 10 min |

---

## Per-item dependency table

| # | Prerequisites (must-finish-first) | Parallelizable-with | Blocks (downstream) |
|---|-----------------------------------|---------------------|---------------------|
| 1 | — | 2, 3, 4 | (none — leaf write) |
| 2 | — | 1, 3, 4 | (none — leaf write) |
| 3 | — | 1, 2, 4 | (none — leaf write) |
| 4 | — | 1, 2, 3 | 5, 7 |
| 5 | 4 (need final universe for `--tokens`) | 7 (CLI + pipeline patches touch same file; prefer to land 5 first, then 7) | 6 (DECISION POINT — backtest result informs path) |
| 6 | 5 (backtest verdict feeds "grow / market-honestly / pivot" choice) | 7, 8 (only if you treat 7/8 as universe-independent infra work) | 9 (chosen path changes timeline) |
| 7 | 4 (needs final universe) | 5 (if dev-split: one engineer adds CLI, another patches weight-vector emission) | 8 |
| 8 | 7 (schema must be known before contract is written) | 6 (if 6 is underway) | (none) |
| 9 | 6 (timeline wording reflects chosen path) | — | (none — final leaf) |

Notes:
- Items 1, 2, 3 are pure SPEC/markdown edits with **no shared sections** (B5 → §4.x, N6/N1 → §5/§6/§7, B4 → §8 + SYMMETRY.md). They are trivially parallelizable.
- Item 4 is independent research/verification — no SPEC section overlaps with 1/2/3.
- Item 5 blocks Item 6 because B3's architectural choice is explicitly gated on the backtest DECISION POINT: "if bible-HIGH still loses to EW, pause and reconsider strategy before any further work."
- Item 7 reasonably requires the final universe (item 4) so the pipeline doesn't need a second pass; in practice it also touches the same file as item 5, so sequential landing (5 → 7) avoids merge pain even though they could be split across two engineers.

---

## DAG (ASCII)

```
                      ┌─────┐   ┌─────┐   ┌─────┐
                      │  1  │   │  2  │   │  3  │
                      │ B5  │   │N6N1 │   │ B4  │
                      │30min│   │45min│   │20min│
                      └─────┘   └─────┘   └─────┘
                       (leaf)    (leaf)    (leaf)


                           ┌─────────┐
                           │   4     │
                           │   B2    │
                           │ memecoin│
                           │  2 hrs  │
                           └────┬────┘
                                │
                     ┌──────────┴──────────┐
                     v                     v
               ┌─────────┐            ┌─────────┐
               │   5     │            │   7     │
               │   B1    │            │ N3 N4   │
               │backtest │            │pipeline │
               │ 1–2 day │            │  1 day  │
               └────┬────┘            └────┬────┘
                    │                      │
                    │DECISION POINT        v
                    │                 ┌─────────┐
                    v                 │   8     │
               ┌─────────┐            │   N7    │
               │   6     │            │contract │
               │   B3    │            │ 20 min  │
               │  path   │            └─────────┘
               │  ~1 day │
               └────┬────┘
                    │
                    v
               ┌─────────┐
               │   9     │
               │   N2    │
               │timeline │
               │ 10 min  │
               └─────────┘
```

Legend: `A ──> B` means A must finish before B can start.

---

## Critical path

Longest chain of hard dependencies (each arrow is a must-finish-first):

```
4  ──>  5  ──>  6  ──>  9
B2     B1     B3     N2
2hr    1–2d   ~1d    10min
```

Wall-clock sum (best case): 2h + 1d + 1d + 10min ≈ **~2.1 days**.
Wall-clock sum (worst case): 2h + 2d + 1d + 10min ≈ **~3.1 days**.

- Item **5 (B1 backtest rerun)** is the single longest task at 1–2 days and is the critical-path bottleneck.
- Items 1, 2, 3, 7, 8 do not extend the critical path as long as they finish inside the 5→6 window.

Secondary chain (doc contract path, does not dominate): `4 → 7 → 8` ≈ 2h + 1d + 20min.

---

## Items that can complete end-to-end in parallel without touching each other

Touch-isolation analysis (which files/sections each item writes):

| Item | Touches |
|------|---------|
| 1 (B5) | SPEC §4.x |
| 2 (N6, N1) | SPEC §5, §6, §7 (pseudo-code only) |
| 3 (B4) | SPEC §8, SYMMETRY.md fee table |
| 4 (B2) | Universe config (oracles.json / tokens list), verification notes |
| 5 (B1) | `jesus_loop_pair_daily.py`, `runs/spec_final_backtest/` |
| 6 (B3) | SPEC §1 |
| 7 (N3, N4) | `jesus_loop_pair_daily.py` (`simulate`/`run_window`), pipeline output schema |
| 8 (N7) | new `SIGNAL_CONTRACT.md` |
| 9 (N2) | SHIP.md |

Fully parallel-safe sets (no dependency edge between them, no file overlap):

- **{1, 2, 3}** — three SPEC-section edits, fully disjoint sections, no prereqs. Run concurrently on day 0.
- **{1, 2, 3, 4}** — same as above plus the memecoin research; 4 is pure config/research, no SPEC overlap.
- **{5, 7}** — *conceptually* parallel (both depend only on 4) but both edit `jesus_loop_pair_daily.py`; safe only with a branch-per-engineer + explicit merge, otherwise serialize 5 then 7.
- **{6, 8}** — after 5 and 7 complete respectively, these can proceed in parallel (6 writes SPEC §1, 8 writes a new file).

Recommended execution shape:

```
day 0 (morning):  1 || 2 || 3 || 4         (four agents in parallel)
day 0 (afternoon) → day 1–2:  5            (CRITICAL PATH)
day 1 (afternoon parallel branch):  7      (touches same file as 5 — serialize or branch)
day 2:            6 || 8                    (after 5 and 7 respectively)
day 2 (end):      9                         (after 6)
```

---

## Circular dependencies

**None.** The graph is a DAG. Verification by Kahn's algorithm:

- Sources (in-degree 0): {1, 2, 3, 4}
- Remove 1, 2, 3: no edges affected (they are leaves). Remove 4: frees {5, 7}.
- Remove 5: frees {6}. Remove 7: frees {8}.
- Remove 6: frees {9}. Remove 8: no further frees.
- Remove 9: queue empty.

All 9 nodes consumed → acyclic.

## Unreachable items

**None.** Every item is in the forward-closure of {1, 2, 3, 4} (all have a path from at least one source).

---

## Hazards / soft-edge risks

1. **5 ↔ 7 file conflict**: both edit `jesus_loop_pair_daily.py`. Treated above as "parallelizable-with" under branch-split discipline; otherwise serialize.
2. **DECISION POINT on 5**: if B1 backtest shows bible-HIGH still loses to equal-weight, the HARNESS_VERDICT explicitly says "pause and reconsider strategy before any further work." That is an **escape hatch from the DAG**, not a cycle — items 6, 7, 8, 9 would be suspended pending strategic replan, not re-triggered.
3. **6 → 9 soft edge**: if B3 resolves to path (c) "pivot to Track 2", SHIP.md timeline needs more than a 10-min edit — the phases themselves reshape. That is scope creep inside node 9, not a new edge.
