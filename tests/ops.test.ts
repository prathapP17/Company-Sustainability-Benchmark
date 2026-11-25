import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backupDataDir } from "@/lib/ops/backup";
import { latestSnapshot, restoreDrill } from "@/lib/ops/restore";
import { seed } from "@/lib/db/seed";
import { isDue, localParts, parseSlot } from "@/lib/ops/schedule";
import { closePipelineDbs, pipelineDb } from "@/lib/pipeline/db";
import { tempDataDir } from "./helpers";

let cleanup = () => {};
afterEach(() => {
  closePipelineDbs();
  cleanup();
});

describe("snapshot backups", () => {
  it("copies both databases consistently, the curated files, hard-links uploads, and prunes only old snapshots", async () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    const db = pipelineDb(t.dir); // migrates and writes the audit table
    db.prepare("INSERT INTO audit_log (at, actor, action, entity) VALUES ('2026-11-25T00:00:00Z', 'test', 'marker', 'x')").run();
    mkdirSync(path.join(t.dir, "uploads", "ab"), { recursive: true });
    writeFileSync(path.join(t.dir, "uploads", "ab", "abcdef.pdf"), "%PDF-1.4 fixture");
    mkdirSync(path.join(t.dir, "backups"), { recursive: true });
    writeFileSync(path.join(t.dir, "backups", "pipeline-2026-01-01T00-00-00-000Z.db"), "migration backup"); // never pruned

    for (let d = 1; d <= 4; d++) await backupDataDir(t.dir, { keep: 2, now: new Date(`2026-11-0${d}T03:00:00Z`) });
    const root = path.join(t.dir, "backups");
    const snaps = readdirSync(root).filter((n) => n.startsWith("snapshot-")).sort();
    expect(snaps).toEqual(["snapshot-2026-11-03T03-00-00-000Z", "snapshot-2026-11-04T03-00-00-000Z"]);
    expect(existsSync(path.join(root, "pipeline-2026-01-01T00-00-00-000Z.db"))).toBe(true);

    const snap = path.join(root, snaps[1]);
    const copy = new Database(path.join(snap, "pipeline.db"), { readonly: true });
    expect(copy.prepare("SELECT count(*) n FROM audit_log WHERE action = 'marker'").get()).toEqual({ n: 1 });
    copy.close();
    expect(readdirSync(path.join(snap, "companies")).length).toBe(readdirSync(path.join(t.dir, "companies")).length);
    expect(existsSync(path.join(snap, "discovery.json"))).toBe(true);
    // Hard link: same inode as the original upload.
    expect(statSync(path.join(snap, "uploads", "ab", "abcdef.pdf")).ino).toBe(statSync(path.join(t.dir, "uploads", "ab", "abcdef.pdf")).ino);
  });
});

describe("restore drill", () => {
  it("passes a good snapshot and catches a corrupted upload, without touching the live folder", async () => {
    const t = tempDataDir();
    cleanup = t.cleanup;
    seed(t.dir);
    pipelineDb(t.dir).prepare("INSERT INTO audit_log (at, actor, action, entity) VALUES ('2026-11-25T00:00:00Z', 'test', 'marker', 'x')").run();
    const body = "%PDF-1.4 drill fixture";
    const sha = (await import("node:crypto")).createHash("sha256").update(body).digest("hex");
    mkdirSync(path.join(t.dir, "uploads", sha.slice(0, 2)), { recursive: true });
    writeFileSync(path.join(t.dir, "uploads", sha.slice(0, 2), `${sha}.pdf`), body);
    await backupDataDir(t.dir, { keep: 3 });
    const snap = latestSnapshot(t.dir)!;
    const good = restoreDrill(snap);
    expect(good.ok).toBe(true);
    expect(good.checks.map((c) => c.name)).toEqual(["pipeline.db", "benchmark.db", "company files", "re-seed", "uploads"]);

    // Corrupt the snapshot's copy only (it is a hard link, so replace the file rather than write through it).
    const copy = path.join(snap, "uploads", sha.slice(0, 2), `${sha}.pdf`);
    (await import("node:fs")).rmSync(copy);
    writeFileSync(copy, "tampered");
    const bad = restoreDrill(snap);
    expect(bad.ok).toBe(false);
    expect(bad.checks.find((c) => c.name === "uploads")!.detail).toMatch(/1 do not match/);
    expect(readdirSync(path.join(t.dir, "uploads", sha.slice(0, 2)))).toEqual([`${sha}.pdf`]); // live upload untouched
  });
});

describe("scheduler timing", () => {
  it("parses slots and runs each once per local day after its time", () => {
    const mon = parseSlot("Mon 07:00");
    expect(mon).toEqual({ weekday: 1, hour: 7, minute: 0 });
    expect(() => parseSlot("Monday 7am")).toThrow();
    // 2026-11-23 is a Monday.
    expect(isDue(mon, new Date("2026-11-23T06:59:00Z"), "UTC", null)).toBe(false);
    expect(isDue(mon, new Date("2026-11-23T07:00:00Z"), "UTC", null)).toBe(true);
    expect(isDue(mon, new Date("2026-11-23T18:00:00Z"), "UTC", "2026-11-23")).toBe(false); // already ran today
    expect(isDue(mon, new Date("2026-11-24T07:00:00Z"), "UTC", "2026-11-23")).toBe(false); // Tuesday
    expect(isDue(mon, new Date("2026-11-30T07:30:00Z"), "UTC", "2026-11-23")).toBe(true); // next Monday
    const daily = parseSlot("daily 03:00");
    expect(isDue(daily, new Date("2026-11-25T03:01:00Z"), "UTC", "2026-11-24")).toBe(true);
  });

  it("evaluates the slot in the configured time zone", () => {
    // 07:00 Monday in Kolkata is 01:30 UTC.
    expect(localParts(new Date("2026-11-23T01:30:00Z"), "Asia/Kolkata")).toMatchObject({ date: "2026-11-23", weekday: 1, hour: 7, minute: 0 });
    expect(isDue(parseSlot("Mon 07:00"), new Date("2026-11-23T01:30:00Z"), "Asia/Kolkata", null)).toBe(true);
    expect(isDue(parseSlot("Mon 07:00"), new Date("2026-11-23T01:29:00Z"), "Asia/Kolkata", null)).toBe(false);
  });
});
