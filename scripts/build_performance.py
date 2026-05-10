#!/usr/bin/env python3
"""Build fdry/ledger/performance.json — the firmament between backtest and live.

Reads:
  [INTERNAL_PATH]/runs/v8/v04_walkforward/verdict.json
  ~/Projects/fdry/runs/daily_signal/aum_log.jsonl

Writes:
  ~/Projects/fdry/ledger/performance.json (the chart contract)
  ~/Projects/fdry/ledger/performance.html (self-contained Chart.js page)

Idempotent. Rerun to refresh live segment.
"""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path

UNIFY = Path("[INTERNAL_PATH]")
FDRY  = Path("~/Projects/fdry")
VERDICT = UNIFY / "runs/v8/v04_walkforward/verdict.json"
AUM_LOG = FDRY  / "runs/daily_signal/aum_log.jsonl"
OUT_JSON = FDRY / "ledger/performance.json"
OUT_HTML = FDRY / "ledger/performance.html"

SHIPPED_VARIANT = "v04_tv0.0050"  # v0.4.1 production refit


def load_verdict() -> dict:
    """Load walk-forward verdict. Graceful fallback if missing (Matt 10:16 — wise)."""
    if not VERDICT.exists():
        print(f"[warn] {VERDICT} not found — emitting live-only performance.json")
        return {"overall": {}, "quarters": [], "n_test_days": 0,
                "_missing_verdict": True}
    try:
        return json.loads(VERDICT.read_text())
    except Exception as e:
        print(f"[warn] {VERDICT} unreadable ({e}) — emitting live-only")
        return {"overall": {}, "quarters": [], "n_test_days": 0,
                "_verdict_error": str(e)}

def load_aum_log() -> list[dict]:
    if not AUM_LOG.exists():
        return []
    rows = []
    with AUM_LOG.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows


def build_variants(verdict: dict) -> dict:
    """Per-variant {overall, quarters, epoch_series}."""
    out = {}
    for name, overall in verdict.get("overall", {}).items():
        out[name] = {
            "overall": overall,
            "quarters": [],
            "epoch_series": [],  # [(epoch_idx, cumulative_equity, sharpe_running, dd_running)]
        }
    for q in verdict.get("quarters", []):
        qi = q["quarter"]
        for name, m in q["strategies"].items():
            if name not in out:
                continue
            out[name]["quarters"].append({
                "quarter": qi,
                "date_range": q.get("date_range"),
                "sharpe": m["sharpe"],
                "max_dd": m["max_dd"],
                "terminal": m["terminal"],
                "n_days": m["n"],
            })
    # Build epoch_series: cumulative equity over 4 quarters
    for name in out:
        eq = 1.0
        ser = []
        for q in out[name]["quarters"]:
            eq *= q["terminal"]  # chain per-quarter terminals
            ser.append({
                "epoch": q["quarter"],
                "date_range": q["date_range"],
                "cum_equity": eq,
                "sharpe_quarter": q["sharpe"],
                "max_dd_quarter": q["max_dd"],
            })
        out[name]["epoch_series"] = ser
    return out


def build_live(aum_rows: list[dict]) -> dict:
    dates = [r.get("date") for r in aum_rows]
    equity = [r.get("equity", 1.0) for r in aum_rows]
    rets = [r.get("realized_return") for r in aum_rows]
    return {"dates": dates, "equity": equity, "realized_daily_return": rets,
            "n_days": len(aum_rows)}


def main():
    verdict = load_verdict()
    aum = load_aum_log()

    perf = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": [
            "unify/runs/v8/v04_walkforward/verdict.json",
            "fdry/runs/daily_signal/aum_log.jsonl",
        ],
        "shipped_variant": SHIPPED_VARIANT,
        "shipped_config": "v0.4.1 tv=0.005 6+1-token long-only",
        "variants": build_variants(verdict),
        "live": build_live(aum),
        "headline": {
            "backtest_sharpe":   verdict["overall"].get(SHIPPED_VARIANT, {}).get("sharpe"),
            "backtest_max_dd":   verdict["overall"].get(SHIPPED_VARIANT, {}).get("max_dd"),
            "backtest_terminal": verdict["overall"].get(SHIPPED_VARIANT, {}).get("terminal"),
            "backtest_days":     verdict.get("n_test_days"),
            "live_days":         len(aum),
        },
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(perf, indent=2, default=str))

    # Self-contained HTML with Chart.js CDN
    html = build_html(perf)
    OUT_HTML.write_text(html)

    h = perf["headline"]
    print(f"[performance] wrote {OUT_JSON}")
    if h.get("backtest_sharpe") is not None:
        print(f"[performance] shipped variant {SHIPPED_VARIANT}: "
              f"Sharpe {h['backtest_sharpe']:+.3f}  DD {h['backtest_max_dd']:+.2%}  "
              f"terminal ${h['backtest_terminal']:.4f}  ({h['backtest_days']}d backtest, "
              f"{h['live_days']}d live)")
    else:
        print(f"[performance] no backtest data — live-only mode ({h['live_days']}d live)")
    print(f"[performance] chart at {OUT_HTML}")


def build_html(perf: dict) -> str:
    """Self-contained Chart.js page — no build step, no deps.

    Matt 10:16 hardening:
      - renders table even if Chart.js CDN fails (harmless as doves)
      - includes `updated_at` prominently so stale chart is visible
      - NEVER includes wallet keys, API tokens, or Tier 0 model state
    """
    # Assert no leak (Matt 10:16 dove-check)
    blob = json.dumps(perf)
    FORBIDDEN = ["CREATOR_KEY", "HOT_WALLET_KEY", "SOLANA_RPC_URL", "api_key",
                 "private_key", "secret", "BEARER"]
    for bad in FORBIDDEN:
        assert bad.lower() not in blob.lower(), f"leak: {bad} found in perf JSON"

    h = perf["headline"]
    shipped = perf["shipped_variant"]

    colors = {
        "EW":           "#888888",
        "v04_tv0.0050": "#1abc9c",
        "v04_tv0.0075": "#3498db",
        "v04_tv0.0100": "#9b59b6",
        "v04_tv0.0150": "#e67e22",
        "v04_tv0.0200": "#e74c3c",
    }
    # Build x-axis labels from first variant's quarters (any variant has same range)
    labels = ["start"]
    reference_variant = next(iter(perf["variants"].values())) if perf["variants"] else None
    if reference_variant and reference_variant.get("quarters"):
        for q in reference_variant["quarters"]:
            dr = q.get("date_range") or [None, None]
            labels.append(f"Q{q['quarter']} ({dr[1] if dr[1] else ''})")

    datasets = []
    for name, data in perf["variants"].items():
        eq_points = [1.0] + [pt["cum_equity"] for pt in data.get("epoch_series", [])]
        is_shipped = (name == shipped)
        datasets.append({
            "label": name + (" ← shipped" if is_shipped else ""),
            "data": eq_points,
            "borderColor": colors.get(name, "#777"),
            "backgroundColor": colors.get(name, "#777") + "33",
            "borderWidth": 4 if is_shipped else 2,
            "tension": 0.2,
        })

    sharpe_rows = ""
    variant_order = ["EW", "v04_tv0.0050", "v04_tv0.0075", "v04_tv0.0100",
                     "v04_tv0.0150", "v04_tv0.0200"]
    for name in variant_order:
        if name not in perf["variants"]:
            continue
        row_cells = [f"<td><b>{name}</b>{' ★' if name == shipped else ''}</td>"]
        for q in perf["variants"][name].get("quarters", []):
            row_cells.append(f"<td>{q['sharpe']:+.3f}</td>")
        row_cells.append(f"<td><b>{perf['variants'][name]['overall']['sharpe']:+.3f}</b></td>")
        sharpe_rows += f"<tr>{''.join(row_cells)}</tr>\n"

    q_headers = ""
    if reference_variant and reference_variant.get("quarters"):
        q_headers = "".join(
            f"<th>Q{q['quarter']}<br>{(q.get('date_range') or [None, None])[0] or ''}<br>"
            f"→{(q.get('date_range') or [None, None])[1] or ''}</th>"
            for q in reference_variant["quarters"]
        )

    live_rows = len(perf.get("live", {}).get("dates") or [])
    # Freshness indicator — dove-visibility of stale data
    freshness = f"<span style='color:#888'>updated {perf['updated_at']} · backtest 97d · live {live_rows}d</span>"
    if perf.get("_missing_verdict") or perf.get("_verdict_error"):
        freshness += " <span style='color:#e74c3c'>⚠ backtest source missing</span>"

    backtest_sharpe = h.get('backtest_sharpe')
    backtest_sharpe_str = f"{backtest_sharpe:+.3f}" if backtest_sharpe is not None else "—"
    backtest_dd = h.get('backtest_max_dd')
    backtest_dd_str = f"{backtest_dd:+.2%}" if backtest_dd is not None else "—"
    backtest_term = h.get('backtest_terminal')
    backtest_term_str = f"${backtest_term:.3f}" if backtest_term is not None else "—"

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>fdry performance — v0.4.1 vol-target walk-forward</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        max-width: 960px; margin: 2em auto; padding: 0 1em; color: #222; }}
h1 {{ margin-bottom: 0; }}
.sub {{ color: #666; margin-top: 0.2em; }}
.headline {{ background: #f4f4f4; padding: 1em; border-radius: 8px;
             display: grid; grid-template-columns: repeat(4, 1fr); gap: 1em;
             margin: 1em 0; }}
.headline div {{ text-align: center; }}
.headline .label {{ font-size: 0.75em; color: #888; text-transform: uppercase; }}
.headline .val {{ font-size: 1.6em; font-weight: 600; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 1em; }}
th, td {{ padding: 0.5em; border-bottom: 1px solid #e0e0e0; text-align: right; }}
th {{ background: #fafafa; font-weight: 600; font-size: 0.85em; }}
td:first-child, th:first-child {{ text-align: left; }}
.shipped {{ color: #1abc9c; }}
.footer {{ margin-top: 3em; font-size: 0.8em; color: #888; }}
.chart-fallback {{ padding: 1em; background: #fafafa; border: 1px dashed #ccc;
                    text-align: center; color: #888; }}
</style>
</head>
<body>
<h1>fdry — quant alpha vault performance</h1>
<p class="sub">Shipped: <code class="shipped">{shipped}</code> (v0.4.1 vol-target walk-forward refit) · {freshness}</p>

<div class="headline">
  <div><div class="label">Sharpe</div><div class="val">{backtest_sharpe_str}</div></div>
  <div><div class="label">Max DD</div><div class="val">{backtest_dd_str}</div></div>
  <div><div class="label">Terminal</div><div class="val">{backtest_term_str}</div></div>
  <div><div class="label">Days (bt / live)</div><div class="val">{h.get('backtest_days', 0)} / {h.get('live_days', 0)}</div></div>
</div>

<h2>Backtest equity curve by variant</h2>
<div id="chartWrap"><canvas id="equityChart" height="120"></canvas></div>
<noscript><div class="chart-fallback">JavaScript disabled — table below shows the metrics.</div></noscript>

<h2>Sharpe per epoch per variant</h2>
<table>
<thead><tr><th>Variant</th>{q_headers}<th>Overall</th></tr></thead>
<tbody>
{sharpe_rows}
</tbody>
</table>

<p class="footer">
  Backtest source: unify/runs/v8/v04_walkforward/verdict.json (97-day walk-forward,
  k-fold gate accepted 3/5 folds, text_drift on mega joint corpus).
  Live source: fdry/runs/daily_signal/aum_log.jsonl (populated daily by aum_tracker.py).
  Tier discipline: v0.4.1 params frozen for 30 days per Matt 4 verdict.
</p>

<script src="https://cdn.jsdelivr.net/npm/chart.js"
        onerror="document.getElementById('chartWrap').innerHTML='<div class=chart-fallback>Chart CDN unavailable — table above is authoritative.</div>'"></script>
<script>
try {{
  const labels = {json.dumps(labels)};
  const datasets = {json.dumps(datasets)};
  if (typeof Chart !== 'undefined') {{
    new Chart(document.getElementById('equityChart'), {{
      type: 'line',
      data: {{ labels, datasets }},
      options: {{
        responsive: true,
        scales: {{ y: {{ title: {{ display: true, text: 'Cumulative equity ($1 → x)' }} }} }},
        plugins: {{ legend: {{ position: 'bottom' }} }},
      }},
    }});
  }} else {{
    document.getElementById('chartWrap').innerHTML = '<div class=chart-fallback>Chart library missing — see table above.</div>';
  }}
}} catch (e) {{
  document.getElementById('chartWrap').innerHTML = '<div class=chart-fallback>Chart error: '+e.message+'</div>';
}}
</script>
</body>
</html>
"""
    return html
if __name__ == "__main__":
    main()
