# RUNBOOK

Post-launch operational runbook for the Voltr/Jup follower.

## Daily (automated via launchd)
- triggers plist (every 60s): bridges imabettingman triggers into
  `~/.fdry/triggers.ndjson`.
- follower plist (paper mode by default): consumes triggers, writes
  `~/.fdry/paper-trades.ndjson`.
- resolver plist (hourly): walks paper trades and writes
  `~/.fdry/paper-results.ndjson` with realized outcomes.
- All three report to Telegram on failure.

## Weekly (manual, 15 min)
- Review paper-trade NO-hit rate vs imabettingman live numbers.
- Run `bash scripts/drift-sweep.sh` — must PASS.
- Re-run `scripts/research/r3-jup-no-side.py` to refresh
  `whitelist-hitrate.json`.
- Verify healthchecks.io dead-man switch is green.
- Commit week's ledger snapshots.

## Monthly
- Review fees collected / revenue routed (per
  [docs/REVENUE_POLICY.md](./docs/REVENUE_POLICY.md)).
- Review AUM + depositor count.
- Telegram digest post to community.

## Incident response

### Follower fails to fire
1. `launchctl list | grep fdry` — confirm plists loaded.
2. Tail the err log specified in each plist.
3. Check signal freshness: line count on `~/.fdry/triggers.ndjson`
   over the last hour.
4. Manual fire: `pnpm follower:smoke` from the voltr workspace.

### Manager keypair compromised
1. STOP: `launchctl unload` follower plist immediately.
2. Generate new manager keypair: `solana-keygen new --outfile ~/.fdry/manager.json.new`.
3. CREATOR signs admin-rotate per the Voltr/Ranger SDK.
4. Update `MANAGER_KEYPAIR_PATH` / `~/.fdry/env`; chmod 600.
5. Resume follower in `paper` mode for one weekend before re-enabling `live`.

### Jup Prediction API outage
1. Pause follower: `launchctl unload` follower plist.
2. Confirm open positions via `/orders/status/{orderPubkey}`.
3. If JupUSD locked mid-cycle: trigger kill-switch
   (`withdraw_swap`) to evacuate back to $FDRY.
4. Communicate transparently on Telegram.

### Sharp ledger NAV drop
1. Verify it's real (oracle glitch can show false NAV).
2. Check last 24h of resolved trades for cluster of losses.
3. Post to Telegram within 4h with context.

## Key rotation
- Manager keypair: quarterly + on-suspicion.
- Creator key: only if compromised; requires the upstream Voltr/Ranger
  admin-rotate ceremony.

## Contacts
- Telegram: [chat]
- Emergency: [operator's phone]
