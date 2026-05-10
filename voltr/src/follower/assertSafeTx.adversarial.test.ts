/**
 * Adversarial tests for assertSafeOrderResponse — the cheap structural gate.
 *
 * These cases simulate realistic attack shapes that an honest-path test suite
 * would miss: a compromised API edge, a homoglyph/case-flip impersonation, a
 * silently-extended signer set, or a string normalization bug. Each case has
 * a one-liner attack vector comment.
 */

import { describe, it, expect } from "vitest";
import {
  assertSafeOrderResponse,
  type AssertExpected,
} from "./assertSafeTx.js";
import {
  JUPUSD_MINT,
  type CloseOrderResponse,
} from "./jupPredictionClient.js";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures — reuse the shape from assertSafeTx.test.ts
// ────────────────────────────────────────────────────────────────────────────

const VAULT_PDA = "Vau1tPdaQwertyAsdfZxcv1234567890AbCdEfGhJk";
const MANAGER = "MgrPubkeyQwertyAsdfZxcv1234567890AbCdEfGhJk";
const ATTACKER = "4ttackerPubkeyAsdfZxcv1234567890AbCdEfGhJk";

const baseExpected: AssertExpected = {
  vaultPda: VAULT_PDA,
  managerPubkey: MANAGER,
};

function makeCloseResp(
  overrides: Partial<CloseOrderResponse> = {},
): CloseOrderResponse {
  return {
    blockhash: "BlockhashXyz1111111111111111111111111111111",
    transaction: "AAAA",
    latestBlockhash: "BlockhashXyz1111111111111111111111111111111",
    lastValidBlockHeight: 1,
    requiredSigners: [MANAGER],
    computeUnits: 200_000,
    orderPubkey: "OrdPubkey111111111111111111111111111111111",
    accounts: {
      owner: VAULT_PDA,
      authority: MANAGER,
      vault: VAULT_PDA,
      marketId: "mkt-1",
      position: "Pos1111111111111111111111111111111111111111",
      order: "Ord1111111111111111111111111111111111111111",
      orderAta: "Ata1111111111111111111111111111111111111111",
      ownerTokenAccount: "Ota111111111111111111111111111111111111111",
      settlementMint: JUPUSD_MINT,
    },
    ...overrides,
  };
}

describe("assertSafeOrderResponse — adversarial inputs", () => {
  // ── 1. Golden baseline ────────────────────────────────────────────────────
  it("[golden] passes a fully-correct CloseOrderResponse", () => {
    const res = assertSafeOrderResponse(makeCloseResp(), baseExpected);
    expect(res.ok).toBe(true);
  });

  // ── 2. EDGE: empty requiredSigners ────────────────────────────────────────
  // Attack vector: a malicious API edge could omit requiredSigners entirely
  // (or send []) hoping the gate skips signer checks and lets a server-signed
  // tx through. assertSafeTx.ts CURRENT BEHAVIOR: the for-loop has nothing to
  // iterate, so it returns ok. The actual signer enforcement happens in
  // assertSafeOrderTx by decoding the wire tx — so the cheap gate is correctly
  // permissive here. We pin that as the chosen behavior.
  it("[edge] empty requiredSigners is treated as OK (deferred to wire-level check)", () => {
    const resp = makeCloseResp({ requiredSigners: [] });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(true);
  });

  // ── 3. EDGE: settlementMint with trailing space ───────────────────────────
  // Attack vector: a unicode/whitespace smuggle where the API returns a mint
  // string that visually equals JUPUSD but has an invisible trailing space —
  // would route settlement to a lookalike SPL account if compared loosely.
  it("[edge] settlementMint with trailing space is rejected (string equality, not normalized)", () => {
    const resp = makeCloseResp({
      accounts: {
        ...makeCloseResp().accounts,
        settlementMint: `${JUPUSD_MINT} `,
      },
    });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/settlementMint/);
  });

  // ── 4. EDGE: case-flipped owner (base58 is case-sensitive) ────────────────
  // Attack vector: homoglyph-style impersonation — an attacker registers a
  // pubkey that differs from the real vault PDA only in letter case. Base58
  // distinguishes 'U' vs 'u', so a flipped char is a wholly different key but
  // could fool a careless reviewer eyeballing logs.
  it("[edge] case-flipped vault owner is rejected (base58 case-sensitive)", () => {
    // VAULT_PDA starts with "Vau1t..." → flip 'V' to 'v'.
    const flipped = `v${VAULT_PDA.slice(1)}`;
    const resp = makeCloseResp({
      accounts: { ...makeCloseResp().accounts, owner: flipped },
    });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/owner/);
  });

  // ── 5. EDGE: extra/unknown field on accounts ──────────────────────────────
  // Attack vector: API adds an undocumented `feeRecipient` (or similar) field
  // that the gate doesn't know about. The gate must not crash on the unknown
  // field, and must not silently allow a request whose required fields are
  // wrong. With all required fields correct, the extra field should pass.
  it("[edge] unknown extra field on accounts does not crash and passes when required fields are correct", () => {
    const base = makeCloseResp();
    const resp: CloseOrderResponse = {
      ...base,
      accounts: {
        ...base.accounts,
        // @ts-expect-error — intentionally injecting a field the type doesn't declare
        feeRecipient: ATTACKER,
      },
    };
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(true);
  });

  // ── 6. ADVERSARIAL: Trojan response — every documented field correct, but
  //    requiredSigners smuggles a second pubkey ─────────────────────────────
  // Attack vector: a compromised API edge could hand back a tx that signs
  // under the attacker too — owner/authority/mint all look right so a quick
  // visual audit passes, but the extra co-signer drains via a malicious ix
  // bundled into the same tx. This is the most dangerous shape because every
  // field a human would skim is correct.
  it("[adversarial] Trojan: correct owner/authority/mint but requiredSigners has 2 entries", () => {
    const resp = makeCloseResp({
      requiredSigners: [MANAGER, ATTACKER],
    });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/signer/i);
    if (!res.ok) expect(res.reason).toContain(ATTACKER);
  });
});
