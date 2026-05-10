use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

// Placeholder program id — replace with output of `anchor keys sync`
// after `anchor keys gen` creates target/deploy/fdry_gate-keypair.json.
declare_id!("Fdry1111111111111111111111111111111111111111");

// FDRY mint — the only contribution asset this gate accepts.
pub const FDRY_MINT: Pubkey = pubkey!("2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL");

// TODO: Symmetry on-chain program id per SDK constants.ts:7 —
// VAULTS_V3_PROGRAM_ID = BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate.
// Wire this into CPI call once account layout for depositTokensIx is mapped.

#[program]
pub mod fdry_gate {
    use super::*;

    pub fn deposit_fdry(ctx: Context<DepositFdry>, amount: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.user_fdry_ata.mint,
            FDRY_MINT,
            GateError::NonFdryMint
        );

        emit!(FdryDeposit {
            user: ctx.accounts.user.key(),
            amount,
        });

        // TODO: CPI into Symmetry depositTokensIx with ctx.accounts.symmetry_* and signer seeds
        Ok(())
    }

    pub fn withdraw(_ctx: Context<Withdraw>, _shares: u64) -> Result<()> {
        // TODO: CPI into Symmetry withdraw
        Ok(())
    }
}

#[derive(Accounts)]
pub struct DepositFdry<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = user_fdry_ata.mint == FDRY_MINT @ GateError::NonFdryMint
    )]
    pub user_fdry_ata: Account<'info, TokenAccount>,

    /// CHECK: Symmetry vault, validated by CPI
    pub symmetry_vault: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// CHECK: Symmetry vault, validated by CPI
    pub symmetry_vault: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

#[event]
pub struct FdryDeposit {
    pub user: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum GateError {
    #[msg("only FDRY mint may be contributed")]
    NonFdryMint,
}

// NOTE: requires workspace context to cargo-check; tests are standalone-shaped for future CI wiring
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fdry_mint_is_canonical() {
        assert_eq!(
            FDRY_MINT.to_string(),
            "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL"
        );
    }

    #[test]
    fn error_code_non_fdry_mint_message() {
        let err: anchor_lang::error::Error = GateError::NonFdryMint.into();
        let msg = err.to_string();
        assert!(
            msg.contains("only FDRY mint"),
            "expected error message to contain 'only FDRY mint', got: {msg}"
        );
    }

    #[test]
    fn fdry_mint_rejects_decoy() {
        // USDC decoy — Luke 15:4, the sheep that must be found.
        let usdc: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        assert_ne!(FDRY_MINT, usdc);
    }
}
