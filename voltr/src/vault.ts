/**
 * voltr/src/vault.ts — Voltr Manager SDK wrapper.
 *
 * Minimal surface the rotator needs:
 *   - fetchVaultState(): current per-strategy USDC allocation + total NAV
 *   - buildDepositIx(strategyPubkey, amountUsdc): SDK instruction for one deposit
 *   - buildWithdrawIx(strategyPubkey, amountUsdc): SDK instruction for one withdraw
 *   - sendBatch(ixs, signer): build a tx (or tx sequence if >6 ixs), sign, submit
 *
 * Strategy registry lives in `./strategies.json` (one-time output of the
 * admin ceremony). Maps e.g. { "SPYx": <jupiter-spot-strategy-pubkey>,
 * "CASH": <save-usdc-strategy>, ... }.
 *
 * Each StrategyRecord carries adaptor-specific config (Save reserve
 * accounts, Jupiter target mint) so the adapter can resolve live
 * remainingAccounts + additionalArgs at send-time.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
// SPL Token program id (avoids @solana/spl-token dep)
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
import { BN } from "bn.js";
// @ts-ignore — resolved at install time from @voltr/vault-sdk
import { VoltrClient } from "@voltr/vault-sdk";
import type { StrategyAdapter } from "./adapters/types.js";
import { makeSaveAdapter, type SaveAdapterAccounts } from "./adapters/save.js";
import { makeJupiterSpotAdapter } from "./adapters/jupiter-spot.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Strategy registry
// ---------------------------------------------------------------------------

export interface StrategyRecord {
  token: string;                   // "CASH" | "SPYx" | "NVDAx" | ...
  pubkey: string;                  // Voltr Strategy account pubkey
                                    // (Save: derived PDA; Jupiter-spot: foreignMint itself)
  adaptor: "jupiter-spot" | "save-lending";
  adaptorProgram: string;          // Voltr adaptor program id (informational — actual
                                    // id comes from the makeXAdapter constants)
  tokenMint: string;               // SPL mint this strategy holds (foreignMint for spot)
  decimals: number;
  saveAccounts?: SaveAdapterAccounts;
  jupiterConfig?: {
    foreignTokenProgram?: string;    // default Token-2022 (for xStocks)
    assetOracle: string;             // USDC Pyth/Switchboard oracle
    foreignOracle: string;           // foreign asset oracle
    slippageBps?: number;
    maxAccounts?: number;            // Jupiter route max-accounts (default 30)
  };
}

export interface StrategyRegistry {
  vault: string;
  vaultAssetMint: string;
  vaultAssetDecimals: number;      // base asset decimals (USDC=6, FDRY=9, etc.)
  assetTokenProgram: string;
  strategies: StrategyRecord[];
}

export function loadStrategyRegistry(path?: string): StrategyRegistry {
  const file = path ?? process.env.STRATEGY_REGISTRY_PATH ?? join(__dirname, "..", "strategies.json");
  const raw = readFileSync(file, "utf8");
  return JSON.parse(raw) as StrategyRegistry;
}

// ---------------------------------------------------------------------------
// Adapter factory
function getAdapter(rec: StrategyRecord): StrategyAdapter {
  if (rec.adaptor === "save-lending") {
    if (!rec.saveAccounts) {
      throw new Error(`save-lending strategy ${rec.token} missing saveAccounts in registry`);
    }
    return makeSaveAdapter(rec.saveAccounts);
  }
  if (rec.adaptor === "jupiter-spot") {
    if (!rec.jupiterConfig) {
      throw new Error(`jupiter-spot strategy ${rec.token} missing jupiterConfig in registry`);
    }
    return makeJupiterSpotAdapter({
      foreignMint: rec.tokenMint,
      foreignTokenProgram: rec.jupiterConfig.foreignTokenProgram,
      assetOracle: rec.jupiterConfig.assetOracle,
      foreignOracle: rec.jupiterConfig.foreignOracle,
      slippageBps: rec.jupiterConfig.slippageBps ?? 50,
      maxAccounts: rec.jupiterConfig.maxAccounts ?? 30,
    });
  }
  throw new Error(`unknown adaptor: ${(rec as { adaptor: string }).adaptor}`);
}

// ---------------------------------------------------------------------------
// Vault state
// ---------------------------------------------------------------------------

export interface VaultState {
  totalValueUsdc: number;
  allocationsUsdc: Record<string, number>;
  idleUsdc: number;
}

export async function fetchVaultState(
  connection: Connection,
  manager: Keypair,
  registry: StrategyRegistry,
): Promise<VaultState> {
  const client = new VoltrClient(connection, manager);
  const vaultPk = new PublicKey(registry.vault);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await client.getPositionAndTotalValuesForVault(vaultPk);

  const d = registry.vaultAssetDecimals;
  const totalValueUsdc = toUsdc(out?.totalValue ?? out?.total_value ?? 0, d);
  const allocationsUsdc: Record<string, number> = {};
  for (const s of registry.strategies) allocationsUsdc[s.token] = 0;

  const strategies: Array<{ strategy: unknown; value: unknown }> =
    out?.strategies ?? out?.positions ?? [];
  for (const s of strategies) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pk = String((s as any).strategy?.toBase58?.() ?? (s as any).strategy ?? (s as any).pubkey ?? (s as any).strategyId);
    const rec = registry.strategies.find((r) => r.pubkey === pk);
    if (!rec) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allocationsUsdc[rec.token] = toUsdc((s as any).value ?? (s as any).amount ?? 0, d);
  }

  const idleUsdc = Math.max(
    0,
    totalValueUsdc - Object.values(allocationsUsdc).reduce((a, b) => a + b, 0),
  );
  return { totalValueUsdc, allocationsUsdc, idleUsdc };
}

function toUsdc(v: unknown, decimals: number): number {
  if (v == null) return 0;
  if (typeof v === "number") return v / 10 ** decimals;
  if (typeof v === "bigint") return Number(v) / 10 ** decimals;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (v as any)?.toString === "function") {
    const s = (v as { toString(): string }).toString();
    const n = Number(s);
    if (!Number.isNaN(n)) return n / 10 ** decimals;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

export async function buildDepositIx(
  client: VoltrClient,
  manager: PublicKey,
  registry: StrategyRegistry,
  strategy: StrategyRecord,
  amountBase: number,
): Promise<TransactionInstruction> {
  if (amountBase <= 0) throw new Error(`deposit amount must be positive, got ${amountBase}`);
  const scale = 10 ** registry.vaultAssetDecimals;
  const amountBaseUnits = BigInt(Math.round(amountBase * scale));

  const adapter = getAdapter(strategy);
  const args = await adapter.resolveDeposit({
    connection: (client as unknown as { provider: { connection: Connection } }).provider.connection,
    vault: new PublicKey(registry.vault),
    vaultAssetMint: new PublicKey(registry.vaultAssetMint),
    strategy: new PublicKey(strategy.pubkey),
    manager,
    amountBaseUnits,
  });

  return client.createDepositStrategyIx(
    {
      depositAmount: new BN(amountBaseUnits.toString()),
      instructionDiscriminator: args.instructionDiscriminator,
      additionalArgs: args.additionalArgs,
    },
    {
      manager,
      vault: new PublicKey(registry.vault),
      vaultAssetMint: new PublicKey(registry.vaultAssetMint),
      strategy: new PublicKey(strategy.pubkey),
      assetTokenProgram: new PublicKey(registry.assetTokenProgram || TOKEN_PROGRAM_ID.toBase58()),
      adaptorProgram: adapter.adaptorProgram,
      remainingAccounts: args.remainingAccounts,
    },
  );
}

export async function buildWithdrawIx(
  client: VoltrClient,
  manager: PublicKey,
  registry: StrategyRegistry,
  strategy: StrategyRecord,
  amountBase: number,
): Promise<TransactionInstruction> {
  if (amountBase <= 0) throw new Error(`withdraw amount must be positive, got ${amountBase}`);
  const scale = 10 ** registry.vaultAssetDecimals;
  const amountBaseUnits = BigInt(Math.round(amountBase * scale));

  const adapter = getAdapter(strategy);
  const args = await adapter.resolveWithdraw({
    connection: (client as unknown as { provider: { connection: Connection } }).provider.connection,
    vault: new PublicKey(registry.vault),
    vaultAssetMint: new PublicKey(registry.vaultAssetMint),
    strategy: new PublicKey(strategy.pubkey),
    manager,
    amountBaseUnits,
  });

  return client.createWithdrawStrategyIx(
    {
      withdrawAmount: new BN(amountBaseUnits.toString()),
      instructionDiscriminator: args.instructionDiscriminator,
      additionalArgs: args.additionalArgs,
    },
    {
      manager,
      vault: new PublicKey(registry.vault),
      vaultAssetMint: new PublicKey(registry.vaultAssetMint),
      strategy: new PublicKey(strategy.pubkey),
      assetTokenProgram: new PublicKey(registry.assetTokenProgram || TOKEN_PROGRAM_ID.toBase58()),
      adaptorProgram: adapter.adaptorProgram,
      remainingAccounts: args.remainingAccounts,
    },
  );
}

// ---------------------------------------------------------------------------
// Tx submission
// ---------------------------------------------------------------------------

export async function sendBatch(
  connection: Connection,
  manager: Keypair,
  ixs: TransactionInstruction[],
): Promise<string[]> {
  if (ixs.length === 0) return [];
  const CHUNK = 4;  // Jupiter-spot ixs are heavy — smaller chunks are safer
  const sigs: string[] = [];
  for (let i = 0; i < ixs.length; i += CHUNK) {
    const chunk = ixs.slice(i, i + CHUNK);
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const msg = new TransactionMessage({
      payerKey: manager.publicKey,
      recentBlockhash: blockhash,
      instructions: chunk,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([manager]);
    const sig = await connection.sendTransaction(tx, { maxRetries: 3 });
    await connection.confirmTransaction(sig, "confirmed");
    sigs.push(sig);
  }
  return sigs;
}

export { VoltrClient, BN };
