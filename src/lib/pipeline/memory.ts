/**
 * Available-memory probe for the worker's memory guard. os.freemem() is
 * misleading on macOS (it ignores reclaimable cache), so we read vm_stat on
 * macOS and MemAvailable from /proc/meminfo on Linux.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";

/** Parses `vm_stat` output: free + inactive + speculative + purgeable pages. */
export function parseVmStat(out: string): number | null {
  const size = Number(/page size of (\d+) bytes/.exec(out)?.[1]);
  if (!size) return null;
  const pages = (name: string) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
  const avail = pages("Pages free") + pages("Pages inactive") + pages("Pages speculative") + pages("Pages purgeable");
  return avail * size;
}

/** Parses MemAvailable (kB) from /proc/meminfo. */
export function parseMemInfo(out: string): number | null {
  const kb = /MemAvailable:\s+(\d+)\s+kB/.exec(out)?.[1];
  return kb ? Number(kb) * 1024 : null;
}

export function availableMemoryBytes(): number | null {
  try {
    if (process.platform === "darwin") return parseVmStat(execFileSync("vm_stat", { encoding: "utf8" }));
    if (process.platform === "linux") return parseMemInfo(readFileSync("/proc/meminfo", "utf8"));
  } catch {
    // fall through
  }
  return os.freemem();
}
