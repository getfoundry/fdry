import { describe, it, expect, vi } from "vitest";
import {
  fetchTriggersSinceCursor,
  triggerDedupKey,
  TriggerEventSchema,
  type TriggerEvent,
} from "./triggerSource.js";

const ROW_A: TriggerEvent = {
  v: 1,
  ts: 1778500123,
  token_id: "21202285189814573471226720134408126754666767714963331163406584149708020395832",
  upstream_slug: "lol-tes-we-2026-05-09",
  side: "NO",
  upstream_no_ask: 0.42,
  upstream_yes_current: 0.585,
  upstream_yes_pre: 0.18,
  trigger_score: 7,
  quality_bucket: "S85",
  primary_tag: "Esports",
  subcategory: "lol",
  trigger_signature: "1m,3m,5m,15m,30m,1h",
};

const ROW_B: TriggerEvent = {
  ...ROW_A,
  ts: 1778500200,
  token_id: "999",
  upstream_slug: "cs2-mouz-faze-2026-05-09",
  trigger_signature: "1m,5m,15m",
  subcategory: "cs2",
};

function bufferOf(rows: object[]): Buffer {
  return Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

describe("TriggerEventSchema", () => {
  it("accepts a fully-populated row", () => {
    expect(TriggerEventSchema.safeParse(ROW_A).success).toBe(true);
  });
  it("rejects a row missing token_id", () => {
    const bad = { ...ROW_A, token_id: "" };
    expect(TriggerEventSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a side that is not YES/NO", () => {
    const bad = { ...ROW_A, side: "MAYBE" };
    expect(TriggerEventSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects v != 1", () => {
    const bad = { ...ROW_A, v: 2 };
    expect(TriggerEventSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an empty trigger_signature (dedup integrity)", () => {
    const bad = { ...ROW_A, trigger_signature: "" };
    const result = TriggerEventSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.includes("trigger_signature"))).toBe(true);
    }
  });
});

describe("triggerDedupKey", () => {
  it("is stable for identical rows", () => {
    expect(triggerDedupKey(ROW_A)).toBe(triggerDedupKey(ROW_A));
  });
  it("differs for distinct (token_id, trigger_signature)", () => {
    expect(triggerDedupKey(ROW_A)).not.toBe(triggerDedupKey(ROW_B));
  });
  it("collapses two distinct rows that share token_id+sig", () => {
    const dup = { ...ROW_A, ts: ROW_A.ts + 999 };
    expect(triggerDedupKey(dup)).toBe(triggerDedupKey(ROW_A));
  });
});

describe("fetchTriggersSinceCursor", () => {
  it("returns absent cursor when file does not exist (ENOENT)", async () => {
    const enoent = Object.assign(new Error("nope"), { code: "ENOENT" });
    const stat = vi.fn().mockRejectedValue(enoent);
    const r = await fetchTriggersSinceCursor(null, { path: "/nope", stat });
    expect(r.rows).toHaveLength(0);
    expect(r.nextCursor).toBe("absent");
    expect(stat).toHaveBeenCalledOnce();
  });

  it("rethrows non-ENOENT stat errors", async () => {
    const eaccess = Object.assign(new Error("denied"), { code: "EACCES" });
    const stat = vi.fn().mockRejectedValue(eaccess);
    await expect(fetchTriggersSinceCursor(null, { path: "/x", stat })).rejects.toThrow();
  });

  it("reads all rows from the start when cursor is null", async () => {
    const buf = bufferOf([ROW_A, ROW_B]);
    const stat = vi.fn().mockResolvedValue({ ino: 100, size: buf.length });
    const readFile = vi.fn().mockResolvedValue(buf);
    const r = await fetchTriggersSinceCursor(null, { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.token_id).toBe(ROW_A.token_id);
    expect(r.nextCursor).toBe(`100:${buf.length}`);
    expect(r.drops).toHaveLength(0);
  });

  it("resumes from cursor offset on subsequent calls", async () => {
    const firstBuf = bufferOf([ROW_A]);
    const fullBuf = bufferOf([ROW_A, ROW_B]);
    const stat = vi.fn().mockResolvedValue({ ino: 100, size: fullBuf.length });
    const readFile = vi.fn().mockResolvedValue(fullBuf);
    const cursor = `100:${firstBuf.length}`;
    const r = await fetchTriggersSinceCursor(cursor, { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.token_id).toBe(ROW_B.token_id);
    expect(r.nextCursor).toBe(`100:${fullBuf.length}`);
  });

  it("detects rotation by inode change and resets to start", async () => {
    const buf = bufferOf([ROW_B]);
    const stat = vi.fn().mockResolvedValue({ ino: 200, size: buf.length });
    const readFile = vi.fn().mockResolvedValue(buf);
    const cursor = "100:9999"; // old inode 100, large offset
    const r = await fetchTriggersSinceCursor(cursor, { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(1); // re-read full new file
    expect(r.nextCursor).toBe(`200:${buf.length}`);
  });

  it("detects truncation (file shrunk below previous offset) and resets", async () => {
    const buf = bufferOf([ROW_A]);
    const stat = vi.fn().mockResolvedValue({ ino: 100, size: buf.length });
    const readFile = vi.fn().mockResolvedValue(buf);
    const cursor = "100:9999";
    const r = await fetchTriggersSinceCursor(cursor, { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(1);
  });

  it("drops malformed JSON lines into drops[], does not throw", async () => {
    const buf = Buffer.from(
      JSON.stringify(ROW_A) + "\n" + "{not_json" + "\n" + JSON.stringify(ROW_B) + "\n",
      "utf8",
    );
    const stat = vi.fn().mockResolvedValue({ ino: 100, size: buf.length });
    const readFile = vi.fn().mockResolvedValue(buf);
    const r = await fetchTriggersSinceCursor(null, { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(2);
    expect(r.drops).toHaveLength(1);
    expect(r.drops[0]?.reason).toBe("json_parse");
  });

  it("drops schema-failing rows into drops[]", async () => {
    const bad = { ...ROW_A, token_id: "" };
    const buf = bufferOf([bad, ROW_A]);
    const stat = vi.fn().mockResolvedValue({ ino: 100, size: buf.length });
    const readFile = vi.fn().mockResolvedValue(buf);
    const r = await fetchTriggersSinceCursor(null, { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(1);
    expect(r.drops).toHaveLength(1);
    expect(r.drops[0]?.reason).toBe("schema_fail");
  });

  it("holds back a partial-line tail (writer mid-append safety)", async () => {
    const buf = Buffer.from(
      JSON.stringify(ROW_A) + "\n" + JSON.stringify(ROW_B).slice(0, 30),
      "utf8",
    );
    const stat = vi.fn().mockResolvedValue({ ino: 100, size: buf.length });
    const readFile = vi.fn().mockResolvedValue(buf);
    const r = await fetchTriggersSinceCursor(null, { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(1); // ROW_A only; partial ROW_B not consumed
    // Cursor should advance only through the full ROW_A line
    const aLen = JSON.stringify(ROW_A).length + 1; // + newline
    expect(r.nextCursor).toBe(`100:${aLen}`);
  });

  it("returns no rows when offset already at EOF", async () => {
    const stat = vi.fn().mockResolvedValue({ ino: 100, size: 500 });
    const readFile = vi.fn().mockResolvedValue(Buffer.alloc(500));
    const r = await fetchTriggersSinceCursor("100:500", { path: "/x", stat, readFile });
    expect(r.rows).toHaveLength(0);
    expect(readFile).not.toHaveBeenCalled();
  });
});
