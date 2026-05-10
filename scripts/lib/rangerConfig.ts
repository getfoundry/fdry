/**
 * rangerConfig.ts — single source of truth for the Voltr/Ranger FDRY vault init.
 *
 * All fields Lewis is likely to tweak live here. createRangerFdryVault.ts imports
 * these verbatim — do not inline config values there.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { VaultConfig } from "@voltr/vault-sdk";

// FDRY SPL mint (9 decimals)
export const VAULT_ASSET_MINT = new PublicKey(
  "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL",
);

// Voltr / Ranger vault program id (mainnet)
export const PROGRAM_ID = new PublicKey(
  "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
);

export const VAULT_NAME = "Foundry FDRY Staking Vault";
export const VAULT_DESCRIPTION =
  "Stake FDRY to receive stFDRY. Chain-level FDRY-only ingress.";

// Step-2 firmament values. All fees = 0, no degradation window, no waiting period.
// maxCap = 1e15 base units (FDRY has 9 decimals => 1_000_000 FDRY effective cap).
export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  maxCap: new BN("1000000000000000"),
  startAtTs: new BN(0),
  lockedProfitDegradationDuration: new BN(0),
  managerPerformanceFee: 0,
  adminPerformanceFee: 0,
  managerManagementFee: 0,
  adminManagementFee: 0,
  redemptionFee: 0,
  issuanceFee: 0,
  withdrawalWaitingPeriod: new BN(0),
};

/**
 * Resolve which SPL token program owns a given mint account.
 * Returns TOKEN_PROGRAM_ID for classic SPL mints, TOKEN_2022_PROGRAM_ID for Token-2022.
 */
export async function getAssetTokenProgram(
  conn: Connection,
  mint: PublicKey,
): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error(`mint account not found: ${mint.toBase58()}`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(
    `mint ${mint.toBase58()} owned by unexpected program ${info.owner.toBase58()}`,
  );
}
