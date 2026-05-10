# Legacy stFDRY — how to redeem

## tl;dr
You hold legacy stFDRY (mint `FwW1…Jeh7`)? The Foundry widget doesn't support it anymore. You can still redeem via Symmetry's own app.

## Steps
1. Open https://app.symmetry.fi
2. Connect the wallet that holds the legacy stFDRY.
3. Paste the legacy vault pubkey `EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc` into their vault lookup (or find it under your owned vaults).
4. Click "Sell vault" / "Withdraw" with the stFDRY amount you want to burn.
5. You'll receive SOL + USDC pro-rata (50/50 basket — the old vault's composition).
6. If you want to get back into the new FDRY-only vault: swap SOL/USDC → FDRY via Jupiter, then deposit FDRY at https://getfoundry.app.

## What you won't get
- A 1:1 swap into new stFDRY. The two vaults are unrelated contracts with different assets.
- Any support loss if Symmetry deprecates their UI (they haven't).

## Verify on-chain
- Legacy vault: solscan.io/account/EeDideZqgCwCuQFd4241ZsZRVBcSgVYf1rPStqzov9qc
- Legacy stFDRY: solscan.io/token/FwW1GEyvCx7q96wm4AYEGEUSFnNYozjxPwBaXWmcJeh7
- Symmetry program: solscan.io/account/BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate

## Why the migration
Short version: Symmetry needs a working oracle for every basket asset. FDRY couldn't seat an oracle on Raydium CPMM (4 attempts, LP burned). Moved to Voltr/Ranger whose vault is pure custody (1 stFDRY = 1 FDRY), no oracle needed.
