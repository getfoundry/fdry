/**
 * vaults.ts — multi-vault registry & on-chain metadata.
 *
 * Frontend supports a list of Voltr vaults provided via
 * VITE_VAULT_PUBKEYS (comma-separated base58). The FDRY vault is always
 * included as the canonical entry so the transparency page keeps working
 * with no env configuration.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { VoltrClient } from "@voltr/vault-sdk";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  VAULT_PUBKEY_STR,
  LP_MINT_STR,
  VAULT_ASSET_MINT_STR,
} from "./voltrConfig";

export type VaultRegistryEntry = {
  pubkey: string;
  label?: string;
  // Canonical FDRY vault gets the full transparency treatment; others render
  // a generic deposit/withdraw view only.
  canonical?: boolean;
  // Optional static hints (skip an on-chain fetch on first paint).
  assetMint?: string;
  lpMint?: string;
  assetSymbol?: string;
  assetDecimals?: number;
};

export const FDRY_VAULT_ENTRY: VaultRegistryEntry = {
  pubkey: VAULT_PUBKEY_STR,
  label: "stFDRY · discretionary treasury",
  canonical: true,
  assetMint: VAULT_ASSET_MINT_STR,
  lpMint: LP_MINT_STR,
  assetSymbol: "FDRY",
  assetDecimals: 9,
};

function parseEnvList(): VaultRegistryEntry[] {
  const raw = (import.meta.env.VITE_VAULT_PUBKEYS as string | undefined) ?? "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pubkey) => ({ pubkey }));
}

export function listVaults(): VaultRegistryEntry[] {
  const env = parseEnvList();
  const seen = new Set<string>();
  const out: VaultRegistryEntry[] = [];
  // FDRY entry first; env entries dedupe against it.
  for (const v of [FDRY_VAULT_ENTRY, ...env]) {
    if (seen.has(v.pubkey)) continue;
    seen.add(v.pubkey);
    out.push(v);
  }
  return out;
}

export function findVaultEntry(pubkey: string): VaultRegistryEntry {
  return listVaults().find((v) => v.pubkey === pubkey) ?? { pubkey };
}

export function isCanonicalFdryVault(pubkey: string): boolean {
  return pubkey === VAULT_PUBKEY_STR;
}

// Turn vault.name (byte array, zero-padded) into a readable label.
export function decodeVaultName(bytes: number[] | undefined): string {
  if (!bytes || !bytes.length) return "";
  const trimmed = bytes.filter((b) => b !== 0);
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(trimmed));
  } catch {
    return "";
  }
}

export type VaultOnChainInfo = {
  pubkey: string;
  name: string;
  description: string;
  assetMint: string;
  lpMint: string;
  manager: string;
  admin: string;
  idleAuthAddr: string;
  idleAtaAddr: string;
  maxCap: bigint;
  assetDecimals: number;
  lpDecimals: number;
  // UI-scaled totals (already divided by 10^decimals).
  idleAssets: number;
  totalAssetsBooked: number; // asset.totalValue (idle + strategies, as tracked by Voltr)
  lpSupply: number;
  navPerShareInAsset: number; // totalAssetsBooked / lpSupply
  fees: {
    managerPerformance: number;
    adminPerformance: number;
    managerManagement: number;
    adminManagement: number;
    redemption: number;
    issuance: number;
  };
  withdrawalWaitingPeriodSec: number;
  disabledOperations: number;
  startAtTs: number;
};

export async function fetchVaultOnChain(
  conn: Connection,
  vaultPubkey: string,
): Promise<VaultOnChainInfo> {
  const client = new VoltrClient(conn);
  const vaultPk = new PublicKey(vaultPubkey);
  const acc = await client.fetchVaultAccount(vaultPk);

  const assetMint = acc.asset.mint;
  const lpMint = acc.lp.mint;
  const idleAuth = client.findVaultAssetIdleAuth(vaultPk);

  // Read both mints in parallel for decimals + LP supply, and idle ATA balance.
  const [assetMintInfo, lpSupplyRes, idleAtaBal] = await Promise.all([
    conn.getParsedAccountInfo(assetMint),
    conn.getTokenSupply(lpMint).catch(() => null),
    (async () => {
      // Asset may live on Token or Token-2022; try classic first (matches FDRY
      // and most mainnet vaults). If the ATA doesn't exist yet, treat as zero.
      const ata = getAssociatedTokenAddressSync(assetMint, idleAuth, true, TOKEN_PROGRAM_ID);
      const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
      return { ata, bal };
    })(),
  ]);

  const parsed =
    assetMintInfo.value?.data && "parsed" in assetMintInfo.value.data
      ? (assetMintInfo.value.data.parsed as { info?: { decimals?: number } })
      : null;
  const assetDecimals = parsed?.info?.decimals ?? 9;

  const lpDecimals = lpSupplyRes?.value?.decimals ?? assetDecimals;
  const lpSupply = lpSupplyRes
    ? Number(lpSupplyRes.value.amount) / Math.pow(10, lpDecimals)
    : 0;

  const idleAssets = idleAtaBal.bal
    ? Number(idleAtaBal.bal.value.amount) / Math.pow(10, assetDecimals)
    : 0;
  const totalAssetsBooked =
    Number(acc.asset.totalValue.toString()) / Math.pow(10, assetDecimals);
  const maxCap = BigInt(acc.vaultConfiguration.maxCap.toString());

  const name = decodeVaultName(acc.name);
  const description = decodeVaultName(acc.description);

  const navPerShareInAsset =
    lpSupply > 0 ? totalAssetsBooked / lpSupply : 1;

  return {
    pubkey: vaultPubkey,
    name,
    description,
    assetMint: assetMint.toBase58(),
    lpMint: lpMint.toBase58(),
    manager: acc.manager.toBase58(),
    admin: acc.admin.toBase58(),
    idleAuthAddr: idleAuth.toBase58(),
    idleAtaAddr: idleAtaBal.ata.toBase58(),
    maxCap,
    assetDecimals,
    lpDecimals,
    idleAssets,
    totalAssetsBooked,
    lpSupply,
    navPerShareInAsset,
    fees: {
      managerPerformance: acc.feeConfiguration.managerPerformanceFee,
      adminPerformance: acc.feeConfiguration.adminPerformanceFee,
      managerManagement: acc.feeConfiguration.managerManagementFee,
      adminManagement: acc.feeConfiguration.adminManagementFee,
      redemption: acc.feeConfiguration.redemptionFee,
      issuance: acc.feeConfiguration.issuanceFee,
    },
    withdrawalWaitingPeriodSec: Number(
      acc.vaultConfiguration.withdrawalWaitingPeriod.toString(),
    ),
    disabledOperations: acc.vaultConfiguration.disabledOperations,
    startAtTs: Number(acc.vaultConfiguration.startAtTs.toString()),
  };
}
