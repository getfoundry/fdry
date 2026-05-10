/**
 * Tests for assertSafeTx — the pre-sign safety gate.
 *
 * Lost-sheep edges chased here (Day-3 unbelief #4 + #5):
 *  - assertSafeOrderResponse must reject mismatched owner/authority/settlementMint
 *    and any non-manager signer in requiredSigners.
 *  - assertSafeOrderTx is signer-set only — there is NO per-instruction account
 *    position assertion. We pin that scope-limit with an `it.todo` so the next
 *    reader can't mistake the cheap path for a full audit.
 */

import { describe, it, expect } from "vitest";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  assertSafeOrderResponse,
  assertSafeOrderTx,
  type AssertExpected,
} from "./assertSafeTx.js";
import {
  JUPUSD_MINT,
  type CloseOrderResponse,
} from "./jupPredictionClient.js";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const VAULT_PDA = "Vau1tPdaQwertyAsdfZxcv1234567890AbCdEfGhJk";
const MANAGER = "MgrPubkeyQwertyAsdfZxcv1234567890AbCdEfGhJk";
const STRANGER = "5tr4nGerPubkeyAsdfZxcv1234567890AbCdEfGhJk";

const baseExpected: AssertExpected = {
  vaultPda: VAULT_PDA,
  managerPubkey: MANAGER,
};

function makeCloseResp(overrides: Partial<CloseOrderResponse> = {}): CloseOrderResponse {
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

/**
 * Build a minimal v0 VersionedTransaction with the given signer keys as the
 * leading static account keys. Uses @solana/web3.js compile path so the byte
 * layout is the same one the runtime decoder will see.
 */
function makeTxWithSigners(signers: PublicKey[]): string {
  const payer = signers[0];
  if (!payer) throw new Error("need at least one signer");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [
      // Empty instruction set — we only care about the signer/header layout.
      // (Compile is fine with zero ixs as long as the payer is set.)
    ],
  }).compileToV0Message();
  // Bump numRequiredSignatures to len(signers) and place the rest after payer.
  // TransactionMessage already sets payer as static[0]; we extend manually.
  for (let i = 1; i < signers.length; i++) {
    const k = signers[i]!;
    message.staticAccountKeys.push(k);
  }
  message.header.numRequiredSignatures = signers.length;
  message.header.numReadonlySignedAccounts = Math.max(
    0,
    signers.length - 1,
  );
  const tx = new VersionedTransaction(message);
  return Buffer.from(tx.serialize()).toString("base64");
}

// ────────────────────────────────────────────────────────────────────────────
// assertSafeOrderResponse
// ────────────────────────────────────────────────────────────────────────────

describe("assertSafeOrderResponse", () => {
  it("OK for a well-formed close response", () => {
    const res = assertSafeOrderResponse(makeCloseResp(), baseExpected);
    expect(res.ok).toBe(true);
  });

  it("rejects when accounts.owner mismatches expected vault", () => {
    const resp = makeCloseResp({
      accounts: { ...makeCloseResp().accounts, owner: STRANGER },
    });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/owner/);
  });

  it("rejects when accounts.authority mismatches manager", () => {
    const resp = makeCloseResp({
      accounts: { ...makeCloseResp().accounts, authority: STRANGER },
    });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/authority/);
  });

  it("rejects when accounts.settlementMint is not JUPUSD", () => {
    const resp = makeCloseResp({
      accounts: { ...makeCloseResp().accounts, settlementMint: STRANGER },
    });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/settlementMint/);
  });

  it("rejects when requiredSigners contains a non-manager pubkey", () => {
    const resp = makeCloseResp({ requiredSigners: [MANAGER, STRANGER] });
    const res = assertSafeOrderResponse(resp, baseExpected);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/signer/i);
  });

  it("respects expected.settlementMint override (rejects when response doesn't match)", () => {
    const overrideMint = "Ovr1de111111111111111111111111111111111111";
    const resp = makeCloseResp(); // settlementMint = JUPUSD
    const res = assertSafeOrderResponse(resp, {
      ...baseExpected,
      settlementMint: overrideMint,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/settlementMint/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// assertSafeOrderTx
// ────────────────────────────────────────────────────────────────────────────

describe("assertSafeOrderTx", () => {
  it("OK when signer set is exactly {manager}", () => {
    const managerKp = Keypair.generate();
    const expected: AssertExpected = {
      vaultPda: VAULT_PDA,
      managerPubkey: managerKp.publicKey.toBase58(),
    };
    const b64 = makeTxWithSigners([managerKp.publicKey]);
    const res = assertSafeOrderTx(b64, expected);
    expect(res.ok).toBe(true);
  });

  it("REJECTS when signer set includes a stranger", () => {
    const managerKp = Keypair.generate();
    const strangerKp = Keypair.generate();
    const expected: AssertExpected = {
      vaultPda: VAULT_PDA,
      managerPubkey: managerKp.publicKey.toBase58(),
    };
    const b64 = makeTxWithSigners([managerKp.publicKey, strangerKp.publicKey]);
    const res = assertSafeOrderTx(b64, expected);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain(strangerKp.publicKey.toBase58());
    }
  });

  // Lost-sheep guard: assertSafeOrderTx ONLY checks the signer set today.
  // It does NOT verify per-instruction account positions (e.g. that ix.accounts[2]
  // is the expected settlementMint). Doing that requires the Jupiter Prediction
  // program IDL, which we don't have in-tree yet. Instead of `expect(true).toBe(true)`,
  // we leave a `todo` so the next reader can't mistake the cheap signer-only path
  // for a full account-layout audit.
  it.todo("per-ix account-position assertion needs Jup IDL");
});
