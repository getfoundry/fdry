//! Withdraw handler — swap foreign → base via Jupiter, return to idle ATA.
//!
//! Voltr calls this from `withdraw_strategy(amount, discriminator=2||.., args)`.
//! Same 14 accounts as deposit_swap, plus Jupiter route in remainingAccounts.
//! Direction reversed: SOURCE=vault_strategy_asset_ata (foreign),
//! DEST=vault_asset_idle_ata (base).
//!
//! `amount` is the base-asset amount the vault wants BACK. We compute the
//! foreign-side input required via a pre-quote on the off-chain manager,
//! pass it in the Jupiter route bytes.

use pinocchio::{
    account_info::AccountInfo,
    log::sol_log,
    program_error::ProgramError,
    ProgramResult,
};

use crate::{errors::AdaptorError, state::SwapArgs};

pub struct WithdrawSwap;

impl WithdrawSwap {
    pub fn execute(accounts: &[AccountInfo], args: &[u8]) -> ProgramResult {
        sol_log("fdry-jup-adaptor::withdraw_swap");

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
        let _route_accounts = &accounts[14..];
        if _route_accounts.is_empty() {
            return Err(AdaptorError::MissingJupiterRoute.into());
        }

        // TODO: mirror deposit_swap — invoke_signed Jupiter, check post-balance
        // of vault_asset_idle_ata increased by >= amount.
        let _ = swap_args;

        sol_log("withdraw_swap stub — CPI not yet implemented");
        Ok(())
    }
}
