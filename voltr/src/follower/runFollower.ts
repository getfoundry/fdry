/**
 * runFollower — Day-6 slice F orchestrator + Phase C resolver wiring.
 */

import { runBoot } from "./boot.js";
import {
  createJupPredictionClient,
  JupApiError,
  type JupPredictionClient,
} from "./jupPredictionClient.js";
import {
  processSignal,
  type ProcessSignalDeps,
  type RecordIntentInput,
} from "./processSignal.js";
import { checkGuards, type FollowerCaps } from "./guards.js";
import {
  resolveTriggerToJup,
  snapshotFromEntries,
  type JupSnapshot,
  type JupSnapshotEntry,
} from "./jupMarketResolver.js";
import type { TriggerEvent } from "./triggerSource.js";
import { FollowerStore, type FollowerState } from "./state.js";
import { checkKillSwitch, type KillSwitchOptions } from "./killSwitch.js";
import { PaperLedger } from "./paperLedger.js";
import {
  verifySignature as defaultVerifySignature,
  type SignedSignalEnvelope,
  type SignalRow,
} from "./signal.js";

export type RunFollowerLogger = {
  info: (m: string, x?: unknown) => void;
  warn: (m: string, x?: unknown) => void;
  error: (m: string, x?: unknown) => void;
};

export type RunFollowerOptions = {
  storePath: string;
  pollIntervalMs?: number;
  jupApiKey: string;
  jupBaseUrl?: string;
  signerAllowedPubkey: string;
  vault: {
    pda: string;
    navFdry: number;
    deployedFdry: number;
    dayPnlFdry: number;
    cumPnlFdry: number;
  };
  manager: { pubkey: string };
  fetchSinceCursor: (
    cursor: string | null,
  ) => Promise<{ rows: SignedSignalEnvelope[]; nextCursor: string | null }>;
  dryRun?: boolean;
  logger?: RunFollowerLogger;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  bootOverride?: () => Promise<{
    ok: boolean;
    checks: { name: string; ok: boolean; reason?: string }[];
  }>;
  killSwitchOptions?: KillSwitchOptions;
  caps?: FollowerCaps;
  verifySignature?: (env: SignedSignalEnvelope, signer: string) => boolean;
  jupClientOverride?: ProcessSignalDeps["jupClient"];
  // --- Phase C — Jup snapshot ---
  snapshotCategories?: string[];
  snapshotTtlMs?: number;
  snapshotOverride?: JupSnapshot;
  mapSignalOverride?: ProcessSignalDeps["mapSignal"];
  /**
   * Path to the paper-trade ledger file. When set, every `would_sign`
   * decision (in dryRun OR live mode) appends one row for the daily
   * resolver to walk. Default: undefined → no ledger written.
   */
  paperLedgerPath?: string;
};

export type RunFollowerSummary = {
  iterations: number;
  rowsProcessed: number;
  wouldSignCount: number;
  skippedCount: number;
  throwCount: number;
  haltedAt?: { iteration: number; reason: string };
};

const noopLogger: RunFollowerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    (timer as unknown as { unref?: () => void }).unref?.();
  });

const DEFAULT_SNAPSHOT_CATEGORIES = [
  "esports",
  "sports",
  "crypto",
  "politics",
  "culture",
  "economics",
  "tech",
];
const DEFAULT_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

export async function buildJupSnapshotFromClient(
  client: JupPredictionClient,
  categories: string[],
  nowMs: number,
): Promise<JupSnapshot> {
  const entries: JupSnapshotEntry[] = [];
  for (const cat of categories) {
    let start = 0;
    for (let page = 0; page < 50; page++) {
      const resp = await client.listEvents({
        category: cat,
        start,
        end: start + 20,
      });
      for (const ev of resp.data) {
        const slug = ev.metadata?.slug ?? "";
        if (!slug) continue;
        entries.push({
          eventId: ev.eventId,
          slug,
          category: ev.category ?? null,
          subcategory: ev.subcategory ?? null,
          closeTimeIso: ev.metadata?.closeTime ?? null,
          markets: (ev.markets ?? []).map((m) => ({
            marketId: m.marketId,
            title: m.title ?? "",
            status: m.status ?? null,
          })),
        });
      }
      if (!resp.pagination.hasNext) break;
      start += 20;
    }
  }
  return snapshotFromEntries(entries, nowMs);
}

function rowToTriggerLike(row: SignalRow): TriggerEvent {
  return {
    v: 1,
    ts: 0,
    token_id: row.token_id,
    upstream_slug: row.slug,
    side: row.side,
    upstream_no_ask: row.price,
    upstream_yes_current: 1 - row.price,
    upstream_yes_pre: 0,
    trigger_score: 0,
    quality_bucket: row.quality_bucket ?? "?",
    primary_tag: "",
    subcategory: "",
    trigger_signature: row.order_id ?? "",
  };
}

export async function runFollower(
  opts: RunFollowerOptions,
): Promise<RunFollowerSummary> {
  const logger = opts.logger ?? noopLogger;
  const pollIntervalMs = opts.pollIntervalMs ?? 30_000;
  const now = opts.now ?? Date.now;
  const sleep =
    opts.sleep ?? ((ms: number) => defaultSleep(ms, opts.signal));
  const verifySignature = opts.verifySignature ?? defaultVerifySignature;
  const snapshotCategories =
    opts.snapshotCategories ?? DEFAULT_SNAPSHOT_CATEGORIES;
  const snapshotTtlMs = opts.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS;

  const summary: RunFollowerSummary = {
    iterations: 0,
    rowsProcessed: 0,
    wouldSignCount: 0,
    skippedCount: 0,
    throwCount: 0,
  };

  // --- 1. boot ---
  const bootRunner =
    opts.bootOverride ??
    (() =>
      runBoot({
        JUP_PREDICTION_API_KEY: opts.jupApiKey,
        BRIDGE_SIGNER_PUBKEY: opts.signerAllowedPubkey,
        MANAGER_KEYPAIR_PATH: opts.manager.pubkey,
        KV_LIVE_SIGNALS_URL: "injected://fetchSinceCursor",
        dryRun: opts.dryRun,
      }));
  let bootReport: {
    ok: boolean;
    checks: { name: string; ok: boolean; reason?: string }[];
  };
  try {
    bootReport = await bootRunner();
  } catch (err) {
    summary.haltedAt = {
      iteration: 0,
      reason: `boot_failed: threw ${(err as Error)?.message ?? String(err)}`,
    };
    logger.error("[follower] boot threw", err);
    return summary;
  }
  if (!bootReport.ok) {
    const firstFailed = bootReport.checks.find((c) => !c.ok);
    summary.haltedAt = {
      iteration: 0,
      reason: `boot_failed: ${firstFailed?.name ?? "unknown"}${
        firstFailed?.reason ? ` (${firstFailed.reason})` : ""
      }`,
    };
    logger.error("[follower] boot failed", bootReport);
    return summary;
  }
  logger.info("[follower] boot ok");

  // --- 2. construct deps ---
  const jupClient =
    opts.jupClientOverride ??
    createJupPredictionClient({
      apiKey: opts.jupApiKey,
      baseUrl: opts.jupBaseUrl,
    });
  const store = new FollowerStore({ path: opts.storePath });
  const paperLedger = opts.paperLedgerPath
    ? new PaperLedger({ path: opts.paperLedgerPath })
    : null;
  let state: FollowerState;
  try {
    state = await store.load();
  } catch (err) {
    summary.haltedAt = {
      iteration: 0,
      reason: `state_load_failed: ${(err as Error)?.message ?? String(err)}`,
    };
    logger.error("[follower] state load failed", err);
    return summary;
  }

  const caps = opts.caps;

  // --- 2b. Phase C — Jup snapshot ---
  let snapshot: JupSnapshot;
  if (opts.snapshotOverride) {
    snapshot = opts.snapshotOverride;
  } else if (opts.bootOverride) {
    snapshot = snapshotFromEntries([], now());
    logger.info("[follower] snapshot test-seam: empty (bootOverride active)");
  } else {
    try {
      snapshot = await buildJupSnapshotFromClient(
        jupClient,
        snapshotCategories,
        now(),
      );
      logger.info("[follower] snapshot built", {
        events: snapshot.bySlug.size,
      });
    } catch (err) {
      summary.haltedAt = {
        iteration: 0,
        reason: `snapshot_unreachable: ${(err as Error)?.message ?? String(err)}`,
      };
      logger.error("[follower] initial snapshot fetch failed", err);
      return summary;
    }
  }

  // --- 2c. mapSignal — resolver-backed (Phase C) ---
  const defaultMapSignal: ProcessSignalDeps["mapSignal"] = async (row) => {
    const trigLike = rowToTriggerLike(row);
    const r = resolveTriggerToJup(trigLike, snapshot, { now, snapshotTtlMs });
    if (!r.ok) return { ok: false, reason: r.reason };
    try {
      const market = await jupClient.getMarket(r.marketId);
      const pricing = market.pricing ?? {};
      const buyMicro = r.isYes
        ? pricing.buyYesPriceUsd
        : pricing.buyNoPriceUsd;
      const buyUsd =
        buyMicro == null ? undefined : Number(buyMicro) / 1_000_000;
      if (buyUsd == null || !Number.isFinite(buyUsd)) {
        return { ok: false, reason: "no_pricing" };
      }
      const ob = await jupClient.getOrderbook(r.marketId);
      const sideRows = ob ? (r.isYes ? ob.yes_dollars : ob.no_dollars) : null;
      let liquidityUsd = 0;
      for (const [priceStr, qty] of (sideRows ?? []).slice(0, 3)) {
        liquidityUsd += Number(priceStr) * Number(qty);
      }
      return {
        ok: true,
        marketId: r.marketId,
        isYes: r.isYes,
        jupBuyPriceUsd: buyUsd,
        liquidityUsd,
      };
    } catch (err) {
      if (err instanceof JupApiError) {
        return { ok: false, reason: "jup_api_error" };
      }
      throw err;
    }
  };
  // Test seam: bootOverride implies a unit-test environment with no live Jup.
  const testSeamMapSignal: ProcessSignalDeps["mapSignal"] = async (row) => ({
    ok: true,
    marketId: `test-market:${row.slug}`,
    isYes: row.side === "YES",
    jupBuyPriceUsd: row.price,
    liquidityUsd: 1_000_000,
  });
  const mapSignal =
    opts.mapSignalOverride ??
    (opts.bootOverride ? testSeamMapSignal : defaultMapSignal);

  // --- 3. main loop ---
  while (true) {
    if (opts.signal?.aborted) {
      logger.info("[follower] aborted before iteration");
      return summary;
    }
    summary.iterations += 1;
    const iter = summary.iterations;

    // 3a. snapshot TTL refresh
    if (
      !opts.snapshotOverride &&
      !opts.bootOverride &&
      now() - snapshot.fetchedAtMs > snapshotTtlMs
    ) {
      try {
        snapshot = await buildJupSnapshotFromClient(
          jupClient,
          snapshotCategories,
          now(),
        );
        logger.info("[follower] snapshot refreshed", {
          events: snapshot.bySlug.size,
        });
      } catch (err) {
        logger.warn(
          "[follower] snapshot refresh failed; continuing with stale",
          err,
        );
      }
    }

    // 3b. kill switch
    let kill;
    try {
      kill = await checkKillSwitch(opts.killSwitchOptions);
    } catch (err) {
      summary.haltedAt = {
        iteration: iter,
        reason: `kill_switch_throw: ${(err as Error)?.message ?? String(err)}`,
      };
      logger.error("[follower] kill switch threw", err);
      return summary;
    }
    if (kill.halted) {
      summary.haltedAt = {
        iteration: iter,
        reason: `kill_switch:${kill.source}: ${kill.detail}`,
      };
      logger.warn("[follower] halted by kill switch", kill);
      return summary;
    }

    // 3c. fetch
    let batch: { rows: SignedSignalEnvelope[]; nextCursor: string | null };
    try {
      batch = await opts.fetchSinceCursor(state.lastCursor);
    } catch (err) {
      logger.error("[follower] fetch failed", err);
      await sleep(pollIntervalMs);
      continue;
    }

    if (batch.rows.length === 0) {
      if (batch.nextCursor !== null && batch.nextCursor !== state.lastCursor) {
        state = store.setCursor(state, batch.nextCursor);
      }
      state = store.beat(state, now());
      try {
        await store.save(state);
      } catch (err) {
        logger.error("[follower] state save failed (idle)", err);
      }
      await sleep(pollIntervalMs);
      continue;
    }

    // 3d. per-envelope processing
    let batchThrew = false;
    for (const env of batch.rows) {
      if (opts.signal?.aborted) break;
      summary.rowsProcessed += 1;

      const stateAtEntry = state;
      const pendingIntentBox: { value: RecordIntentInput | null } = {
        value: null,
      };
      const deps: ProcessSignalDeps = {
        vault: opts.vault,
        manager: opts.manager,
        jupClient,
        verifySignature,
        mapSignal,
        checkGuards: (i) => checkGuards({ ...i, caps }),
        signerAllowedPubkey: opts.signerAllowedPubkey,
        alreadySeen: (dk) => store.alreadySeen(stateAtEntry, dk),
        recordIntent: (intent) => {
          pendingIntentBox.value = intent;
        },
      };

      let result;
      try {
        result = await processSignal(env, deps);
      } catch (err) {
        logger.error("[follower] processSignal threw", err);
        summary.skippedCount += 1;
        summary.throwCount += 1;
        batchThrew = true;
        continue;
      }

      if (result.kind === "would_sign") {
        summary.wouldSignCount += 1;
        const pi = pendingIntentBox.value;
        if (paperLedger && pi && result.kind === "would_sign") {
          try {
            await paperLedger.append({
              dedupKey: pi.dedupKey,
              row: pi.row,
              marketId: pi.marketId,
              jupBuyPriceUsd: pi.row.price,
              sizeFdry: pi.sizeFdry,
              navFdry: opts.vault.navFdry,
              unsignedTxBase64: pi.unsignedTxBase64,
            });
          } catch (err) {
            logger.error("[follower] paper-ledger append failed", err);
          }
        }
        if (pi && !opts.dryRun) {
          state = store.recordIntent(state, {
            dedupKey: pi.dedupKey,
            row: pi.row,
            marketId: pi.marketId,
            sizeFdry: pi.sizeFdry,
            unsignedTxBase64: pi.unsignedTxBase64,
          });
        } else if (opts.dryRun) {
          logger.info("[follower] dry-run would_sign", {
            dedupKey: result.dedupKey,
            marketId: result.marketId,
          });
        }
      } else {
        summary.skippedCount += 1;
        logger.info("[follower] skipped", {
          dedupKey: result.dedupKey,
          reason: result.reason,
        });
      }

      state = store.beat(state, now());
      try {
        await store.save(state);
      } catch (err) {
        logger.error("[follower] state save failed (per-envelope)", err);
      }
    }

    // 3e. cursor + heartbeat after batch
    if (
      !batchThrew &&
      batch.nextCursor !== null &&
      batch.nextCursor !== state.lastCursor
    ) {
      state = store.setCursor(state, batch.nextCursor);
    } else if (batchThrew) {
      logger.warn(
        "[follower] batch had processSignal throw, holding cursor for retry",
        { heldCursor: state.lastCursor },
      );
    }
    state = store.beat(state, now());
    try {
      await store.save(state);
    } catch (err) {
      logger.error("[follower] state save failed (post-batch)", err);
    }

    if (opts.signal?.aborted) {
      logger.info("[follower] aborted post-batch");
      return summary;
    }

    await sleep(pollIntervalMs);
  }
}
