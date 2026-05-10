# Paper-trade weekend ops

This is the M2 runbook. Three launchd agents run together; everything writes
to `~/.fdry/` and `~/Library/Logs/`.

## Agents

| Agent | What | Plist |
|---|---|---|
| `com.bridge-source.triggers` | scans upstream-market every 60s via `triggers_emit.py`, appends to `~/.fdry/triggers.ndjson` | `bridge-source/harness/com.bridge-source.triggers.plist` |
| `com.fdry.follower` | tails the trigger file, runs `runFollower --dry-run`, appends every `would_sign` to `~/.fdry/paper-trades.ndjson` | `voltr/scripts/com.fdry.follower.plist` |
| `com.fdry.follower.resolve` | every hour, walks `paper-trades.ndjson`, fetches market state from Jup, appends to `~/.fdry/paper-results.ndjson` | `voltr/scripts/com.fdry.follower.resolve.plist` |

All KeepAlive=true (except the resolver which is StartInterval=3600).
ThrottleInterval=30 limits relaunch storms.

## One-time install

```bash
cp ~/Projects/bridge-source/harness/com.bridge-source.triggers.plist \
   ~/Library/LaunchAgents/
cp ~/Projects/fdry/voltr/scripts/com.fdry.follower.plist \
   ~/Library/LaunchAgents/
cp ~/Projects/fdry/voltr/scripts/com.fdry.follower.resolve.plist \
   ~/Library/LaunchAgents/
```

## Start / stop

```bash
# Start all three (paper-trade weekend kickoff — Friday morning)
launchctl load ~/Library/LaunchAgents/com.bridge-source.triggers.plist
launchctl load ~/Library/LaunchAgents/com.fdry.follower.plist
launchctl load ~/Library/LaunchAgents/com.fdry.follower.resolve.plist

# Stop all three (Sunday EOD or anytime)
launchctl unload ~/Library/LaunchAgents/com.fdry.follower.resolve.plist
launchctl unload ~/Library/LaunchAgents/com.fdry.follower.plist
launchctl unload ~/Library/LaunchAgents/com.bridge-source.triggers.plist
```

## Status check

```bash
# Are they running?
launchctl list | grep -E 'bridge-source|fdry'

# Tail trigger emissions (last 50 lines)
zigread ~/.fdry/triggers.ndjson --lines 1-50

# Tail paper trades (every would_sign decision)
zigread ~/.fdry/paper-trades.ndjson --lines 1-50

# Tail resolution outcomes (won/lost/pending per trade)
zigread ~/.fdry/paper-results.ndjson --lines 1-50

# Live logs
zigread ~/Library/Logs/bridge-source.triggers.log --lines 1-100
zigread ~/Library/Logs/fdry.follower.log --lines 1-100
zigread ~/Library/Logs/fdry.resolve.log --lines 1-100
```

## Kill switch (operator emergency stop)

```bash
# Stop the follower from processing further triggers
touch /tmp/fdry-follower.halt

# OR via env (requires restart — slower)
launchctl setenv FDRY_FOLLOWER_HALT 1 && \
  launchctl unload ~/Library/LaunchAgents/com.fdry.follower.plist && \
  launchctl load   ~/Library/LaunchAgents/com.fdry.follower.plist

# Resume
rm -f /tmp/fdry-follower.halt
```

## Manual one-shot resolve (off the hourly schedule)

```bash
cd ~/Projects/fdry/voltr && pnpm follower:resolve
```

## Sunday EOD GO/NO-GO check

```bash
# Count triggers fired
wc -l ~/.fdry/triggers.ndjson

# Count paper trades booked
wc -l ~/.fdry/paper-trades.ndjson

# Hit rate from resolved trades
python3 -c '
import json, sys
won = lost = pending = err = 0
with open("~/.fdry/paper-results.ndjson") as f:
    for line in f:
        r = json.loads(line)
        if r["status"] == "won": won += 1
        elif r["status"] == "lost": lost += 1
        elif r["status"] == "pending": pending += 1
        else: err += 1
total = won + lost
print(f"won={won} lost={lost} pending={pending} err={err}")
print(f"hit_rate = {won/total:.3f}" if total else "hit_rate = N/A (no resolved trades)")
'
```

GO criteria (per NORTHSTAR Phase D):
- ≥10 triggers fired across the weekend
- ≥30% had a Jup market match (would_sign / triggers ratio)
- NO-hit rate on resolved paper trades ≥75%
- Zero unhandled exceptions in `~/Library/Logs/fdry.follower.err`
