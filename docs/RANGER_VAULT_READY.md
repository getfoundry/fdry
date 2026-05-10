# Ranger/Voltr Vault — Ready for EXECUTE (pending multisig decision)

## TL;DR
Mainnet DRY_RUN simulation passes. All 11 VaultInitializationInput fields decoded from the on-chain event match config byte-for-byte. The single initialize_vault ix is sufficient — no follow-on adaptor config needed.

## What's ready
- `scripts/lib/rangerConfig.ts` — single-source config (56L)
- `scripts/createRangerFdryVault.ts` — DRY_RUN-default creation (212L)
- `scripts/testRangerFdryDeposit.ts` — FDRY-accept + USDC-reject probe (171L, SHAPE-ONLY)
- `scripts/testRangerFdryWithdraw.ts` — instant-withdraw round-trip (155L, SHAPE-ONLY)
- `@voltr/vault-sdk@1.0.21` installed
- 0.031 SOL cost; CREATOR has 10.22 SOL (325x margin)
- Ephemeral vault pubkey from DRY_RUN: CDWmn5ftyUpBFBsyoM9Pie2A1F1oAXJgnU6vaezkpGDx (regenerated each EXECUTE; actual pubkey = whatever new keypair the script generates at sign time)

## What's pending — in order of blocking
1. **SECURITY DECISION (blocking)**: admin = manager = single EOA CREATOR = drainable via add_adaptor -> deposit_strategy -> withdraw_strategy chain. No timelock, no per-field fee caps. Three options:
   - (a) Squads multisig (recommended) as admin AND manager before execute. ~1 hour setup.
   - (b) Execute with single EOA, rotate to multisig immediately via `accept_vault_admin`. Drain window exists — only safe if no user FDRY lands before rotation.
   - (c) Defer execute.
2. **B13 error-path patch** (in-flight): print tx sig + pubkey to stdout IMMEDIATELY after send, before confirm — so Lewis has manual-recovery info if confirm times out.
3. **B5 probe shape** (non-blocking): USDC CHECK 2 in testRangerFdryDeposit.ts is mis-shapen but stamped SHAPE-ONLY; doesn't gate anything. Fix-it-later.

## Command reference
- DRY_RUN (default): `./with-secrets pnpm tsx createRangerFdryVault.ts`
- EXECUTE (when multisig decided): `DRY_RUN=0 EXECUTE=1 ./with-secrets pnpm tsx createRangerFdryVault.ts`
- Idempotent; refuses if docs/ranger-vault.json already exists (unless FORCE=1 + I_KNOW_ORPHANING=1).
- Post-create tests (DRY_RUN): `./with-secrets pnpm tsx testRangerFdryDeposit.ts` and `testRangerFdryWithdraw.ts`.

## Config summary (from scripts/lib/rangerConfig.ts)
- asset = FDRY `2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL`
- max_cap = 1M FDRY (raisable via update_vault_config)
- all 6 fees = 0 bps
- withdrawal_waiting_period = 0 (instant-withdraw enabled)
- start_at_ts = 0 (live on init)
- name = "Foundry FDRY Staking Vault"
- description = "Stake FDRY to receive stFDRY. Chain-level FDRY-only ingress."

## References
- `~/Projects/fdry/.claude/workflow-loop.default.teachings.local.md` — full 9-day record (both cycles)
- `docs/FDRY_ONLY_HANDOFF.md` — prior cycle's decision brief (Vessel A/B/C/D); Vessel E (Ranger) is what we actually shipped
- `docs/SHIP_FDRY_ONLY.md` — prior ship-list (now superseded by this file for the FDRY-in path)
- Voltr program `vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8` mainnet
- Reference vault we inspected: `FP4p6Pfk93GtUMpuG1gCJzB11ZHqP48cMuKJcJnfYQRT` (928-byte Vault account, layout confirmed)

## Next command for Lewis
Set up Squads multisig OR say "single-EOA testing, I'll rotate within 1 hour of deposit." Then: execute. Then: migrate DepositWidget.tsx from @symmetry-hq/sdk to @voltr/vault-sdk (not done today — scoped out per Matthew 6:34).
