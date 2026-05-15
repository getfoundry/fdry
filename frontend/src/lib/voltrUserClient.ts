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

// ── Waiting-period withdraw flow ───────────────────────────────────────────
//
// When `vault.vaultConfiguration.withdrawalWaitingPeriod > 0`, the program
// rejects `createInstantWithdrawVaultIx` with `InstantWithdrawNotAllowed
// (6015)`. Users must instead:
//   1. call `createRequestWithdrawVaultIx` — escrows LP, creates a receipt
//      PDA, stamps `withdrawableFromTs = now + waitingPeriod`.
//   2. wait until `withdrawableFromTs`.
//   3. call `createWithdrawVaultIx` — burns escrowed LP, sends asset, closes
//      the receipt.
// Or, at any time before step 3, cancel via `createCancelRequestWithdrawVaultIx`
// (returns escrowed LP to user).
//
// Callers should gate behavior on the on-chain config readback
// (`fetchVaultWaitingPeriodSeconds`), never on a hardcoded constant.

export type BuildRequestWithdrawVaultIxsParams = Omit<
  CommonUserVaultParams,
  "vaultAssetMint"
> & {
  shareAmountBaseUnits: bigint;
  isWithdrawAll?: boolean;
};

export async function buildRequestWithdrawVaultIxs({
  client,
  payer,
  vault,
  shareAmountBaseUnits,
  isWithdrawAll = false,
  computeUnits = DEFAULT_VOLTR_COMPUTE_UNITS,
}: BuildRequestWithdrawVaultIxsParams): Promise<TransactionInstruction[]> {
  const requestIx = await client.createRequestWithdrawVaultIx(
    {
      amount: new BN(shareAmountBaseUnits.toString()),
      isAmountInLp: true,
      isWithdrawAll,
    },
    {
      payer,
      userTransferAuthority: payer,
      vault,
    },
  );

  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    requestIx,
  ];
}

export type BuildClaimWithdrawVaultIxsParams = CommonUserVaultParams;

export async function buildClaimWithdrawVaultIxs({
  client,
  payer,
  vault,
  vaultAssetMint,
  assetTokenProgram = TOKEN_PROGRAM_ID,
  computeUnits = DEFAULT_VOLTR_COMPUTE_UNITS,
}: BuildClaimWithdrawVaultIxsParams): Promise<TransactionInstruction[]> {
  const userAssetAta = getAssociatedTokenAddressSync(
    vaultAssetMint,
    payer,
    false,
    assetTokenProgram,
  );
  const claimIx = await client.createWithdrawVaultIx({
    userTransferAuthority: payer,
    vault,
    vaultAssetMint,
    assetTokenProgram,
  });

  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      userAssetAta,
      payer,
      vaultAssetMint,
      assetTokenProgram,
    ),
    claimIx,
  ];
}

export type BuildCancelRequestWithdrawVaultIxsParams = Omit<
  CommonUserVaultParams,
  "vaultAssetMint"
>;

export async function buildCancelRequestWithdrawVaultIxs({
  client,
  payer,
  vault,
  computeUnits = DEFAULT_VOLTR_COMPUTE_UNITS,
}: BuildCancelRequestWithdrawVaultIxsParams): Promise<TransactionInstruction[]> {
  const cancelIx = await client.createCancelRequestWithdrawVaultIx({
    userTransferAuthority: payer,
    vault,
  });
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    cancelIx,
  ];
}

/**
 * Read the vault's currently-declared withdrawal waiting period (seconds).
 * 0 means instant withdraw is allowed.
 */
export async function fetchVaultWaitingPeriodSeconds(
  client: VoltrClient,
  vault: PublicKey,
): Promise<number> {
  const acc = await client.fetchVaultAccount(vault);
  return acc.vaultConfiguration.withdrawalWaitingPeriod.toNumber();
}

export type UserWithdrawRequest = {
  receipt: PublicKey;
  amountLpEscrowed: bigint;
  withdrawableFromTs: number;
};

/**
 * Look up the user's open withdraw-request receipt for this vault, if any.
 * Returns null when the receipt account does not exist (no pending request).
 */
export async function fetchUserWithdrawRequestReceipt(
  client: VoltrClient,
  vault: PublicKey,
  user: PublicKey,
): Promise<UserWithdrawRequest | null> {
  const receipt = client.findRequestWithdrawVaultReceipt(vault, user);
  try {
    const acc = await client.fetchRequestWithdrawVaultReceiptAccount(receipt);
    return {
      receipt,
      amountLpEscrowed: BigInt(acc.amountLpEscrowed.toString()),
      withdrawableFromTs: acc.withdrawableFromTs.toNumber(),
    };
  } catch {
    return null;
  }
}
