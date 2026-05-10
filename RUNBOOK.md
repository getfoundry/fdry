# RUNBOOK

Post-launch operational runbook.

## Daily (automated via cron)
- 00:00 UTC: bot/src/main.ts fires, reads signal, applies weights
- 00:10 UTC: ledger/snapshot.ts fires, writes daily NAV snapshot
- Both report to Telegram on success/failure

## Weekly (manual, 15 min)
- Review ledger trend vs SOL-HODL baseline
- Rotate HOT_WALLET key (if desired)
- Verify healthcheck.io dead-man switch is green
- Commit week's ledger snapshots to GitHub

## Monthly
- Review fees collected (via Symmetry withdrawVaultFeesTx)
- Review Unbrowse monetization progress
- Review AUM + depositor count
- Telegram digest post to community

## Incident response

### Bot fails to fire
1. Check Railway logs
2. Check healthcheck.io
3. Check signal freshness
4. Manual rebalance: `tsx bot/src/main.ts --force`

### HOT_WALLET compromised
1. STOP: pause bot cron in Railway
2. Generate new hot wallet
3. CREATOR_WALLET signs manager-remove + manager-add per SPEC §4.1
4. Update HOT_WALLET_KEY env var
5. Resume bot

### Symmetry protocol exploit
1. STOP: disable frontend deposits
2. Monitor Symmetry community channels
3. If funds recoverable: use sellVaultTx to evacuate
4. If not: communicate transparently on Telegram

### Sharp ledger NAV drop
1. Verify it's real (pool-pricing glitch can show false NAV)
2. Check trades over last 24h for root cause
3. Post to Telegram within 4h with context

## Key rotation
- HOT_WALLET: quarterly + on-suspicion
- CREATOR_WALLET: only if compromised; requires SPEC §4.1 ceremony

## Contacts
- Telegram: [chat]
- Emergency: [operator's phone]
