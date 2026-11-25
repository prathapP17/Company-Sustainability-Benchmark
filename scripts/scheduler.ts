/**
 * Scheduler for hosted mode (the Docker "scheduler" service; on a Mac the
 * launchd job does the refresh instead).
 *
 *   REFRESH_SCHEDULE  default "Mon 07:00"   discovery refresh (the worker service extracts)
 *   BACKUP_SCHEDULE   default "daily 03:00" snapshot backup
 *   SCHEDULE_TZ       default "UTC"
 *
 * Checks once a minute. Last-run dates are kept in data/logs/scheduler.json,
 * so a restart neither skips nor repeats a run. Missed runs (server down at
 * the time) run once when it comes back the same day.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultDataDir } from "../src/lib/data/load";
import { isDue, localParts, parseSlot } from "../src/lib/ops/schedule";

const tz = process.env.SCHEDULE_TZ || "UTC";
const tasks = [
  { name: "refresh", slot: parseSlot(process.env.REFRESH_SCHEDULE || "Mon 07:00"), args: ["tsx", "scripts/refresh.ts", "--trigger", "schedule", "--no-extract"] },
  { name: "backup", slot: parseSlot(process.env.BACKUP_SCHEDULE || "daily 03:00"), args: ["tsx", "scripts/backup.ts"] },
];
const stateFile = path.join(defaultDataDir(), "logs", "scheduler.json");
mkdirSync(path.dirname(stateFile), { recursive: true });
const state: Record<string, string> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};
const running = new Set<string>();
let stopping = false;

function run(name: string, args: string[]) {
  running.add(name);
  const date = localParts(new Date(), tz).date;
  state[name] = date; // recorded at start: a crash mid-run is not retried in a loop
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log(`[${new Date().toISOString()}] scheduler: starting ${name}`);
  const child = spawn("npx", args, { stdio: "inherit", env: process.env });
  child.on("exit", (code) => {
    running.delete(name);
    console.log(`[${new Date().toISOString()}] scheduler: ${name} finished (exit ${code})`);
  });
}

function tick() {
  if (stopping) return;
  const now = new Date();
  for (const t of tasks) if (!running.has(t.name) && isDue(t.slot, now, tz, state[t.name] ?? null)) run(t.name, t.args);
}

console.log(`[${new Date().toISOString()}] scheduler: ${tasks.map((t) => `${t.name} ${process.env[`${t.name.toUpperCase()}_SCHEDULE`] || (t.name === "refresh" ? "Mon 07:00" : "daily 03:00")}`).join(", ")} (${tz})`);
tick();
const timer = setInterval(tick, 60_000);
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    stopping = true;
    clearInterval(timer);
    console.log(`scheduler: stopping${running.size ? ` after ${[...running].join(", ")}` : ""}`);
    if (!running.size) process.exit(0);
    setInterval(() => !running.size && process.exit(0), 1000);
  });
}
