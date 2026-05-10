//! Deposit handler — swap base → foreign via Jupiter, credit strategy ATA.
//!
//! Voltr calls this from `deposit_strategy(amount, discriminator=1||.., args)`.
//! The 14 accounts Voltr passes (from IDL):
//!   0. manager                     [s]
//!   1. protocol                    [-]
//!   2. vault                       [w]
//!   3. strategy                    [-]   = foreign_mint
//!   4. adaptor_add_receipt         [-]
//!   5. strategy_init_receipt       [w]
//!   6. vault_asset_idle_auth       [w]   PDA signer for idle_ata transfers
//!   7. vault_strategy_auth         [w]   PDA signer for strategy_ata
//!   8. vault_asset_mint            [w]
//!   9. vault_lp_mint               [-]
//!  10. vault_asset_idle_ata        [w]   SOURCE: base asset
//!  11. vault_strategy_asset_ata    [w]   DEST: foreign asset
//!  12. asset_token_program         [-]
//!  13. adaptor_program             [-]   = crate::ID
//!
//! Then: remainingAccounts = Jupiter program ID + Jupiter route accounts.
//!
//! Flow:
//!   1. Parse SwapArgs (slippage_bps, jupiter_route) from `args`.
//!   2. Read pre-balance of vault_strategy_asset_ata (foreign) for slippage check.
//!   3. invoke_signed into Jupiter v6 with the route bytes, using
//!      vault_asset_idle_auth as signer (pays base) and delivery to
//!      vault_strategy_asset_ata (receives foreign).
//!   4. Read post-balance; assert it increased by at least
//!      (expected_out * (10_000 - slippage_bps) / 10_000).
//!
//! TODO before mainnet:
//!   - Signer seeds: Voltr vault signs vault_asset_idle_auth itself on the
//!     outer call, but the Jupiter CPI is OUR invoke. We need the idle_auth
//!     bump so we can invoke_signed. Bump is stored in Vault.asset.idle_ata_auth_bump
//!     (see /tmp/farm-program/crates/voltr-vault/src/state/vault.rs:82).
//!   - Expected-output math: Jupiter SDK provides pre-quote expected_out.
//!     Cleanest flow: manager pre-quotes, passes min_out in args.
//!   - Jupiter route bytes format: passed through verbatim from
//!     /swap/v1/swap-instructions via TS client. Confirmed working in
//!     voltr/src/adapters/jupiter-spot.ts.

use pinocchio::{
    account_info::AccountInfo,
    log::sol_log,
    program_error::ProgramError,
    ProgramResult,
};

use crate::{errors::AdaptorError, state::SwapArgs};

pub struct DepositSwap;

impl DepositSwap {
    pub fn execute(accounts: &[AccountInfo], args: &[u8]) -> ProgramResult {
        sol_log("fdry-jup-adaptor::deposit_swap");

        // Voltr prefixes the args with amount (u64 LE); slippage_bps + route follow.
        if args.len() < 8 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let amount_bytes: [u8; 8] = args[..8]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        let amount = u64::from_le_bytes(amount_bytes);
        if amount == 0 {
            return Err(AdaptorError::InvalidAmount.into());
        }

        let swap_args = SwapArgs::try_from_bytes(&args[8..])?;

        if accounts.len() < 14 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        // remainingAccounts (Jupiter route) appended after index 14
        let _route_accounts = &accounts[14..];
        if _route_accounts.is_empty() {
            return Err(AdaptorError::MissingJupiterRoute.into());
        }

        // TODO: record pre-balance of vault_strategy_asset_ata (accounts[11])
        // TODO: invoke_signed Jupiter v6 with swap_args.jupiter_route,
        //       seeds for vault_asset_idle_auth (accounts[6])
        // TODO: check post-balance >= min_out derived from slippage_bps
        //
        // Until those are wired, this handler is a no-op that will cause
        // Voltr's post-balance invariant to fail (vault_asset_idle_ata
        // balance unchanged) — which is correct defensive behavior.
        let _ = swap_args;

        sol_log("deposit_swap stub — CPI not yet implemented");
        Ok(())
    }
}
