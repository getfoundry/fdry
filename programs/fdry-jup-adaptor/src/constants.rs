use pinocchio_pubkey::declare_id_bytes;

/// Voltr vault program — the only program allowed to CPI into this adaptor.
/// (Verified via `anchor idl fetch` to have the `deposit_strategy` etc.
/// instructions that forward to adaptors.)
pub const VOLTR_VAULT_PROGRAM_ID: [u8; 32] =
    declare_id_bytes!("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8");

/// Jupiter v6 aggregator program. CPI target for all swaps.
pub const JUPITER_V6_PROGRAM_ID: [u8; 32] =
    declare_id_bytes!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/// Seed prefix for per-strategy state accounts (mirrors the pattern used by
/// Voltr's existing save-lending adaptor PDA derivation).
pub const STRATEGY_SEED: &[u8] = b"strategy";

/// Seed prefix for oracle_init_receipt accounts (empty — not used, kept as a
/// marker that this adaptor intentionally skips oracle receipts).
pub const ORACLE_INIT_RECEIPT_SEED: &[u8] = b"oracle_init_receipt";
