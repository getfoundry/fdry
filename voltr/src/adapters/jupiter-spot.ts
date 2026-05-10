/**
 * voltr/src/adapters/jupiter-spot.ts — Jupiter-spot adapter.
 *
 * Ported from voltrxyz/spot-scripts/src/scripts/manager-buy-spot.ts and
 * manager-sell-spot.ts.
 *
 * STRATEGY PDA for spot adapter: `foreignAssetMint` itself (not a derived
 * PDA — the target token mint IS the strategy pubkey).
 *
 * DEPOSIT (buy: USDC → foreignAsset via Jupiter):
 *   instructionDiscriminator: SWAP_SPOT = [198, 133, 229, 32, 233, 2, 193, 212]
 *   additionalArgs:           output of setupJupiterSwap (route bytes)
 *   remainingAccounts (6):
 *     0. assetOracle                (read)
 *     1. assetOracleInitReceipt     (read, PDA from adapter)
 *     2. vaultStrategyForeignAta    (write, ATA of foreign mint under strategyAuth)
 *     3. foreignTokenProgram        (read)
 *     4. foreignOracle              (read)
 *     5. foreignOracleInitReceipt   (read, PDA from adapter)
 *
 * WITHDRAW (sell: foreignAsset → USDC via Jupiter): same layout.
 */
import { PublicKey } from "@solana/web3.js";
import type {
  StrategyAdapter,
  DepositContext,
  WithdrawContext,
  StrategyIxArgs,
  RemainingAccount,
} from "./types.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// Voltr Jupiter-Spot adaptor (mainnet).
// Source: voltrxyz/spot-scripts/src/constants/spot.ts
export const SPOT_ADAPTOR_PROGRAM_ID = new PublicKey(
  "EW35URAx3LiM13fFK3QxAXfGemHso9HWPixrv7YDY4AM",
);

// SWAP_SPOT discriminator — same for deposit (buy) and withdraw (sell).
// Source: voltrxyz/spot-scripts/src/constants/spot.ts
export const SWAP_SPOT_DISCRIMINATOR = Buffer.from([198, 133, 229, 32, 233, 2, 193, 212]);

const ORACLE_INIT_RECEIPT_SEED = Buffer.from("oracle_init_receipt");

const VAULT_STRATEGY_AUTH_SEED = Buffer.from("vault_strategy_auth");
const VAULT_PROGRAM_ID = new PublicKey("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8");

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export interface JupiterSpotAdapterConfig {
  foreignMint: string;        // e.g. SPYx mint (Token-2022)
  foreignTokenProgram?: string;  // default: Token-2022 (xStocks use this)
  assetOracle: string;        // Pyth/Switchboard oracle for USDC
  foreignOracle: string;      // Pyth/Switchboard oracle for foreign asset
  slippageBps?: number;
  maxAccounts?: number;       // Jupiter route max-accounts (default 30)
}

const JUP_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_SWAP_IX_URL = "https://lite-api.jup.ag/swap/v1/swap-instructions";

interface JupQuote {
  inAmount: string;
  outAmount: string;
  [k: string]: unknown;
}
interface JupSwapIx {
  swapInstruction: {
    programId: string;
    accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
    data: string;
  };
  addressLookupTableAddresses?: string[];
  [k: string]: unknown;
}

async function fetchJupRoute(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: bigint,
  slippageBps: number,
  maxAccounts: number,
): Promise<{ quote: JupQuote; swapIx: JupSwapIx }> {
  const q = new URLSearchParams({
    inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(),
    amount: amount.toString(),
    slippageBps: String(slippageBps),
    maxAccounts: String(maxAccounts),
  });
  const qr = await fetch(`${JUP_QUOTE_URL}?${q}`);
  if (!qr.ok) throw new Error(`Jupiter quote ${qr.status}: ${await qr.text()}`);
  const quote = (await qr.json()) as JupQuote;

  const sr = await fetch(JUP_SWAP_IX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: inputMint.toBase58(),  // placeholder; Voltr adaptor re-signs
      wrapAndUnwrapSol: false,
      asLegacyTransaction: false,
    }),
  });
  if (!sr.ok) throw new Error(`Jupiter swap-ix ${sr.status}: ${await sr.text()}`);
  const swapIx = (await sr.json()) as JupSwapIx;
  return { quote, swapIx };
}

function deriveVaultStrategyAuth(vault: PublicKey, strategy: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [VAULT_STRATEGY_AUTH_SEED, vault.toBuffer(), strategy.toBuffer()],
    VAULT_PROGRAM_ID,
  );
  return pda;
}

function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return pda;
}

function deriveOracleInitReceipt(
  vaultStrategyAuth: PublicKey,
  mint: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [ORACLE_INIT_RECEIPT_SEED, vaultStrategyAuth.toBuffer(), mint.toBuffer()],
    SPOT_ADAPTOR_PROGRAM_ID,
  );
  return pda;
}

export function makeJupiterSpotAdapter(cfg: JupiterSpotAdapterConfig): StrategyAdapter {
  const foreignMint = new PublicKey(cfg.foreignMint);
  const foreignTokenProgram = new PublicKey(
    cfg.foreignTokenProgram ?? TOKEN_2022_PROGRAM_ID.toBase58(),
  );
  const assetOracle = new PublicKey(cfg.assetOracle);
  const foreignOracle = new PublicKey(cfg.foreignOracle);
  const slippageBps = cfg.slippageBps ?? 50;
  const maxAccounts = cfg.maxAccounts ?? 30;

  function buildRemainingAccounts(
    vault: PublicKey,
    strategy: PublicKey,
    swapRouteAccounts: RemainingAccount[],
  ): RemainingAccount[] {
    const vaultStrategyAuth = deriveVaultStrategyAuth(vault, strategy);
    const vaultStrategyForeignAta = deriveAta(
      vaultStrategyAuth,
      foreignMint,
      foreignTokenProgram,
    );
    const assetOracleInitReceipt = deriveOracleInitReceipt(vaultStrategyAuth, USDC_MINT);
    const foreignOracleInitReceipt = deriveOracleInitReceipt(vaultStrategyAuth, foreignMint);

    // Fixed 6 core accounts, then Jupiter route accounts appended.
    return [
      { pubkey: assetOracle,              isSigner: false, isWritable: false },
      { pubkey: assetOracleInitReceipt,   isSigner: false, isWritable: false },
      { pubkey: vaultStrategyForeignAta,  isSigner: false, isWritable: true  },
      { pubkey: foreignTokenProgram,      isSigner: false, isWritable: false },
      { pubkey: foreignOracle,            isSigner: false, isWritable: false },
      { pubkey: foreignOracleInitReceipt, isSigner: false, isWritable: false },
      ...swapRouteAccounts,
    ];
  }

  return {
    name: "jupiter-spot",
    adaptorProgram: SPOT_ADAPTOR_PROGRAM_ID,

    async resolveDeposit(ctx: DepositContext): Promise<StrategyIxArgs> {
      const baseMint = ctx.vaultAssetMint;
      const { swapIx } = await fetchJupRoute(
        baseMint, foreignMint, ctx.amountBaseUnits, slippageBps, maxAccounts,
      );
      const additionalArgs = Buffer.from(swapIx.swapInstruction.data, "base64");
      const routeAccounts: RemainingAccount[] = [
        // Prepend Jupiter program id for CPI
        { pubkey: new PublicKey(swapIx.swapInstruction.programId),
          isSigner: false, isWritable: false },
        ...swapIx.swapInstruction.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: false,          // Voltr re-signs via strategyAuth PDA
          isWritable: a.isWritable,
        })),
      ];
      return {
        instructionDiscriminator: SWAP_SPOT_DISCRIMINATOR,
        additionalArgs,
        remainingAccounts: buildRemainingAccounts(ctx.vault, ctx.strategy, routeAccounts),
      };
    },

    async resolveWithdraw(ctx: WithdrawContext): Promise<StrategyIxArgs> {
      // Reverse: foreign → base asset. The amount is specified in base-asset units
      // (what we want to receive), so we ask Jupiter for the foreign-side
      // input amount to produce that base-asset output.
      const baseMint = ctx.vaultAssetMint;
      const overshoot = (ctx.amountBaseUnits * 102n) / 100n;  // 2% buffer
      const reverseQuote = await fetchJupRoute(
        foreignMint, baseMint, overshoot, slippageBps, maxAccounts,
      );
      const foreignAmount = BigInt(reverseQuote.quote.inAmount);
      const { swapIx } = await fetchJupRoute(
        foreignMint, baseMint, foreignAmount, slippageBps, maxAccounts,
      );
      const additionalArgs = Buffer.from(swapIx.swapInstruction.data, "base64");
      const routeAccounts: RemainingAccount[] = [
        { pubkey: new PublicKey(swapIx.swapInstruction.programId),
          isSigner: false, isWritable: false },
        ...swapIx.swapInstruction.accounts.map((a) => ({
          pubkey: new PublicKey(a.pubkey),
          isSigner: false,
          isWritable: a.isWritable,
        })),
      ];
      return {
        instructionDiscriminator: SWAP_SPOT_DISCRIMINATOR,
        additionalArgs,
        remainingAccounts: buildRemainingAccounts(ctx.vault, ctx.strategy, routeAccounts),
      };
    },
  };
}

// Unused import silencer
void TOKEN_PROGRAM_ID;
