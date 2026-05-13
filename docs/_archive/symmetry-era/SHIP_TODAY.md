# SHIP TODAY — FDRY vault v1
*~3 hours total. Each step has a verify line. Stop if any verify fails.*

## Prereqs (5 min)
- [ ] ~120 SOL in CREATOR_WALLET (for $10k seed + fees)
- [ ] Helius paid RPC key
- [ ] Telegram bot (optional for alerts)

## Execute
- [ ] `pnpm install`
  - Verify: `pnpm -v` prints, no install errors
- [ ] `cp .env.example .env` → fill CREATOR_KEY, HOT_WALLET_KEY, SOLANA_RPC_URL
  - Verify: `grep -c REPLACE .env` shows 0
- [ ] `tsx scripts/createVault.ts --dry-run` → shows 6-token plan
  - Verify: printed weights sum to 10000
- [ ] `tsx scripts/createVault.ts` → creates vault, writes docs/vault.json
  - Verify: `cat docs/vault.json` shows vault_pubkey
  - Verify: solscan.io/account/<pubkey> shows account on-chain
  - Verify: app.symmetry.fi/vaults/<pubkey> loads (404 → submit curation)
- [ ] `tsx scripts/seed.ts --dry-run --amount-usd=10000` → shows ~117 SOL
  - Verify: dry-run prints intended deposit + token splits
- [ ] `tsx scripts/seed.ts --amount-usd=10000` → deposits
  - Verify: `tail -1 ledger/deposits.jsonl` shows entry with tx signature
- [ ] `tsx ledger/snapshot.ts` → writes ledger/today.json + latest.json
  - Verify: `cat ledger/latest.json | jq .nav_sol` shows ~117
- [ ] `git init && git add . && git commit -m "vault v1"`
  - Verify: `git check-ignore .env` prints .env
- [ ] Push to local github remote, enable Pages on /ledger
  - Verify: `curl <pages-url>/latest.json` returns JSON
- [ ] Copy POST 1 from docs/TELEGRAM_DRAFTS.md, fill links, publish
  - Verify: post live, solscan + symmetry + pages links resolve

## Do NOT do today
- Deploy bot cron (wait 24h, verify first manual rebalance, then automate)
- Open external deposits (14-day own-capital window)
- Announce bible-EBM alpha or LLM service claims (post-2 ships tomorrow)

## If something breaks
- Stop. Do not proceed to next step.
- See docs/FAILURE_MODES.md for response
- If catastrophic: funds are on-chain, recoverable via sellVaultTx
