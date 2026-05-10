/**
 * slimConfig.ts — config for the SLIM BARBELL Voltr vault.
 *
 * Separate from rangerConfig.ts (which creates the FDRY staking vault).
 * This config creates a USDC-denominated vault that executes the
 * SHIP_CANDIDATE_AA_SLIM strategy:
 *   - Sleeve 1 (33% NAV): SPYx via Jupiter-spot adapter
 *   - Sleeve 2 (67% NAV): Save USDC lending
 *   - Master rebal: monthly back to 33/67
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { VaultConfig } from "@voltr/vault-sdk";

// USDC mainnet mint (6 decimals)
export const SLIM_VAULT_ASSET_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

// Voltr / Ranger vault program id (mainnet) — same as FDRY vault
export const SLIM_PROGRAM_ID = new PublicKey(
  "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
);

export const SLIM_VAULT_NAME = "Foundry Slim Barbell";
export const SLIM_VAULT_DESCRIPTION =
  "USDC barbell 33/67 SPYx+Save";

// $100k USDC cap. Voltr's initialize_vault checks startAtTs must be in the
// future and maxCap non-trivial; mirroring the rangerConfig defaults that
// shipped successfully.
export const SLIM_DEFAULT_VAULT_CONFIG: VaultConfig = {
  maxCap: new BN("100000000000"),        // 100,000 USDC (1e5 * 1e6 base units)
  startAtTs: new BN(Math.floor(Date.now() / 1000)),  // now
  lockedProfitDegradationDuration: new BN(0),
  managerPerformanceFee: 0,
  adminPerformanceFee: 0,
  managerManagementFee: 0,
  adminManagementFee: 0,
  redemptionFee: 0,
  issuanceFee: 0,
  withdrawalWaitingPeriod: new BN(0),
};

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
