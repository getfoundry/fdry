/**
 * follower/cli.ts — Day 6 entrypoint for the bridge-source → fdry follower.
 *
 * Slice G of Day 6. Owns: argv parsing, env loading, structured logging,
 * smoke-test path (--once + --dry-run + no KV URL → exit 0 cleanly), and
 * the call into runFollower (slice F) as a black box.
 *
 * Day 7 TODO: replace the env-stubbed vault numbers (NAV / deployed / pnl)
 * with a real on-chain Voltr vault read.
 */

import { runFollower, type RunFollowerLogger } from "./runFollower.js";
import { dedupKey, type SignedSignalEnvelope, type SignalRow } from "./signal.js";
import {
  fetchTriggersSinceCursor,
  TRIGGER_FILE_DEFAULT,
  type TriggerEvent,
} from "./triggerSource.js";

// ---------- logger
function fmt(extra?: unknown): string {
  if (extra === undefined) return "";
  if (extra && typeof extra === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
      parts.push(`${k}=${JSON.stringify(v)}`);
    }
    return parts.length ? " " + parts.join(" ") : "";
  }
  return " " + String(extra);
}

const log: RunFollowerLogger = {
  info: (m, e) => console.info(`[follower] ${m}${fmt(e)}`),
  warn: (m, e) => console.warn(`[follower] WARN ${m}${fmt(e)}`),
  error: (m, e) => console.error(`[follower] ERROR ${m}${fmt(e)}`),
};

// ---------- argv
interface CliArgs {
  dryRun: boolean;
  storePath: string;
  once: boolean;
  paperLedgerPath: string | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let dryRun = false;
  let once = false;
  let storePath = "./.follower-state.json";
  let paperLedgerPath: string | null = null;
  let paperLedgerExplicitlyDisabled = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--once") once = true;
    else if (a === "--store-path") {
      const next = argv[i + 1];
      if (!next) throw new Error("--store-path requires a value");
      storePath = next;
      i++;
    } else if (a === "--paper-ledger") {
      const next = argv[i + 1];
      if (!next) throw new Error("--paper-ledger requires a value");
      paperLedgerPath = next;
      i++;
    } else if (a === "--no-paper-ledger") {
      paperLedgerExplicitlyDisabled = true;
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  // Default: if dryRun and not explicitly disabled, write to ~/.fdry/paper-trades.ndjson.
  if (dryRun && paperLedgerPath === null && !paperLedgerExplicitlyDisabled) {
    paperLedgerPath = `${process.env.HOME}/.fdry/paper-trades.ndjson`;
  }
  return { dryRun, storePath, once, paperLedgerPath };
}

// ---------- env
interface EnvBundle {
  jupApiKey?: string;
  signerPubkey?: string;
  managerKeypairPath?: string;
  kvUrl?: string;
  vaultPda?: string;
  managerPubkey?: string;
  vault: {
    navFdry: number;
    deployedFdry: number;
    dayPnlFdry: number;
    cumPnlFdry: number;
  };
}

function readNum(name: string, raw: string | undefined, fallback: string): number {
  const src = raw ?? fallback;
  const n = Number(src);
  if (!Number.isFinite(n)) {
    throw new Error(`env ${name}=${JSON.stringify(src)} is not a finite number`);
  }
  return n;
}

function readEnv(env: NodeJS.ProcessEnv): EnvBundle {
  return {
    jupApiKey: env.JUP_PREDICTION_API_KEY,
    signerPubkey: env.BRIDGE_SIGNER_PUBKEY,
    managerKeypairPath: env.MANAGER_KEYPAIR_PATH,
    kvUrl: env.KV_LIVE_SIGNALS_URL,
    vaultPda: env.FDRY_VAULT_PDA,
    managerPubkey: env.FDRY_MANAGER_PUBKEY,
    // Day 7 TODO: wire these to an on-chain Voltr vault read.
    vault: {
      navFdry: readNum("FDRY_VAULT_NAV_FDRY", env.FDRY_VAULT_NAV_FDRY, "1000000"),
      deployedFdry: readNum("FDRY_VAULT_DEPLOYED_FDRY", env.FDRY_VAULT_DEPLOYED_FDRY, "0"),
      dayPnlFdry: readNum("FDRY_VAULT_DAY_PNL_FDRY", env.FDRY_VAULT_DAY_PNL_FDRY, "0"),
      cumPnlFdry: readNum("FDRY_VAULT_CUM_PNL_FDRY", env.FDRY_VAULT_CUM_PNL_FDRY, "0"),
    },
  };
}

// ---------- fetcher adapters
type FetchSinceCursor = (
  cursor: string | null,
) => Promise<{ rows: SignedSignalEnvelope[]; nextCursor: string | null }>;

function emptyFetcher(): FetchSinceCursor {
  return async (cursor) => ({ rows: [], nextCursor: cursor });
}

// DEAD AS OF DAY 6 BRIDGE: legacy daemon-signal NDJSON path. Replaced by
// triggerFileFetcher (~/.fdry/triggers.ndjson) wired by triggers_emit.py.
// Still reachable when FDRY_TRIGGER_SOURCE=kv or (auto + KV_LIVE_SIGNALS_URL set).
// boot.ts and boot.test.ts still validate KV_LIVE_SIGNALS_URL, so removing this
// requires also pruning that env from boot's checks. Candidate for next cleanup loop.
function kvNdjsonFetcher(kvUrl: string): FetchSinceCursor {
  // DEAD AS OF DAY 6 BRIDGE: this KV-signal NDJSON path was the daemon-signal
  // era; the trigger-source bridge (~/.fdry/triggers.ndjson) is now the canonical
  // upstream. This function remains live only for `FDRY_TRIGGER_SOURCE=kv`
  // callers and is gated by the boot.ts KV_LIVE_SIGNALS_URL env check (+1
  // dedicated test in boot.test.ts). Prune candidate for the next cleanup loop.
  return async (cursor) => {
    const res = await fetch(kvUrl);
    if (!res.ok) throw new Error(`KV fetch ${res.status} ${res.statusText}`);
    const text = await res.text();
    const rows: SignedSignalEnvelope[] = [];
    let nextCursor = cursor;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let env: SignedSignalEnvelope;
      try {
        env = JSON.parse(trimmed) as SignedSignalEnvelope;
      } catch (err) {
        log.warn("bad ndjson line", { err: String(err) });
        continue;
      }
      if (!env || !env.row) {
        log.warn("ndjson line missing envelope.row");
        continue;
      }
      const k = dedupKey(env.row);
      if (cursor && k <= cursor) continue;
      rows.push(env);
      if (!nextCursor || k > nextCursor) nextCursor = k;
    }
    return { rows, nextCursor };
  };
}

/**
 * Project a TriggerEvent (upstream-market detector → fdry follower bridge) into a
 * SignedSignalEnvelope shape so the existing runFollower wiring can consume
 * it without changes. Bridge spec: bridge-source/docs/TRIGGER_SCHEMA.md.
 *
 * The signature/signer fields are placeholders (trust is filesystem-level
 * via ~/.fdry/ chmod 700 and same-uid; ed25519 verification is bypassed by
 * the caller passing a `verifySignature` stub that returns true).
 */
function triggerToEnvelope(t: TriggerEvent): SignedSignalEnvelope {
  const row: SignalRow = {
    v: 1,
    ts: new Date(t.ts * 1000).toISOString(),
    action: "open",
    slug: t.upstream_slug,
    side: t.side,
    token_id: t.token_id,
    price: t.upstream_no_ask,
    size_usd: 0, // sizing is done by the follower's checkGuards from vault NAV
    size_shares: 0,
    evm_tx: `trigger:${t.trigger_signature}`, // synthetic; not a real EVM tx
    order_id: `${t.token_id}::${t.trigger_signature}`,
    quality_bucket: t.quality_bucket,
    paper: false,
  };
  return {
    row,
    sig: "filesystem-trust", // placeholder; verifySignature stub honors filesystem trust
    signer: "bridge-source:triggers_emit.py",
  };
}

// FDRY_ALLOWED_TAGS — case-insensitive allowlist that triggers must match
// against EITHER primary_tag OR subcategory. Default is sports + esports
// taxonomy: anything outside this set drops with reason "tag_disabled".
// Operator can override via env: FDRY_ALLOWED_TAGS=sports,esports,foo
//
// Default rationale: M2 paper-trade weekend wants only sports/esports while
// the broader strategy/whitelist policy for politics/crypto/economics is
// still under decision. Keep the universe narrow to learn faster.
const DEFAULT_ALLOWED_TAGS = [
  "sports", "esports",
  // sports subcats (lowercase, partial — extend in env if missed)
  "mlb", "nba", "nfl", "nhl", "ufc", "boxing", "soccer", "football",
  "tennis", "golf", "nascar", "f1", "cricket", "rugby", "mma",
  "champions-league", "ucl", "epl", "premier-league",
  // esports subcats
  "lol", "cs2", "csgo", "val", "valorant", "dota", "dota2",
  "rocket-league", "starcraft", "overwatch", "rainbow-six", "apex",
];

function parseAllowedTags(env: NodeJS.ProcessEnv): Set<string> {
  const raw = env.FDRY_ALLOWED_TAGS?.trim();
  const list = raw && raw.length > 0
    ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED_TAGS;
  return new Set(list);
}

function isTagAllowed(t: TriggerEvent, allowed: Set<string>): boolean {
  const pt = (t.primary_tag ?? "").toLowerCase().trim();
  const sc = (t.subcategory ?? "").toLowerCase().trim();
  return allowed.has(pt) || allowed.has(sc);
}

function triggerFileFetcher(path: string, allowedTags: Set<string>): FetchSinceCursor {
  return async (cursor) => {
    const batch = await fetchTriggersSinceCursor(cursor, { path });
    if (batch.drops.length) {
      for (const d of batch.drops) log.warn("trigger drop", d);
    }
    const kept: TriggerEvent[] = [];
    for (const r of batch.rows) {
      if (isTagAllowed(r, allowedTags)) {
        kept.push(r);
      } else {
        log.warn("trigger drop", {
          reason: "tag_disabled",
          primary_tag: r.primary_tag,
          subcategory: r.subcategory,
          token_id: r.token_id,
        });
      }
    }
    return {
      rows: kept.map(triggerToEnvelope),
      nextCursor: batch.nextCursor,
    };
  };
}

// ---------- main
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseArgs(argv);
  log.info("starting", { dryRun: args.dryRun, once: args.once, storePath: args.storePath });

  const e = readEnv(env);

  // FDRY_TRIGGER_SOURCE selects upstream:
  //   - "file" → ~/.fdry/triggers.ndjson (upstream-market detector bridge, default if no KV)
  //   - "kv"   → KV_LIVE_SIGNALS_URL (legacy daemon-signal path)
  //   - "auto" → file when KV unset, kv otherwise
  // FDRY_TRIGGER_FILE overrides the default file path.
  const triggerSource = (env.FDRY_TRIGGER_SOURCE ?? "auto").toLowerCase();
  const triggerFile = env.FDRY_TRIGGER_FILE ?? TRIGGER_FILE_DEFAULT;
  const useTriggerFile =
    triggerSource === "file" ||
    (triggerSource === "auto" && !e.kvUrl);

  // Smoke-test path: --once + --dry-run + no live source available
  const isSmoke = args.once && args.dryRun && !e.kvUrl && !useTriggerFile;
  if (isSmoke) {
    log.info("smoke-path: no KV_LIVE_SIGNALS_URL or trigger file; driving runFollower with empty fetcher to prove wiring");
  } else if (useTriggerFile) {
    log.info("trigger source: file", { path: triggerFile });
  } else if (e.kvUrl) {
    log.info("trigger source: kv", { url: e.kvUrl });
  }

  if (!args.dryRun) {
    if (!e.jupApiKey) throw new Error("JUP_PREDICTION_API_KEY required (live mode)");
    if (!e.managerKeypairPath) throw new Error("MANAGER_KEYPAIR_PATH required (live mode)");
    if (!useTriggerFile && !e.kvUrl) throw new Error("FDRY_TRIGGER_FILE or KV_LIVE_SIGNALS_URL required (live mode)");
    if (!e.vaultPda) throw new Error("FDRY_VAULT_PDA required (live mode)");
    if (!e.managerPubkey) throw new Error("FDRY_MANAGER_PUBKEY required (live mode)");
  }

  const allowedTags = parseAllowedTags(env);
  log.info("tag allowlist", { count: allowedTags.size, source: env.FDRY_ALLOWED_TAGS ? "env" : "default" });

  const fetchSinceCursor: FetchSinceCursor = useTriggerFile
    ? triggerFileFetcher(triggerFile, allowedTags)
    : e.kvUrl
      ? kvNdjsonFetcher(e.kvUrl)
      : emptyFetcher();

  // --once: abort after the first poll iteration completes.
  const ac = new AbortController();
  const sleepImpl: ((ms: number) => Promise<void>) | undefined = args.once
    ? () => {
        ac.abort();
        return Promise.resolve();
      }
    : undefined;

  const summary = await runFollower({
    storePath: args.storePath,
    paperLedgerPath: args.paperLedgerPath ?? undefined,
    jupApiKey: e.jupApiKey ?? "",
    signerAllowedPubkey: e.signerPubkey ?? "filesystem-trust",
    vault: {
      pda: e.vaultPda ?? "",
      navFdry: e.vault.navFdry,
      deployedFdry: e.vault.deployedFdry,
      dayPnlFdry: e.vault.dayPnlFdry,
      cumPnlFdry: e.vault.cumPnlFdry,
    },
    manager: { pubkey: e.managerPubkey ?? "" },
    fetchSinceCursor,
    dryRun: args.dryRun,
    // Filesystem-trust verification when reading from the trigger file:
    // triggerToEnvelope sets sig="filesystem-trust" as the placeholder.
    // Trust comes from ~/.fdry/ chmod 700 + same-uid, not crypto.
    // Without this override, signal.ts:verifySignature() always returns
    // false (TODO stub), so every trigger gets dropped at gate #1 with
    // reason "bad_signature" — paper-ledger code is unreachable.
    // Day-5 lost sheep #5 caught this; this is the fix.
    verifySignature: useTriggerFile
      ? (env) => env.sig === "filesystem-trust"
      : undefined,
    logger: log,
    signal: ac.signal,
    sleep: sleepImpl,
  });

  log.info("done", {
    iterations: summary.iterations,
    rowsProcessed: summary.rowsProcessed,
    wouldSignCount: summary.wouldSignCount,
    skippedCount: summary.skippedCount,
    haltedAt: summary.haltedAt,
  });

  if (isSmoke) {
    const bootOk = !summary.haltedAt || !summary.haltedAt.reason.startsWith("boot_failed");
    log.info("smoke-path: wiring proven", {
      runBoot: bootOk ? "ok" : `failed (${summary.haltedAt?.reason ?? "unknown"})`,
      killSwitchChecked: bootOk && summary.iterations > 0,
      followerStoreConstructed: bootOk,
      processSignalReady: bootOk,
    });
  }

  return 0;
}
// ---------- entrypoint
const isDirectRun = (() => {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("cli.ts") || entry.endsWith("cli.js");
})();

if (isDirectRun) {
  main(process.argv.slice(2), process.env)
    .then((code) => process.exit(code))
    .catch((err) => {
      if (err instanceof Error && err.stack) {
        process.stderr.write(err.stack + "\n");
      } else {
        process.stderr.write(String(err) + "\n");
      }
      process.exit(1);
    });
}
