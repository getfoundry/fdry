import {
  ComputeBudgetProgram,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import { VoltrClient } from "@voltr/vault-sdk";

export const DEFAULT_VOLTR_COMPUTE_UNITS = 400_000;

export function decimalAmountToBaseUnits(
  amount: string | number,
  decimals: number,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`invalid decimals ${decimals}`);
  }
  const raw = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error("amount must be a positive decimal string");
  }

  const [whole, frac = ""] = raw.split(".");
  if (frac.length > decimals) {
    throw new Error(`amount has more than ${decimals} decimal places`);
  }
  const padded = frac.padEnd(decimals, "0");
  const base = BigInt(whole) * 10n ** BigInt(decimals);
  const fractional = padded ? BigInt(padded) : 0n;
  const out = base + fractional;
  if (out <= 0n) throw new Error("amount must be greater than zero");
  return out;
}

type CommonUserVaultParams = {
  client: VoltrClient;
  payer: PublicKey;
  vault: PublicKey;
  vaultAssetMint: PublicKey;
  assetTokenProgram?: PublicKey;
  computeUnits?: number;
};

export type BuildDepositVaultIxsParams = CommonUserVaultParams & {
  lpMint: PublicKey;
  amountBaseUnits: bigint;
};

export async function buildDepositVaultIxs({
  client,
  payer,
  vault,
  vaultAssetMint,
  lpMint,
  amountBaseUnits,
  assetTokenProgram = TOKEN_PROGRAM_ID,
  computeUnits = DEFAULT_VOLTR_COMPUTE_UNITS,
}: BuildDepositVaultIxsParams): Promise<TransactionInstruction[]> {
  const userAssetAta = getAssociatedTokenAddressSync(
    vaultAssetMint,
    payer,
    false,
    assetTokenProgram,
  );
  const userLpAta = getAssociatedTokenAddressSync(
    lpMint,
    payer,
    false,
    TOKEN_PROGRAM_ID,
  );
  const depositIx = await client.createDepositVaultIx(
    new BN(amountBaseUnits.toString()),
    {
      userTransferAuthority: payer,
      vault,
      vaultAssetMint,
      assetTokenProgram,
    },
  );

  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      userAssetAta,
      payer,
      vaultAssetMint,
      assetTokenProgram,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      userLpAta,
      payer,
      lpMint,
      TOKEN_PROGRAM_ID,
    ),
    depositIx,
  ];
}

export type BuildInstantWithdrawVaultIxsParams = CommonUserVaultParams & {
  shareAmountBaseUnits: bigint;
  isWithdrawAll?: boolean;
};

export async function buildInstantWithdrawVaultIxs({
  client,
  payer,
  vault,
  vaultAssetMint,
  shareAmountBaseUnits,
  isWithdrawAll = false,
  assetTokenProgram = TOKEN_PROGRAM_ID,
  computeUnits = DEFAULT_VOLTR_COMPUTE_UNITS,
}: BuildInstantWithdrawVaultIxsParams): Promise<TransactionInstruction[]> {
  const userAssetAta = getAssociatedTokenAddressSync(
    vaultAssetMint,
    payer,
    false,
    assetTokenProgram,
  );
  const withdrawIx = await client.createInstantWithdrawVaultIx(
    {
      amount: new BN(shareAmountBaseUnits.toString()),
      isAmountInLp: true,
      isWithdrawAll,
    },
    {
      userTransferAuthority: payer,
      vault,
      vaultAssetMint,
      assetTokenProgram,
    },
  );

  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      userAssetAta,
      payer,
      vaultAssetMint,
      assetTokenProgram,
    ),
    withdrawIx,
  ];
}
