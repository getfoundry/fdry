//! fdry-jup-adaptor — Voltr adaptor that routes swaps through Jupiter without
//! Pyth oracle verification.
//!
//! The existing Voltr jupiter-spot adaptor (`EW35URAx…`) hardcodes a Pyth Pull
//! v2 oracle check. That blocks any foreign mint without a sponsored Pyth feed
//! — including all ~100 Backed Finance xStocks. This adaptor:
//!
//!   - accepts the same CPI shape from the Voltr vault (`deposit_strategy`,
//!     `withdraw_strategy`, `initialize_strategy`)
//!   - trusts Jupiter's `slippageBps` route guard instead of Pyth
//!   - works for any Jupiter-routeable mint
//!
//! **CPI from Voltr (`vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8`):**
//! Voltr's `deposit_strategy(amount, instruction_discriminator, additional_args)`
//! forwards `instruction_discriminator || amount(u64) || additional_args(bytes)`
//! to the adaptor program, alongside 14 fixed accounts and any extra
//! `remainingAccounts` (our Jupiter route) the caller passes.
//!
//! **Instruction discriminators (8 bytes, first byte dispatched):**
//!   0 → initialize_strategy
//!   1 → deposit_swap   (base → foreign via Jupiter)
//!   2 → withdraw_swap  (foreign → base via Jupiter)
//!
//! **Gaps that need devnet verification before mainnet custody:**
//!   - Whether Voltr passes signer seeds for `vault_strategy_auth` in the CPI
//!     (we need to invoke_signed into Jupiter using that PDA)
//!   - What post-balance invariants the vault checks (does it validate
//!     idle_ata delta matches `amount`?)
//!   - Full layout of `strategy_init_receipt` and `adaptor_add_receipt`

#![cfg_attr(target_arch = "bpf", no_std)]

use pinocchio::{
    account_info::AccountInfo,
    no_allocator,
    program_entrypoint,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_pubkey::declare_id;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Program ID — matches target/deploy/fdry_jup_adaptor-keypair.json.
// Generated 2026-04-23 for devnet testing.
// Devnet redeploy 2026-05-04: original mainnet-intended ID J26Xu3Nz... had
// stale upgrade authority on devnet. New devnet ID below; mainnet deploy
// post-audit will get its own keypair + declare_id update.
declare_id!("HY7CqsU3B1yxPDifLwTH9xQp1zn1uTBA9c12JACP2cx9");

program_entrypoint!(process_instruction);
no_allocator!();
// nostd_panic_handler! omitted — thiserror pulls in std so std's panic handler is used.

fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Voltr forwards `instruction_discriminator` (8 bytes) + amount (u64) +
    // additional_args (Vec<u8>). We dispatch on the first byte of the
    // discriminator for compactness — remaining 7 bytes can encode version
    // or adaptor-specific flags later.
    let (discriminator, rest) = instruction_data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match discriminator {
        0 => InitializeStrategy::execute(accounts, rest),
        1 => DepositSwap::execute(accounts, rest),
        2 => WithdrawSwap::execute(accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
