use pinocchio::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone, PartialEq)]
pub enum AdaptorError {
    #[error("Caller is not the Voltr vault program")]
    UnauthorizedCaller,

    #[error("Invalid amount (zero or overflow)")]
    InvalidAmount,

    #[error("Jupiter route execution did not produce expected output")]
    SlippageExceeded,

    #[error("Missing remainingAccounts for Jupiter route")]
    MissingJupiterRoute,

    #[error("Foreign mint mismatch with strategy pubkey")]
    ForeignMintMismatch,

    #[error("Post-balance invariant violated")]
    PostBalanceViolation,
}

impl From<AdaptorError> for ProgramError {
    fn from(e: AdaptorError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
