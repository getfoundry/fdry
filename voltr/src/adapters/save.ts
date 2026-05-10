/**
 * voltr/src/adapters/save.ts — Save-lending adapter.
 *
 * Ported from voltrxyz/lend-scripts/src/scripts/manager-deposit-strategies.ts
 * (depositSolendStrategy function). Faithfully reproduces the Save CPI
 * account layout used by Voltr's Lending Adaptor.
 *
 * STRATEGY PDA: [SEEDS.STRATEGY, counterPartyTa] under LENDING_ADAPTOR
 * LENDING_MARKET_AUTH: [lendingMarket.toBytes()] under SOLEND_PROGRAM
 *
 * DEPOSIT remainingAccounts (10):
 *   0. counterPartyTa       (write)  — Solend USDC liquidity supply TA
 *   1. protocolProgram      (read)   — So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo
 *   2. vaultCollateralAta   (write)  — vault's cUSDC ATA under strategyAuth
 *   3. reserve              (write)  — Solend USDC reserve account
 *   4. collateralMint       (write)  — cUSDC mint
 *   5. lendingMarket        (write)  — Solend main market
 *   6. lendingMarketAuth    (read)   — PDA
 *   7. pythOracle           (read)
 *   8. switchboardOracle    (read)
 *   9. TOKEN_PROGRAM_ID     (read)
 *
 * WITHDRAW remainingAccounts: same list with the same writable flags
 * (Save's redeem uses the same reserve refresh flow).
 */
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import type {
  StrategyAdapter,
  DepositContext,
  WithdrawContext,
  StrategyIxArgs,
  RemainingAccount,
} from "./types.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// Voltr Lending Adaptor (mainnet) — wraps Save, Kamino, Marginfi, Drift, JupLend
// Source: docs.ranger.finance Strategy Setup Guide.
export const LENDING_ADAPTOR_PROGRAM_ID = new PublicKey(
  "aVoLTRCRt3NnnchvLYH6rMYehJHwM5m45RmLBZq7PGz",
);

// STRATEGY seed for PDA derivation (matches SEEDS.STRATEGY in @voltr/vault-sdk)
const STRATEGY_SEED = Buffer.from("strategy");

/**
 * Save-specific accounts, pinned in strategies.json. Values from
 * voltrxyz/lend-scripts/src/constants/solend.ts (MAIN_MARKET.USDC).
 */
export interface SaveAdapterAccounts {
  lendingMarket: string;
  reserve: string;
  counterPartyTa: string;          // reserveLiquiditySupply
  reserveCollateralMint: string;   // cUSDC mint
  pythOracle: string;
  switchboardOracle: string;
  saveLendingProgram: string;
}

/**
 * Derive strategy PDA: [STRATEGY_SEED, counterPartyTa] under lending adaptor.
 */
export function deriveSaveStrategyPda(counterPartyTa: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [STRATEGY_SEED, counterPartyTa.toBuffer()],
    LENDING_ADAPTOR_PROGRAM_ID,
  );
  return pda;
}

/**
 * Derive lendingMarketAuthority: [lendingMarket] under Solend program.
 */
export function deriveLendingMarketAuthority(
  lendingMarket: PublicKey,
  protocolProgram: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [lendingMarket.toBuffer()],
    protocolProgram,
  );
  return pda;
}

/**
 * Derive vault-strategy-auth PDA (same as VoltrClient.findVaultStrategyAuth).
 * Uses SEEDS.VAULT_STRATEGY_AUTH = Buffer.from("vault_strategy_auth").
 */
const VAULT_STRATEGY_AUTH_SEED = Buffer.from("vault_strategy_auth");
const VAULT_PROGRAM_ID = new PublicKey("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8");

export function deriveVaultStrategyAuth(vault: PublicKey, strategy: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [VAULT_STRATEGY_AUTH_SEED, vault.toBuffer(), strategy.toBuffer()],
    VAULT_PROGRAM_ID,
  );
  return pda;
}

/**
 * Derive associated token account. Voltr uses classic ATA derivation.
 */
export function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return pda;
}

export function makeSaveAdapter(accounts: SaveAdapterAccounts): StrategyAdapter {
  const lendingMarket = new PublicKey(accounts.lendingMarket);
  const reserve = new PublicKey(accounts.reserve);
  const counterPartyTa = new PublicKey(accounts.counterPartyTa);
  const reserveCollateralMint = new PublicKey(accounts.reserveCollateralMint);
  const pythOracle = new PublicKey(accounts.pythOracle);
  const switchboardOracle = new PublicKey(accounts.switchboardOracle);
  const saveLendingProgram = new PublicKey(accounts.saveLendingProgram);

  const lendingMarketAuthority = deriveLendingMarketAuthority(lendingMarket, saveLendingProgram);

  function remainingAccountsForDepositOrWithdraw(vault: PublicKey, strategy: PublicKey): RemainingAccount[] {
    const vaultStrategyAuth = deriveVaultStrategyAuth(vault, strategy);
    const vaultCollateralAta = deriveAta(vaultStrategyAuth, reserveCollateralMint, TOKEN_PROGRAM_ID);
    return [
      { pubkey: counterPartyTa,        isSigner: false, isWritable: true  },
      { pubkey: saveLendingProgram,    isSigner: false, isWritable: false },
      { pubkey: vaultCollateralAta,    isSigner: false, isWritable: true  },
      { pubkey: reserve,               isSigner: false, isWritable: true  },
      { pubkey: reserveCollateralMint, isSigner: false, isWritable: true  },
      { pubkey: lendingMarket,         isSigner: false, isWritable: true  },
      { pubkey: lendingMarketAuthority,isSigner: false, isWritable: false },
      { pubkey: pythOracle,            isSigner: false, isWritable: false },
      { pubkey: switchboardOracle,     isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,      isSigner: false, isWritable: false },
    ];
  }

  return {
    name: "save-lending",
    adaptorProgram: LENDING_ADAPTOR_PROGRAM_ID,

    async resolveDeposit(ctx: DepositContext): Promise<StrategyIxArgs> {
      return {
        instructionDiscriminator: null,
        additionalArgs: null,
        remainingAccounts: remainingAccountsForDepositOrWithdraw(ctx.vault, ctx.strategy),
      };
    },

    async resolveWithdraw(ctx: WithdrawContext): Promise<StrategyIxArgs> {
      return {
        instructionDiscriminator: null,
        additionalArgs: null,
        remainingAccounts: remainingAccountsForDepositOrWithdraw(ctx.vault, ctx.strategy),
      };
    },
  };
}

// Suppress unused import (kept for future extension if Save needs clock-gated refresh)
void SYSVAR_CLOCK_PUBKEY;
void TransactionInstruction;
