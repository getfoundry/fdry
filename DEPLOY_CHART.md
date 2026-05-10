# Deploy fdry/ledger/performance.html publicly (Lane H)

The chart is built. The chart is leak-safe (assert guard in
build_performance.py blocks CREATOR_KEY/HOT_WALLET_KEY/etc.).
The chart is self-contained (Chart.js CDN + inline data, falls
back gracefully if CDN fails).

What's missing: a public URL.

## Option A — GitHub Pages (recommended; free, simple)

```bash
cd ~/Projects/fdry
git checkout -b gh-pages
git rm -rf . && git checkout main -- ledger/performance.html ledger/performance.json
mkdir -p docs
mv ledger/performance.html docs/index.html
mv ledger/performance.json docs/performance.json
git add docs && git commit -m "publish chart to gh-pages"
git push origin gh-pages
# Then enable Pages in repo settings → branch: gh-pages, folder: /docs
```

Result URL: `https://<github-user>.github.io/fdry/`

## Option B — Cloudflare Pages

Connect the GitHub repo to Cloudflare Pages, set output dir to
`ledger/`. Custom domain optional.

## Option C — Static S3 / Vercel / Netlify

Same shape: any static-file host works. The HTML is self-contained.

## Daily refresh after deploy

```bash
# In a daily cron after the emit fires:
cd ~/Projects/fdry
./scripts/refresh_performance.sh   # rebuilds JSON + HTML
git add docs/performance.html docs/performance.json
git commit -m "daily perf refresh $(date -u +%F)"
git push origin gh-pages
```

Or set up a GitHub Action that runs the refresh script on schedule
and pushes commits.

## Pre-deploy checklist

- [ ] `python scripts/test_performance.py` passes (30/30 signals)
- [ ] `grep -i "creator\|wallet\|secret" ledger/performance.html` returns nothing
- [ ] Open `ledger/performance.html` locally — chart renders
- [ ] Confirm `updated_at` timestamp shows current

## Post-deploy verification

- [ ] URL loads
- [ ] Chart renders on mobile (test once)
- [ ] Sharpe table is readable on mobile
- [ ] No console errors in browser devtools

## Tier discipline

This is Lane H (Caesar — distribution). It does NOT touch any file
under `unify/` or `fdry/scripts/build_performance.py` — it only
copies the OUTPUT (`ledger/performance.html`) to a public location.
The strategy stays below the firmament.

## Action

Lewis runs the deploy commands once. After that, the GitHub Action
(if configured) keeps the chart current daily. Total founder time
to first public chart: ~30 minutes.
