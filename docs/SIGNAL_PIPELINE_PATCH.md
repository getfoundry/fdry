# SIGNAL_PIPELINE_PATCH.md

**Status:** spec-only (not applied)
**Cycle/Agent:** Cycle 2 L6 Agent 6b — Dominion/Integration
**Predecessor finding:** Cycle 1 L5-5d — `jesus_loop_pair_daily.py` emits a
ranker-summary JSON (`rank_bible_high_energy: {sharpe, return}`, etc.) but
**never persists the per-bar `new_w` dict**. The bot cannot consume it.
**Downstream contract:** `docs/SIGNAL_CONTRACT.md` (v0.1).
**Target signal file:** `/Users/lekt9/Projects/fdry/runs/daily_signal/YYYY-MM-DD.json`.

---

## 1. Goal

Patch `/Users/lekt9/Projects/unify/.fib-harness-v2.4/jesus_loop_pair_daily.py`
so that, in addition to its existing summary report, it persists the **last
`new_w` dict** (the final-bar target weight vector) for each config in the
**bible-HIGH top-k** selection on the **holdout** leg of each window, then
aggregates those into a single `weights_bp` vector that conforms to
`SIGNAL_CONTRACT.md`.

This is the smallest change that makes the fib-harness a first-class producer
for `fdry`'s bot without refactoring the simulation loop.

---

## 2. Current state (verified from source, hash 7fb0fd6e)

| symbol       | lines    | role                                                                     |
|--------------|----------|--------------------------------------------------------------------------|
| `simulate`   | L86-164  | inner per-config walk. Builds `new_w` each bar (L118/122/131/135/147).   |
|              |          | Returns only scalar metrics (`sharpe`, `total_return`, `max_drawdown`,   |
|              |          | `vol`, `n_bars`). **`new_w` is discarded when the loop ends.**           |
| `run_window` | L263-312 | samples `n_configs`, ranks on train via four rankers, then for each      |
|              |          | ranker calls `eval_top(order)` which re-runs `simulate` on holdout. The  |
|              |          | `bible_high` order is built at L286, holdout eval at L298 via `eval_top` |
|              |          | (`def` L288-293). `eval_top` currently returns only `(sharpe, return)`.  |
| `main`       | L313-405 | per-window loop L341-364, final JSON write at L398 to                    |
|              |          | `runs/v8/jupiter_paper/jesus_loop_pair_daily_report.json` (`OUT`, L38).  |

**Key observation:** the `new_w` dict mutates every bar inside `simulate`
(L118/122/131/135/147) and the variable binding after the loop exits holds the
**last-bar target weights** — which is exactly the "what to hold starting
next bar" vector the bot needs. We harvest it without changing semantics.

---

## 3. Patch design (minimal, spec only)

### 3.1 Hook 1 — return `final_w` from `simulate`

**Location:** `simulate` return at L163-164.

**Change:** add `"final_w": {s: float(v) for s, v in prev_w.items()}` to the
returned dict. `prev_w` is assigned at L156 as the last `new_w` after the
final bar, so it is the correct "next-bar target weights" vector. When
`simulate` returns `None` (early exit at L94 / L157) behaviour is unchanged.

**LOC:** +1 line in the return dict literal.

**Risk:** zero for existing callers — they read `sharpe` / `total_return` /
`max_drawdown` / `vol` / `n_bars` by key; an extra key is ignored.

### 3.2 Hook 2 — surface holdout `final_w` in `run_window`

**Location:** `eval_top` nested function, L288-293.

**Change:** when iterating `holds = [simulate(..., configs[i]) for i in order]`,
also retain the per-config holdout `final_w`. Return a third value, a list of
`new_w` dicts (one per valid holdout sim) alongside `(mean_sharpe, mean_ret)`.
Only plumb this for the **bible-HIGH** ranker — the other three rankers don't
need it. Simplest shape:

```python
def eval_top(order, want_weights=False):
    holds = [simulate(bars_by_sym, hold_times, configs[i]) for i in order]
    holds_ok = [h for h in holds if h]
    if not holds_ok:
        return (float("nan"), float("nan"), []) if want_weights else (float("nan"), float("nan"))
    sh = float(np.mean([h["sharpe"] for h in holds_ok]))
    rt = float(np.mean([h["total_return"] for h in holds_ok]))
    if want_weights:
        ws = [h["final_w"] for h in holds_ok if "final_w" in h]
        return sh, rt, ws
    return sh, rt
```

Then replace the bible-HI call at L298:
`bh_sh, bh_r, bh_weights = eval_top(order_bi_hi, want_weights=True)`

and add `"bible_high_final_w": bh_weights` to the `run_window` return dict
(L301-310).

**LOC:** +6 lines in `eval_top`, +1 on the bh call, +1 on return dict = **~8 LOC**.

**Risk:** the default-arg form keeps the three other callers (`order_sh`,
`order_cp`, `order_bi_low`) on the two-tuple unpacking — zero change to
their lines (L295-297). Only the bible-HI unpacking at L298 is rewritten.

### 3.3 Hook 3 — aggregate + emit daily signal in `main`

**Location:** after the final `OUT.write_text(...)` at L398, before the final
summary prints (or at end of `main`, L405).

**Change:** add a new block that:

1. Collects `all_w = [w for r in results for w in r.get("bible_high_final_w", [])]`
   — flatten across windows. Each `w` is a `dict[str, float]` over the
   configured `TICKERS` subset that was actually held at the final bar.
2. Calls a new helper `emit_daily_signal(all_w, results)` that:
   a. Projects onto the fixed 8-token universe from `SIGNAL_CONTRACT.md`
      (`["SOL","WIF","JTO","BONK","PYTH","JUP","ORCA","RAY"]`). Tokens in
      `all_w` but not in universe are dropped; tokens in universe but never
      held get weight 0.
   b. Takes the **mean** across `all_w` entries per-token (sum / count).
      Normalises so non-negative weights sum to 1.0. If sum is 0 (all flat),
      **fail-closed**: raise and exit non-zero, write NOTHING.
   c. Converts to integer basis points (`round(w * 10000)`).
   d. Applies `MAX_BP=3000` cap, redistributes excess proportionally to
      uncapped tokens, absorbs integer residual into the largest weight so
      `sum == 10000` exactly (invariant 1).
   e. Computes `confidence`. Simplest v0.1 choice: **ranker-agreement** via
      fraction of windows where `rank_bible_high_energy.sharpe >
      rank_train_sharpe.sharpe` AND `> equal_weight.sharpe`. Bounded to
      `[0,1]`. Record `metadata.confidence_source = "bible_hi_win_rate"`.
      (bible-EBM energy path is a follow-up; ranker-agreement is computable
      from data already in `results` without extra inference.)
   f. Assembles payload:
      ```python
      payload = {
          "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(
              timespec="seconds").replace("+00:00", "Z"),
          "signal_version": "v0.1",
          "universe": UNIVERSE,
          "weights_bp": bp,
          "confidence": confidence,
          "ranker": "bible_high",
          "metadata": {
              "n_configs": args.n_configs,
              "n_windows": len(results),
              "cost_bps": int(COST_BPS),
              "confidence_source": "bible_hi_win_rate",
              "n_weight_vectors": len(all_w),
          },
      }
      ```
   g. Writes atomically to
      `/Users/lekt9/Projects/fdry/runs/daily_signal/YYYY-MM-DD.json` —
      `NamedTemporaryFile` in the same directory, `json.dump`, then
      `os.replace` (matches the contract's atomicity requirement §2).
   h. Re-verifies invariants 1-7 from `SIGNAL_CONTRACT.md` §3 **before**
      `os.replace`. On violation: delete tmp, raise, exit non-zero. Bot sees
      staleness and skips rebalance (fail-closed).

3. Wraps the block in `try/except` that logs to stderr and `sys.exit(2)` on
   any failure. The existing `OUT.write_text` at L398 is **not** guarded —
   if the summary writes but the signal fails, the existing report is still
   preserved for debugging, but the bot's daily_signal file is absent and
   the bot fails closed on its side.

**LOC:** ~55-70 new lines, most of them in the `emit_daily_signal` helper
(aggregation, capping, invariant re-check, atomic write). New imports:
`os`, `tempfile`, `datetime as dt`. `Path` is already imported.

**Risk:**
- **Existing report path:** untouched. `OUT.write_text(...)` at L398 still
  runs first. Worst case the new block raises and exits non-zero after the
  summary JSON is already on disk. The nightly-loop caller sees a non-zero
  exit, which is correct fail-closed behaviour for the bot.
- **Universe mismatch:** if `TICKERS` (L39: `BTC, ETH, SOL, BONK, DOGE,
  FLOKI, PEPE`) has no overlap with the contract universe
  (`SOL, WIF, JTO, BONK, PYTH, JUP, ORCA, RAY` — only `SOL` and `BONK`
  overlap as of this spec), aggregation will produce only 2 non-zero
  weights. Contract allows `min >= 0` on the 6 non-held tokens, so the
  payload is still valid. **Operator action required before rollout:** run
  the harness with `--tokens` matching the 8-token contract universe (or
  expand `TICKERS` default). Flagged here as a deploy-time, not patch-time,
  concern.
- **Pair-EBM calls:** untouched. `get_ebm()` at L264 and `pair_energy_batch`
  at L274 keep working. Patch is pure data-capture downstream of them.
- **Performance:** negligible — `final_w` is a small dict, one extra key
  copy per valid simulate call. No new model calls.

### 3.4 Summary of changes

| # | file                                                                     | symbol      | LOC |
|---|--------------------------------------------------------------------------|-------------|-----|
| 1 | `jesus_loop_pair_daily.py`                                               | `simulate`  | +1  |
| 2 | `jesus_loop_pair_daily.py`                                               | `run_window`| +8  |
| 3 | `jesus_loop_pair_daily.py`                                               | `main`      | +60 |
| 4 | `jesus_loop_pair_daily.py` (imports: `os`, `tempfile`, `datetime as dt`) | module top  | +1  |

**Total patch size: ~70 LOC.** No deletions. No signature changes on public
functions. Net additive.

---

## 4. Aggregation across top-k — single target vector

Inputs: `all_w: list[dict[str, float]]` — one dict per bible-HIGH top-k
config per window (so `top_k * n_windows` entries, minus any invalid sims).

Algorithm:

1. `sums[t] = 0.0` for every `t` in `UNIVERSE`.
2. For each `w` in `all_w`: for each `(t, v)` in `w.items()`, if `t in UNIVERSE`
   and `v > 0`, `sums[t] += v`. (Longshort mode can emit negative weights —
   v0.1 contract is long-only, so we **drop shorts** here. This is a
   documented v0.1 simplification; a future `weights_version` can add
   `shorts_bp`.)
3. `total = sum(sums.values())`. If `total <= 0`: **fail-closed**, exit 2.
4. `norm[t] = sums[t] / total` — now sums to 1.0.
5. `bp[t] = round(norm[t] * 10000)` — integer basis points.
6. Cap: while any `bp[t] > 3000`, set it to 3000 and redistribute the
   excess proportionally to uncapped tokens (repeat until stable).
7. Residual: `residual = 10000 - sum(bp.values())`. Add `residual` to the
   `argmax` token (invariant 1: sum exactly 10000). This works for small
   positive or negative residuals (rounding can go either way).
8. Re-assert `0 <= min(bp.values())`, `max(bp.values()) <= 3000`,
   `sum(bp.values()) == 10000`, `set(bp.keys()) == set(UNIVERSE)`.

This mirrors the reference `aggregate` + `cap_and_renormalise` sketched in
`SIGNAL_CONTRACT.md` §7, but driven directly from harvested `final_w` rather
than a separate re-reader script.

---

## 5. Test strategy

### 5.1 Unit (no model, no bars)

Location: `/Users/lekt9/Projects/unify/.fib-harness-v2.4/tests/test_signal_emit.py`
(new file). Pytest. No network, no EBM load.

1. **`test_aggregate_uniform`** — 10 identical `new_w = {SOL: 0.5, WIF: 0.5}`
   dicts → expect `{SOL: 5000, WIF: 5000, ...rest: 0}`, sum 10000.
2. **`test_aggregate_cap`** — single `new_w = {SOL: 1.0}` → SOL capped to
   3000, excess 7000 redistributed proportionally across the 7 other
   universe tokens (1000 each), sum 10000.
3. **`test_aggregate_residual`** — crafted dicts that round to 9999 and to
   10001; assert invariant 1 post-residual-absorption.
4. **`test_aggregate_drops_shorts`** — `new_w = {SOL: 0.8, WIF: -0.3}` →
   WIF contribution ignored, SOL normalised to 10000 (then capped 3000 →
   redistribute as above).
5. **`test_aggregate_all_zero_fails`** — empty or all-zero `all_w` raises
   and sets non-zero exit. Contract §1 fail-closed.
6. **`test_emit_writes_atomic`** — mock `os.replace`, assert tmp-file path
   is in same dir, final path is `YYYY-MM-DD.json`, no partial file on
   raise.
7. **`test_emit_invariants_catch_bug`** — monkeypatch `aggregate` to
   return `{SOL: 9000, WIF: 2000}` (sum 11000) → emit raises before
   `os.replace`.

### 5.2 Integration (tiny window, real simulate)

Run `jesus_loop_pair_daily.py --n_configs 5 --top_k 2 --windows 1 --tokens SOL,WIF,JTO,BONK,PYTH,JUP,ORCA,RAY`
against cached bars. Assert:

- existing `OUT` report still written and parseable.
- `/Users/lekt9/Projects/fdry/runs/daily_signal/<today>.json` exists.
- JSON validates against the schema (§3 of contract) — a schema-check
  helper lives in `fdry/tools/` (or we add one).
- `sum(weights_bp.values()) == 10000`, `max <= 3000`, 8 keys matching
  universe, `confidence` in `[0,1]`.

### 5.3 Contract round-trip

Write a small `fdry` consumer test
(`/Users/lekt9/Projects/fdry/tests/test_signal_consumer.py`) that:

- reads the newest file under `runs/daily_signal/`.
- runs the bot's invariant checks from `SIGNAL_CONTRACT.md` §6.
- asserts all seven invariants.

This test is the hermetic coupling between producer and consumer — if the
harness patch regresses the contract, this test fails immediately.

### 5.4 Regression

- Run the **un-patched** command on a fixed seed, capture
  `jesus_loop_pair_daily_report.json`.
- Run the **patched** command with the same seed, same args.
- Diff the two JSONs: only additions (`bible_high_final_w` per window)
  should appear; `rank_bible_high_energy`, `mean_holdout_sharpe`,
  `win_rates_over_windows`, etc., must be byte-identical.
- This proves hook 1 + hook 2 are semantics-preserving.

### 5.5 Failure-mode drills

- Delete all bars for the 8 universe tokens → simulate returns None for
  all configs → `all_w` empty → emit raises → exit 2. Contract §1 satisfied.
- Force `aggregate` to produce sum=9999 by monkeypatching rounding →
  residual absorption fixes it → emit succeeds.
- Force a NaN into `new_w` (inject one bar with NaN weight) → invariant
  check catches before write → exit 2.

---

## 6. Rollout sequence

1. Apply the three hooks to `jesus_loop_pair_daily.py` exactly as specified
   (§3.1-3.3).
2. Add `tests/test_signal_emit.py`. Green locally.
3. Run regression (§5.4) on the prior night's data. Confirm byte-identical
   existing report.
4. Run integration (§5.2) with contract-universe tokens. Confirm signal
   file written and valid.
5. Wire into nightly cron / systemd under `flock` per contract §1.
6. `fdry` bot enables signal consumption. First week: dry-run (compute
   target but do not trade). Observe `weights_bp` trajectory and
   `confidence` distribution.
7. Flip to live.

---

## 7. Risk register

| risk                                                         | severity | mitigation                                                                              |
|--------------------------------------------------------------|----------|------------------------------------------------------------------------------------------|
| `prev_w` captures a "flat" bar (go_flat triggered at end)    | med      | if `prev_w == {}`, skip that config in `all_w`. If all skipped → fail-closed (§3.3 step 3) |
| Universe / `TICKERS` mismatch (currently 2/8 overlap)        | high     | deploy-time: run with `--tokens SOL,WIF,JTO,BONK,PYTH,JUP,ORCA,RAY`. Add an assertion at start of `main` when signal-emit mode is on |
| Longshort mode produces negative weights                     | med      | v0.1: drop shorts in aggregation (§4 step 2). Documented limitation.                    |
| Summary JSON writes but signal emit fails                    | low      | intentional — fail-closed on signal is the contract. Non-zero exit, bot skips rebalance. |
| Two concurrent harness runs race on the signal file          | med      | contract §1 mandates `flock` wrapper at the caller. Producer also uses atomic tmp+replace. |
| `final_w` key absent on some `simulate` returns (old cache)  | low      | `eval_top` filters `if "final_w" in h` (§3.2).                                          |
| Confidence via win-rate is crude                             | low      | documented as v0.1 (`confidence_source` in metadata). EBM-energy path queued for v0.2.  |

---

## 8. Files touched / created

- **edit:** `/Users/lekt9/Projects/unify/.fib-harness-v2.4/jesus_loop_pair_daily.py`
  (3 hooks, ~70 LOC added, 0 deleted).
- **new:** `/Users/lekt9/Projects/unify/.fib-harness-v2.4/tests/test_signal_emit.py`.
- **new (runtime, per day):** `/Users/lekt9/Projects/fdry/runs/daily_signal/YYYY-MM-DD.json`.
- **optional new:** `/Users/lekt9/Projects/fdry/tests/test_signal_consumer.py`.

No changes to `docs/SIGNAL_CONTRACT.md` — this patch exists to satisfy it,
not to evolve it. Any schema change bumps `signal_version` and is out of
scope for this ticket.

---

## 9. Out of scope / deferred

- Alternate `confidence_source = "bible_ebm_energy"` — requires calling
  `ebm.energy` on an A|SEP|B narrative built from the aggregated weight
  vector. Queue for v0.2.
- Short-book support (`shorts_bp` field). Needs contract bump to v0.2+.
- Dynamic universe discovery from ranker output. Contract §9 open
  question; keep hard-coded for v0.1.
- Replacing the separate `jesus_loop_weights_emit.py` producer sketched
  in contract §7. This patch **subsumes** that file — there is no need
  for a second script if we harvest `final_w` directly. Recommend
  deleting the stub reference in §7 when this patch ships, or keeping
  the standalone script as a post-hoc replayable tool (reads the
  existing summary + per-window `bible_high_final_w` and re-emits).

---

## 10. Hypothesis (for cycle ledger)

```json
{
  "agent": "cycle2_L6_6b",
  "dimension": "dominion_integration",
  "primitive": "code_design_spec",
  "claim": "A ~70-LOC additive patch to jesus_loop_pair_daily.py (3 hooks: simulate return, run_window eval_top, main emit) is sufficient to produce a SIGNAL_CONTRACT.md-conforming daily_signal JSON without altering existing simulation semantics or the existing summary report.",
  "hooks": [
    {"symbol": "simulate", "lines": "163-164", "loc_added": 1, "action": "add final_w to return dict from prev_w"},
    {"symbol": "run_window", "lines": "288-310", "loc_added": 8, "action": "eval_top returns weights list when want_weights=True; add bible_high_final_w to window dict"},
    {"symbol": "main", "lines": "398-405", "loc_added": 60, "action": "aggregate + emit atomic signal JSON; fail-closed on invariant violation"}
  ],
  "aggregation": {
    "method": "mean of bible-HIGH holdout final_w across top_k*n_windows, drop shorts, normalise to 1.0, scale to 10000 bp, cap 3000, absorb residual into argmax",
    "universe": ["SOL", "WIF", "JTO", "BONK", "PYTH", "JUP", "ORCA", "RAY"],
    "confidence_source_v0_1": "bible_hi_win_rate"
  },
  "risks": {
    "breaking_existing": "low — additive only; regression test (5.4) byte-compares existing report",
    "deploy_time_universe_mismatch": "high — current TICKERS overlap with contract universe is 2/8; must run with --tokens matching contract",
    "data_integrity": "low — atomic tmp+replace, 7-invariant re-check pre-replace, fail-closed on any violation"
  },
  "test_strategy": {
    "unit": 7,
    "integration": 1,
    "contract_round_trip": 1,
    "regression_byte_diff": 1,
    "failure_drills": 3
  },
  "estimated_loc": 70,
  "breaking_change": false,
  "contract_version_bump": false,
  "applies_patch": false,
  "next_agent_action": "apply the patch (cycle 2 L7) and run §5 suite"
}
```
