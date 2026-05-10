/**
 * Pre-sign safety assertions for Jupiter Prediction transactions.
 *
 * Two layers, cheap → expensive:
 *  1. assertSafeOrderResponse — structural check against the API's `accounts`
 *     field directly. No tx decode needed. This is the FAST path used before
 *     we even bother deserializing the transaction. FULLY IMPLEMENTED.
 *  2. assertSafeOrderTx — decodes the base64 VersionedTransaction and verifies
 *     the signer set is a subset of {managerPubkey}. Per-instruction account-
 *     position assertions are stubbed out (see TODO in code) — those require
 *     decoding the Jupiter program ix layout, which is Day-N work.
 *
 * Both return `{ ok: true } | { ok: false; reason: string }` so callers can
 * branch on a single discriminated union without try/catch.
 *
 * Settlement mint default: JUPUSD (`Juprjzn...USD`). Override only for tests.
 */

import { VersionedTransaction } from "@solana/web3.js";
import {
  JUPUSD_MINT,
  type CloseOrderResponse,
  type CreateOrderResponse,
} from "./jupPredictionClient.js";

export type AssertResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface AssertExpected {
  vaultPda: string;
  managerPubkey: string;
  settlementMint?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Cheap path: structural check against the API's `accounts` field.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate the API-supplied `accounts` block before we even decode the tx.
 *
 * Only `CloseOrderResponse` carries the full `accounts` block we need
 * (owner / authority / settlementMint). `CreateOrderResponse` does not — for
 * those we return ok and defer to `assertSafeOrderTx` on the wire-level tx.
 */
export function assertSafeOrderResponse(
  resp: CreateOrderResponse | CloseOrderResponse,
  expected: AssertExpected,
): AssertResult {
  const expectedMint = expected.settlementMint ?? JUPUSD_MINT;

  // CreateOrderResponse has no `accounts` block — nothing structural to assert here.
  if (!("accounts" in resp) || resp.accounts == null) {
    return { ok: true };
  }
  const a = resp.accounts;

  if (a.owner !== expected.vaultPda) {
    return {
      ok: false,
      reason: `accounts.owner ${a.owner} !== expected vault ${expected.vaultPda}`,
    };
  }
  if (a.authority !== expected.managerPubkey) {
    return {
      ok: false,
      reason: `accounts.authority ${a.authority} !== expected manager ${expected.managerPubkey}`,
    };
  }
  if (a.settlementMint !== expectedMint) {
    return {
      ok: false,
      reason: `accounts.settlementMint ${a.settlementMint} !== expected ${expectedMint}`,
    };
  }

  // requiredSigners ⊆ {manager}
  if ("requiredSigners" in resp && Array.isArray(resp.requiredSigners)) {
    for (const signer of resp.requiredSigners) {
      if (signer !== expected.managerPubkey) {
        return {
          ok: false,
          reason: `requiredSigners contains unexpected key ${signer}`,
        };
      }
    }
  }

  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Wire-level path: decode the VersionedTransaction and verify signer set.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Decode `b64Tx` and assert the on-wire signer set is ⊆ {managerPubkey}.
 *
 * STUB SCOPE: per-instruction account-position checks (e.g. "ix[i].accounts[2]
 * is settlementMint") are NOT yet implemented — they need the Jupiter program
 * IDL or hand-derived account orderings. Tracked as Day-N work; see TODO below.
 */
export function assertSafeOrderTx(
  b64Tx: string,
  expected: AssertExpected,
): AssertResult {
  let tx: VersionedTransaction;
  try {
    const bytes = Buffer.from(b64Tx, "base64");
    tx = VersionedTransaction.deserialize(bytes);
  } catch (err) {
    return {
      ok: false,
      reason: `failed to deserialize tx: ${(err as Error).message}`,
    };
  }

  const msg = tx.message;
  const numRequiredSignatures = msg.header.numRequiredSignatures;
  const staticKeys = msg.staticAccountKeys;
  if (staticKeys.length < numRequiredSignatures) {
    return {
      ok: false,
      reason: `malformed message: header says ${numRequiredSignatures} signers but only ${staticKeys.length} static keys`,
    };
  }

  for (let i = 0; i < numRequiredSignatures; i++) {
    const key = staticKeys[i];
    if (key == null) {
      return { ok: false, reason: `signer slot ${i} is missing` };
    }
    const b58 = key.toBase58();
    if (b58 !== expected.managerPubkey) {
      return {
        ok: false,
        reason: `signer ${b58} not in allow-list {manager=${expected.managerPubkey}}`,
      };
    }
  }

  // TODO(day-N): per-instruction account-position assertions.
  //   For each compiled ix targeting the Jupiter Prediction program, verify
  //   that ix.accounts maps to the expected positions for owner / authority /
  //   vault / settlementMint as documented in CloseOrderResponse.accounts.
  //   Currently we trust the API-supplied `accounts` block (see
  //   assertSafeOrderResponse) and only verify the signer set on the wire.

  return { ok: true };
}

// last-pruned: 2026-05-09 step6/dominion
