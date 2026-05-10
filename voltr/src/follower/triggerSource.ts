/**
 * follower/triggerSource.ts — read ~/.fdry/triggers.ndjson into typed
 * TriggerEvent rows for runFollower's fetchSinceCursor adapter.
 *
 * Producer contract: bridge-source/docs/TRIGGER_SCHEMA.md
 *
 * Replaces the older signed-envelope path (signal.ts pollOnce, KV ndjson).
 * Trust model: filesystem (~/.fdry/ chmod 700, same user). No ed25519.
 *
 * Cursor is a byte offset into the current file. On rotation the file
 * inode/size shrinks; we detect that and reset to 0.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { z } from "zod";

export const TRIGGER_FILE_DEFAULT = `${homedir()}/.fdry/triggers.ndjson`;

export const TriggerSideSchema = z.enum(["NO", "YES"]);
export type TriggerSide = z.infer<typeof TriggerSideSchema>;

export const TriggerEventSchema = z.object({
  v: z.literal(1),
  ts: z.number().int().nonnegative(),
  token_id: z.string().min(1),
  upstream_slug: z.string().min(1),
  side: TriggerSideSchema,
  upstream_no_ask: z.number().min(0).max(1),
  upstream_yes_current: z.number().min(0).max(1),
  upstream_yes_pre: z.number().min(0).max(1),
  trigger_score: z.number().int().min(0).max(20),
  quality_bucket: z.string().min(1),
  primary_tag: z.string(),
  subcategory: z.string(),
  trigger_signature: z.string().min(1),
});
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;

export type TriggerSourceCursor = string; // "<inode>:<byte_offset>" — opaque

export type TriggerBatch = {
  rows: TriggerEvent[];
  nextCursor: TriggerSourceCursor;
  drops: { reason: string; line: string }[]; // schema-fail lines, never thrown
};

export type TriggerSourceOptions = {
  path?: string;
  // Injectable for tests:
  readFile?: (path: string) => Promise<Buffer>;
  stat?: (path: string) => Promise<{ ino: number; size: number }>;
};

const FILE_NOT_FOUND_CURSOR = "absent";

function parseCursor(c: TriggerSourceCursor | null): { ino: number; offset: number } | null {
  if (!c || c === FILE_NOT_FOUND_CURSOR) return null;
  const [ino, off] = c.split(":");
  const i = Number(ino);
  const o = Number(off);
  if (!Number.isFinite(i) || !Number.isFinite(o)) return null;
  return { ino: i, offset: o };
}

function makeCursor(ino: number, offset: number): TriggerSourceCursor {
  return `${ino}:${offset}`;
}

/**
 * Tail the trigger file from the previous cursor. Pure with respect to disk
 * state apart from a single read — no writes, no locks. Callers may invoke
 * this every poll tick.
 *
 * Returns `{ rows: [], nextCursor: "absent" }` when the file does not exist
 * yet (no triggers fired). Resets cursor on rotation (inode change or
 * file shrunk below previous offset).
 */
export async function fetchTriggersSinceCursor(
  cursor: TriggerSourceCursor | null,
  opts: TriggerSourceOptions = {},
): Promise<TriggerBatch> {
  const path = opts.path ?? TRIGGER_FILE_DEFAULT;
  const statFn = opts.stat ?? (async (p) => {
    const s = await fs.stat(p);
    return { ino: s.ino, size: s.size };
  });
  const readFn = opts.readFile ?? ((p) => fs.readFile(p));

  let st: { ino: number; size: number };
  try {
    st = await statFn(path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { rows: [], nextCursor: FILE_NOT_FOUND_CURSOR, drops: [] };
    }
    throw e;
  }

  const prev = parseCursor(cursor);
  // Rotation detection: inode changed OR file shrunk below previous offset.
  const isRotated = !!prev && (prev.ino !== st.ino || st.size < prev.offset);
  const startOffset = !prev || isRotated ? 0 : prev.offset;

  if (startOffset >= st.size) {
    return { rows: [], nextCursor: makeCursor(st.ino, st.size), drops: [] };
  }

  const buf = await readFn(path);
  const slice = buf.subarray(startOffset).toString("utf8");
  const lines = slice.split("\n");
  // Last fragment may be a partial line if writer is mid-append; hold it back
  // by only consuming up to the last newline boundary.
  let consumedBytes = 0;
  const completeLines: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const ln = lines[i];
    completeLines.push(ln ?? "");
    consumedBytes += Buffer.byteLength(ln ?? "", "utf8") + 1; // +1 for \n
  }

  const rows: TriggerEvent[] = [];
  const drops: { reason: string; line: string }[] = [];
  for (const raw of completeLines) {
    const line = raw.trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      drops.push({ reason: "json_parse", line: line.slice(0, 200) });
      continue;
    }
    const parsed = TriggerEventSchema.safeParse(obj);
    if (!parsed.success) {
      drops.push({ reason: "schema_fail", line: line.slice(0, 200) });
      continue;
    }
    rows.push(parsed.data);
  }

  const nextOffset = startOffset + consumedBytes;
  return { rows, nextCursor: makeCursor(st.ino, nextOffset), drops };
}

/**
 * Per-row stable dedup key. Mirrors the producer's seen-set keying.
 * Used by FollowerStore.alreadySeen.
 */
export function triggerDedupKey(t: TriggerEvent): string {
  return `${t.token_id}::${t.trigger_signature}`;
}
