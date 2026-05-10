/**
 * processSignal — Day-6 slice A.
 *
 * Extracts the inline orchestration from follower.e2e.test.ts into a real,
 * importable function. NO network, NO chain, NO actual signing. The function
 * either returns `{kind:'would_sign', unsignedTxBase64}` so a future Day-7+
 * signer can pick it up, or `{kind:'skipped', reason}` for any short-circuit.
 *
 * Dependencies are injected as functions (not modules) so unit tests can
 * stub trivially with vi.fn().
 *
 * Order of checks (each failure short-circuits):
 *   1. verifySignature
 *   2. dedup (alreadySeen)
 *   3. action gating: only 'open' for Day 6 (close/claim → not_yet_supported)
 *   4. mapSignal (slice C)
 *   5. checkGuards (slice B)
 *   6. jupClient.createOrder
 *   7. assertSafeOrderResponse (cheap structural)
 *   7b. assertSafeOrderTx (wire-level signer-set)
 *   8. recordIntent (no signing)
 */

import {
  dedupKey,
  type SignalRow,
  type SignedSignalEnvelope,
} from "./signal.js";
import {
  JUPUSD_MINT,
  JupApiError,
  type CreateOrderResponse,
  type JupPredictionClient,
} from "./jupPredictionClient.js";
import {
  assertSafeOrderResponse,
  assertSafeOrderTx,
} from "./assertSafeTx.js";

/**
 * TODO(day-7): replace with on-chain TWAP oracle read of FDRY/USD.
 * Day-6 placeholder so we can compute intendedSizeFdry from the signal's
 * USD-denominated size_usd without yet wiring the oracle.
 */
export const FDRY_PRICE_USD = 0.01;

export interface RecordIntentInput {
  dedupKey: string;
  row: SignalRow;
  marketId: string;
  sizeFdry: number;
  unsignedTxBase64?: string;
  jupResponse: unknown;
}

export interface ProcessSignalDeps {
  vault: {
    pda: string;
    navFdry: number;
    deployedFdry: number;
    dayPnlFdry: number;
    cumPnlFdry: number;
  };
  manager: { pubkey: string };
  jupClient: JupPredictionClient;
  verifySignature: (env: SignedSignalEnvelope, signer: string) => boolean;
  mapSignal: (
    row: SignalRow,
    jupClient: JupPredictionClient,
  ) => Promise<
    | {
        ok: true;
        marketId: string;
        isYes: boolean;
        jupBuyPriceUsd: number;
        liquidityUsd: number;
      }
    | { ok: false; reason: string }
  >;
  checkGuards: (i: {
    navFdry: number;
    deployedFdry: number;
    dayPnlFdry: number;
    cumPnlFdry: number;
    intendedSizeFdry: number;
  }) =>
    | { ok: true; size_fdry: number }
    | { ok: false; reason: string };
  signerAllowedPubkey: string;
  alreadySeen: (dedupKey: string) => boolean;
  recordIntent: (intent: RecordIntentInput) => void;
}

export type ProcessSignalResult =
  | {
      kind: "would_sign";
      dedupKey: string;
      marketId: string;
      sizeFdry: number;
      unsignedTxBase64: string;
    }
  | { kind: "skipped"; dedupKey: string; reason: string };

export async function processSignal(
  env: SignedSignalEnvelope,
  deps: ProcessSignalDeps,
): Promise<ProcessSignalResult> {
  // Programmer-error guard: missing envelope is not a runtime path.
  if (env == null || typeof env !== "object" || env.row == null) {
    throw new Error("processSignal: envelope is required");
  }

  const row = env.row;
  const dk = dedupKey(row);

  // 1. signature
  if (!deps.verifySignature(env, deps.signerAllowedPubkey)) {
    return { kind: "skipped", dedupKey: dk, reason: "bad_signature" };
  }

  // 2. dedup (must come BEFORE any IO — see test for ordering)
  if (deps.alreadySeen(dk)) {
    return { kind: "skipped", dedupKey: dk, reason: "dedup_replay" };
  }

  // 3. action gate
  if (row.action !== "open") {
    // TODO(day-7+): wire close/claim through closePosition/claimPayout.
    return {
      kind: "skipped",
      dedupKey: dk,
      reason: "action_not_yet_supported",
    };
  }

  // 4. signal → market
  const mapped = await deps.mapSignal(row, deps.jupClient);
  if (!mapped.ok) {
    return { kind: "skipped", dedupKey: dk, reason: mapped.reason };
  }

  // 5. risk guards. Convert size_usd to FDRY using placeholder price.
  const intendedSizeFdry = row.size_usd / FDRY_PRICE_USD;
  const guard = deps.checkGuards({
    navFdry: deps.vault.navFdry,
    deployedFdry: deps.vault.deployedFdry,
    dayPnlFdry: deps.vault.dayPnlFdry,
    cumPnlFdry: deps.vault.cumPnlFdry,
    intendedSizeFdry,
  });
  if (!guard.ok) {
    return { kind: "skipped", dedupKey: dk, reason: guard.reason };
  }
  const sizeFdry = guard.size_fdry;

  // 6. build unsigned tx via Jupiter
  // Convert sized FDRY back to USD (after guard clamp) for the deposit amount.
  const depositAmountUsd = sizeFdry * FDRY_PRICE_USD;
  let jupResponse: CreateOrderResponse;
  try {
    jupResponse = await deps.jupClient.createOrder({
      ownerPubkey: deps.vault.pda,
      marketId: mapped.marketId,
      isYes: mapped.isYes,
      isBuy: true,
      depositMint: JUPUSD_MINT,
      depositAmount: depositAmountUsd,
    });
  } catch (err) {
    if (err instanceof JupApiError) {
      return {
        kind: "skipped",
        dedupKey: dk,
        reason: `jup_api_error: ${err.message}`,
      };
    }
    throw err;
  }

  // 7. pre-sign safety assertion (structural).
  //
  // VACUOUS for opens — CreateOrderResponse has no `accounts` block, so this
  // call returns ok:true by construction. The real safety check on the open
  // path is assertSafeOrderTx below (wire-level signer-set check). This call
  // is retained as defense-in-depth IF Jup ever adds an `accounts` block to
  // CreateOrderResponse (e.g. a future symmetry with CloseOrderResponse), at
  // which point the structural check starts catching mismatched
  // owner/authority/settlementMint without any further wiring.
  const verdict = assertSafeOrderResponse(jupResponse, {
    vaultPda: deps.vault.pda,
    managerPubkey: deps.manager.pubkey,
    settlementMint: JUPUSD_MINT,
  });
  if (!verdict.ok) {
    return {
      kind: "skipped",
      dedupKey: dk,
      reason: `tx_assertion_failed: ${verdict.reason}`,
    };
  }

  // CreateOrderResponse.transaction is `string | null`. If null we cannot sign.
  const unsignedTxBase64 = jupResponse.transaction;
  if (unsignedTxBase64 == null) {
    return {
      kind: "skipped",
      dedupKey: dk,
      reason: "tx_assertion_failed: jup response had null transaction",
    };
  }

  // 7b. wire-level safety assertion — decode tx and verify signer set.
  // NOTE: assertSafeOrderTx today only checks the signer set is ⊆ {manager}.
  // Per-instruction account-position checks are still TODO (need Jup IDL).
  // See pinned `it.todo` in processSignal.test.ts.
  const txCheck = assertSafeOrderTx(unsignedTxBase64, {
    vaultPda: deps.vault.pda,
    managerPubkey: deps.manager.pubkey,
  });
  if (!txCheck.ok) {
    return {
      kind: "skipped",
      dedupKey: dk,
      reason: `tx_assertion_failed: ${txCheck.reason}`,
    };
  }
  // 8. record intent (no signing on Day 6)
  deps.recordIntent({
    dedupKey: dk,
    row,
    marketId: mapped.marketId,
    sizeFdry,
    unsignedTxBase64,
    jupResponse,
  });

  return {
    kind: "would_sign",
    dedupKey: dk,
    marketId: mapped.marketId,
    sizeFdry,
    unsignedTxBase64,
  };
}
