//! Strategy init handler.
//!
//! Voltr calls this from `initialize_strategy` instruction. Receives 10
//! accounts from the vault program:
//!   0. payer                       [w,s]
//!   1. manager                     [s]
//!   2. protocol                    [-]
//!   3. vault                       [-]
//!   4. strategy                    [-]   = foreign_mint (spot convention)
//!   5. adaptor_add_receipt         [-]
//!   6. strategy_init_receipt       [w]
//!   7. vault_strategy_auth         [w]   PDA, owned by Voltr vault
//!   8. adaptor_program             [-]   = crate::ID
//!   9. system_program              [-]
//!
//! TODO before mainnet:
//!   - Verify caller is Voltr vault program (accounts[?].owner == VAULT_PROGRAM_ID)
//!   - Decide: does this adaptor create any per-strategy state accounts? The
//!     existing spot adaptor creates oracle_init_receipt PDAs — we skip those.
//!     If Voltr's strategy_init_receipt carries adaptor-specific data, we may
//!     need to write it here.

use pinocchio::{
    account_info::AccountInfo,
    log::sol_log,
    program_error::ProgramError,
    ProgramResult,
};

pub struct InitializeStrategy;

impl InitializeStrategy {
    pub fn execute(accounts: &[AccountInfo], _args: &[u8]) -> ProgramResult {
        sol_log("fdry-jup-adaptor::initialize_strategy");

        if accounts.len() < 10 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        // STUB: no per-strategy state to initialize. Strategy pubkey IS the
        // foreign mint (same convention as Voltr's spot adaptor). Voltr vault
        // will have already written strategy_init_receipt before invoking us.

        // TODO: verify vault_strategy_auth PDA derivation matches
        //   [b"vault_strategy_auth", vault.key(), strategy.key()]
        //   under VOLTR_VAULT_PROGRAM_ID.

        Ok(())
    }
}
