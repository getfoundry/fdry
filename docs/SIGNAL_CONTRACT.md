# SIGNAL_CONTRACT.md

**Status:** v0.1 draft
**Owners:** fdry/bot consumer, unify/bridge-harness producer
**Context:** Cycle 1 L5-5d finding — the current pipeline emits ranker *summaries*
(`bible_high`, `composite`, `train_sharpe` tables), not per-token weights. The bot
cannot consume those directly. This doc defines the one JSON artifact that the
trading bot reads, and the producer script that writes it.

---

## 1. Producer

**Path (to be created):**
`[INTERNAL_PATH]/.bridge-harness/weights_emit.py`

**Responsibility:** After each successful nightly bridge-harness run, read the
top-k config summary (the ranker output that already exists) and project each
config's `new_w` dict onto a fixed 8-token universe. Aggregate across top-k
(mean of weights, renormalised to sum to 10000 basis points). Write one JSON
file per UTC date to the output path below. Exit non-zero on any invariant
violation — the bot must never see a partially written or invalid file.

**Invocation:** run as the final step of the fib harness's nightly loop, after
the ranker summary is persisted. Recommended to be wrapped in a `flock` so two
concurrent loops can't stomp each other.

**Failure policy:** fail-closed. If there is no valid ranker output, or top-k
is empty, or aggregation produces NaN / missing token, the script must exit
non-zero and write NOTHING. The bot will see staleness and skip rebalance. Do
not emit a partial/degraded file.

## 2. Output

**Path:** `~/Projects/fdry/runs/daily_signal/YYYY-MM-DD.json`

Where `YYYY-MM-DD` is the UTC calendar date the signal was produced. The bot
reads the newest file in that directory at rebalance time. The producer must
write atomically (write to `.tmp` then `os.replace`) so the bot never sees a
half-written file.

## 3. Schema

```json
{
  "timestamp": "2026-04-20T04:15:00Z",
  "signal_version": "v0.1",
  "universe": ["SOL", "WIF", "JTO", "BONK", "PYTH", "JUP", "ORCA", "RAY"],
  "weights_bp": {
    "SOL":  1800,
    "WIF":  1500,
    "JTO":  1250,
    "BONK": 1250,
    "PYTH": 1100,
    "JUP":  1100,
    "ORCA": 1000,
    "RAY":  1000
  },
  "confidence": 0.72,
  "ranker": "bible_high",
  "metadata": {
    "n_configs": 300,
    "n_windows": 7,
    "cost_bps": 40
  }
}
```

### Field spec

| field             | type                              | notes                                                                                                   |
|-------------------|-----------------------------------|---------------------------------------------------------------------------------------------------------|
| `timestamp`       | string, ISO 8601 UTC, `Z` suffix  | moment the signal was computed. Must be timezone-aware and in UTC. Fractional seconds optional.         |
| `signal_version`  | string, `vN.N`                    | bumps on any schema or semantic change. Bot must refuse unknown major versions.                         |
| `universe`        | list[str], length 8, unique       | canonical token symbols in a fixed order. Identical across files for a given `signal_version`.          |
| `weights_bp`      | object[str -> int]                | keys are exactly `universe`. Values are non-negative integer basis points. **Sum equals exactly 10000.**|
| `confidence`      | float in `[0.0, 1.0]`             | derived from bible-EBM energy or cross-ranker agreement; see section 5.                                 |
| `ranker`          | enum                              | one of `"bible_high"`, `"composite"`, `"train_sharpe"`. Which ranker produced these weights.            |
| `metadata`        | object                            | free-form diagnostics. At minimum: `n_configs` (int), `n_windows` (int), `cost_bps` (int).              |

### Invariants (producer MUST enforce, bot MUST re-verify)

1. `sum(weights_bp.values()) == 10000` exactly. No floating-point rounding — use
   integer basis points and adjust the largest weight to absorb residual.
2. `max(weights_bp.values()) <= 3000` (30% cap on any single token).
3. `min(weights_bp.values()) >= 0`.
4. `set(weights_bp.keys()) == set(universe)`, and `len(universe) == 8`.
5. `confidence` is finite and in `[0, 1]`.
6. `ranker` is one of the three allowed values.
7. `signal_version` matches the version the bot was built against (major must
   match; bot may accept newer minor).

## 4. Freshness SLA

- The bot reads the file whose name matches *today's UTC date*.
- At bot consumption time, `now_utc - timestamp < 1 hour` must hold.
- If the file is missing, older than 1h, fails to parse, or violates any
  invariant -> **fail-closed**: skip this rebalance entirely, send a Telegram
  alert, and keep the current portfolio.

There is no fallback to yesterday's file. Stale signal is worse than no signal
— last night's weights trading into a regime change is exactly the failure we
are guarding against.

## 5. `confidence` — how it's computed

Pick one, stay consistent within a `signal_version`:

- **bible-EBM path:** `confidence = sigmoid(-energy / T)` where `energy` is the
  bible-EBM scalar on the aggregated weight vector and `T` is a calibration
  constant. Higher = more plausible under the bible prior.
- **ranker-agreement path:** Kendall-tau between the top-k rankings of
  `bible_high`, `composite`, `train_sharpe` mapped to `[0, 1]`. Higher =
  rankers agree.

Record which path was used in `metadata.confidence_source` (string).

The bot MAY additionally skip rebalance if `confidence < 0.3` (configurable, not
a hard invariant of the signal itself).

## 6. Bot behaviour

```
file = latest("~/Projects/fdry/runs/daily_signal/*.json")
if file is None:               alert("no signal file");         skip_rebalance()
if parse(file) fails:          alert("signal unparseable");     skip_rebalance()
if invariants fail:            alert("signal invalid: <why>");  skip_rebalance()
if now - timestamp > 1h:       alert("signal stale: <age>");    skip_rebalance()
if signal_version major != BOT_SCHEMA_MAJOR:
                               alert("signal version mismatch"); skip_rebalance()
# all good
rebalance_to(weights_bp)
```

Alerts go to the configured Telegram channel. Never silent-fail. Never fall
back to a prior file.

## 7. Reference implementation stub (producer)

Target: `[INTERNAL_PATH]/.bridge-harness/weights_emit.py`

```python
#!/usr/bin/env python3
"""Emit daily signal JSON from the bridge-harness top-k configs. Fail-closed."""
import json, os, tempfile, datetime as dt
from pathlib import Path

UNIVERSE = ["SOL","WIF","JTO","BONK","PYTH","JUP","ORCA","RAY"]
OUT_DIR  = Path("~/Projects/fdry/runs/daily_signal")
RANKER, TOP_K, MAX_BP, VERSION = "bible_high", 20, 3000, "v0.1"

def aggregate(top_k_configs):
    sums = {t: 0.0 for t in UNIVERSE}
    for cfg in top_k_configs:
        w = cfg["new_w"]                          # dict[str,float], sums ~1.0
        if set(w) != set(UNIVERSE): raise ValueError("universe mismatch")
        for t, v in w.items(): sums[t] += float(v)
    avg = {t: sums[t] / len(top_k_configs) for t in UNIVERSE}
    bp  = {t: int(round(avg[t] * 10000)) for t in UNIVERSE}
    return cap_and_renormalise(bp, MAX_BP)        # sum==10000, max<=MAX_BP

def emit(top_k_configs, confidence, meta):
    bp = aggregate(top_k_configs)
    assert sum(bp.values()) == 10000 and max(bp.values()) <= MAX_BP
    payload = {"timestamp": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
               "signal_version": VERSION, "universe": UNIVERSE, "weights_bp": bp,
               "confidence": float(confidence), "ranker": RANKER, "metadata": meta}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{dt.datetime.utcnow():%Y-%m-%d}.json"
    with tempfile.NamedTemporaryFile("w", dir=OUT_DIR, delete=False) as f:
        json.dump(payload, f, indent=2); tmp = f.name
    os.replace(tmp, path)                         # atomic
```

`cap_and_renormalise` is a small helper that clips any weight above `MAX_BP`,
redistributes the excess proportionally to uncapped tokens, and then absorbs
integer-rounding residual into the single largest weight so the sum is exactly
10000. Tests for that helper live next to the script.

## 8. Versioning

- `v0.1` — initial shape (this doc).
- Any breaking change (add/remove universe token, change basis-point scale,
  rename `weights_bp`, etc.) bumps the major: `v1.0`.
- Bot pins `BOT_SCHEMA_MAJOR`. Signal major mismatch -> fail-closed.

## 9. Open questions (not blockers for v0.1)

- Should `universe` be derived dynamically from ranker output rather than
  hard-coded? For now: hard-coded, single source of truth in both producer
  and bot. A mismatch is a deploy-time bug, not a runtime path.
- Do we want a second `weights_bp_conservative` field (e.g. blended with equal
  weight by `1 - confidence`)? Defer until we have live P&L feedback.
