#!/usr/bin/env python3
"""Luminaries — signal tests for fdry/ledger/performance.json.

Just weights (Prov 16:11). Rerunnable assertion suite.

Exit 0 if all pass. Exit 1 on first fail.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

FDRY  = Path("~/Projects/fdry")
UNIFY = Path("[INTERNAL_PATH]")
PERF = FDRY / "ledger/performance.json"
VERDICT = UNIFY / "runs/v8/v04_walkforward/verdict.json"

FAIL = []


def check(cond: bool, name: str, detail: str = ""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        FAIL.append(name)


def main():
    perf = json.loads(PERF.read_text())
    verdict = json.loads(VERDICT.read_text())

    print("=== S1: per-variant overall Sharpe matches source ===")
    for name, v in perf["variants"].items():
        src = verdict["overall"].get(name, {}).get("sharpe")
        check(abs(v["overall"]["sharpe"] - src) < 1e-9,
              f"{name} Sharpe",
              f"perf={v['overall']['sharpe']:+.6f} src={src:+.6f}")

    print("=== S2: headline reflects shipped variant ===")
    h = perf["headline"]
    s = perf["variants"][perf["shipped_variant"]]["overall"]
    check(abs(h["backtest_sharpe"] - s["sharpe"]) < 1e-9, "headline Sharpe matches shipped")
    check(abs(h["backtest_max_dd"] - s["max_dd"]) < 1e-9, "headline max_dd matches shipped")
    check(abs(h["backtest_terminal"] - s["terminal"]) < 1e-9, "headline terminal matches shipped")

    print("=== S3: shipped variant ranks #1 by Sharpe ===")
    by = sorted(perf["variants"].items(), key=lambda kv: kv[1]["overall"]["sharpe"], reverse=True)
    rank = next(i for i, (n, _) in enumerate(by, 1) if n == perf["shipped_variant"])
    check(rank == 1, f"shipped rank == 1 (is {rank})")

    print("=== S4: quarter structure consistent ===")
    for name, v in perf["variants"].items():
        check(len(v["quarters"]) == 4, f"{name} has 4 quarters")
        check(all("sharpe" in q and "max_dd" in q and "terminal" in q for q in v["quarters"]),
              f"{name} quarters have Sharpe+DD+terminal")

    print("=== S5: live schema exists (even if empty) ===")
    check("live" in perf, "live block present")
    check("dates" in perf.get("live", {}), "live.dates present")
    check("equity" in perf.get("live", {}), "live.equity present")

    print()
    if FAIL:
        print(f"FAIL: {len(FAIL)} test(s) failed — {FAIL}")
        sys.exit(1)
    print("ALL SIGNALS PASS — just weights confirmed (Prov 16:11).")


if __name__ == "__main__":
    main()
