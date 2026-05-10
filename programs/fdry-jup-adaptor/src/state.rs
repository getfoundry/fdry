//! Per-strategy state account layout.
//!
//! Voltr's spot adaptor convention (observed from on-chain scan) uses the
//! foreign mint itself as the strategy pubkey. No dedicated state account
//! beyond the `strategy_init_receipt` the vault writes.
//!
//! This adaptor follows the same convention — strategy_pubkey = foreign_mint.
//! Per-strategy config (slippage bps, min out, etc.) lives in `additional_args`
//! on each deposit/withdraw call, populated by the off-chain manager. No
//! additional on-chain state needed.

use pinocchio::program_error::ProgramError;

/// Payload deserialized from `additional_args` on a swap instruction.
/// Currently: 2 bytes slippage_bps, then Jupiter route bytes passed verbatim
/// through to the Jupiter CPI.
#[derive(Debug)]
pub struct SwapArgs<'a> {
    pub slippage_bps: u16,
    pub jupiter_route: &'a [u8],
}

impl<'a> SwapArgs<'a> {
    pub fn try_from_bytes(data: &'a [u8]) -> Result<Self, ProgramError> {
        if data.len() < 2 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let slippage_bps = u16::from_le_bytes([data[0], data[1]]);
        let jupiter_route = &data[2..];
        Ok(Self { slippage_bps, jupiter_route })
    }
}
