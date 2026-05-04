/**
 * voltrConfig.ts — single source of truth for the frontend's Voltr/Ranger vault addresses.
 *
 * Mirrors scripts/lib/rangerConfig.ts in style. All frontend pages and components
 * should import from this file rather than hardcoding base58 strings.
 */
import { PublicKey } from "@solana/web3.js";

// Voltr vault account (mainnet, live + verified)
export const VAULT_PUBKEY = new PublicKey(
  "Bpr49sQXsxwNXNMRWS2v3tTBGWu2QgZtdA83BX77xBX1",
);

// stFDRY-v2 LP mint
export const LP_MINT = new PublicKey(
  "G8e9i9RADPsxJtiCJsGC4tSx2kgCkGbEkdn7aajt2nqW",
);

// Underlying asset: FDRY SPL mint (9 decimals)
export const VAULT_ASSET_MINT = new PublicKey(
  "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL",
);

// Voltr program id (mainnet)
export const VOLTR_PROGRAM_ID = new PublicKey(
  "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
);

// Admin / manager wallet
export const CREATOR_WALLET = new PublicKey(
  "8n7QzgDuEiQUxCXNb7VSiq3fenA2UjeMTUhoiPK7QGR8",
);

export const FDRY_DECIMALS = 9;

// Convenience string constants for components that render/link to Solscan.
export const VAULT_PUBKEY_STR = "Bpr49sQXsxwNXNMRWS2v3tTBGWu2QgZtdA83BX77xBX1";
export const LP_MINT_STR = "G8e9i9RADPsxJtiCJsGC4tSx2kgCkGbEkdn7aajt2nqW";
export const VAULT_ASSET_MINT_STR = "2ZiSPGncrkwWa6GBZB4EDtsfq7HEWwkwsPFzEXieXjNL";
export const VOLTR_PROGRAM_ID_STR = "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8";
export const CREATOR_WALLET_STR = "8n7QzgDuEiQUxCXNb7VSiq3fenA2UjeMTUhoiPK7QGR8";
