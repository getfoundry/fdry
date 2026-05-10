/**
 * voltr/src/adapters/types.ts — common shape every strategy adapter provides.
 *
 * A Voltr strategy wraps a DeFi integration (Save lending, Jupiter spot,
 * Drift perp, etc.). The Manager's deposit/withdraw uses
 * `createDepositStrategyIx` / `createWithdrawStrategyIx`, which take three
 * adaptor-specific pieces:
 *
 *   - instructionDiscriminator: 8-byte selector for the adaptor's
 *     deposit/withdraw/initialize method
 *   - additionalArgs: adaptor-specific payload (e.g. Jupiter swap route bytes)
 *   - remainingAccounts: adaptor-specific account list (order matters)
 *
 * Each adapter below exposes resolve* functions producing these at call-time.
 * Values that depend on live protocol state (e.g. current Jupiter route) are
 * fetched fresh per rebalance.
 */
import type { Connection, PublicKey } from "@solana/web3.js";

export interface DepositContext {
  connection: Connection;
  vault: PublicKey;
  vaultAssetMint: PublicKey;      // Base asset mint (USDC, FDRY, etc.)
  strategy: PublicKey;
  manager: PublicKey;
  amountBaseUnits: bigint;        // Amount in the vault asset's base units
}

export interface WithdrawContext {
  connection: Connection;
  vault: PublicKey;
  vaultAssetMint: PublicKey;
  strategy: PublicKey;
  manager: PublicKey;
  amountBaseUnits: bigint;
}

export interface RemainingAccount {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

export interface StrategyIxArgs {
  instructionDiscriminator: Buffer | null;
  additionalArgs: Buffer | null;
  remainingAccounts: RemainingAccount[];
}

export interface StrategyAdapter {
  name: "save-lending" | "jupiter-spot";
  /** Program ID of the adaptor (e.g. Voltr's save-lending adaptor program). */
  adaptorProgram: PublicKey;

  resolveDeposit(ctx: DepositContext): Promise<StrategyIxArgs>;
  resolveWithdraw(ctx: WithdrawContext): Promise<StrategyIxArgs>;
}
