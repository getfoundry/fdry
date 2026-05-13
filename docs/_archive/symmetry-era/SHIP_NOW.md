# SHIP_NOW — FDRY Treasury Vault v1 Launch

## Preconditions (5 min)
1. Hardware wallet ready (Ledger/Solflare) for CREATOR_WALLET
2. ~120 SOL in CREATOR_WALLET (~$10k + fees)
3. Helius or Triton paid RPC key
4. (Optional) Telegram bot + chat_id for alerts

## Step 1-2: Install + .env (10 min)
```
cd ~/Projects/fdry
pnpm install
cp .env.example .env
# Fill CREATOR_KEY, HOT_WALLET_KEY (generate new via `solana-keygen new`), SOLANA_RPC_URL
```

## Step 3: Create hot wallet (5 min)
```
solana-keygen new -o ~/.config/solana/fdry-hot.json
# Copy base58 secret to HOT_WALLET_KEY env var
# Fund with 0.5 SOL for tx fees
```

## Step 4: Dry-run vault creation (2 min)
```
tsx scripts/createVault.ts --dry-run
# Verify: 6-token universe, weights sum to 10000, no errors
```

## Step 5: Create vault on mainnet (3 min)
```
tsx scripts/createVault.ts
# Writes docs/vault.json with VAULT_PUBKEY
# Copy VAULT_PUBKEY into .env
```
Verify: `solana account <VAULT_PUBKEY>` or open https://solscan.io/account/<VAULT_PUBKEY> — account must exist on-chain.

## Step 5.5: Verify vault appears on Symmetry UI
Open https://app.symmetry.fi/vaults/<VAULT_PUBKEY> in browser
- If vault page loads with your metadata: verified ✓
- If 404: vault may need curation submission — visit app.symmetry.fi and search for it manually
- Also confirm Solscan: https://solscan.io/account/<VAULT_PUBKEY> shows the account
- Screenshot both for the Telegram launch post

## Step 6: Seed with $10k SOL (3 min)
```
tsx scripts/seed.ts --dry-run --amount-usd=10000
tsx scripts/seed.ts --amount-usd=10000
# Check ledger/deposits.jsonl for the record
```
Verify: `cat ledger/latest.json` shows TVL reflecting the deposit (or deposits.jsonl has the record).

## Step 7: First ledger snapshot (1 min)
```
tsx ledger/snapshot.ts
# Writes ledger/YYYY-MM-DD.json + latest.json + history.json
```

## Step 8: Publish ledger to GitHub Pages (5 min)
```
cd ~/Projects/fdry
git init
git add .
git commit -m "vault v1 launch"
# Create GitHub repo, push, enable Pages from /ledger
```
Verify: open the GitHub Pages URL (e.g. https://<user>.github.io/<repo>/latest.json) in an incognito window — JSON must load publicly.

## Step 9: Deploy bot (skip if launching treasury-only today)
```
# Install railway CLI
npm i -g @railway/cli
railway login
railway init
railway variables set CREATOR_KEY=... HOT_WALLET_KEY=... VAULT_PUBKEY=... SOLANA_RPC_URL=...
railway up
# Verify cron schedule in railway dashboard
```

## Step 10: Telegram announcement
Copy POST 1 from docs/TELEGRAM_DRAFTS.md, fill in:
- [solscan link] = https://solscan.io/account/<VAULT_PUBKEY>
- [amount] = 10000 USDC equivalent in SOL
- Publish.

## Rollback if needed
- If vault creation failed mid-step: call withdrawVaultFeesTx to recover any committed SOL
- If seed failed: check ledger/deposits.jsonl for partial state
- CREATOR_KEY can transfer role if compromised
