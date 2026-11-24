/**
 * Background worker for the extraction pipeline.
 *
 *   npm run worker            # run until stopped (Ctrl+C finishes the current job)
 *   npm run worker -- --once  # process every due job, then exit (tests, cron)
 *
 * Features: atomic job claims, per-job time-outs, heartbeats, stuck-job
 * recovery, retries with backoff, and a memory guard that pauses claiming
 * when available memory is low (vm_stat on macOS, MemAvailable on Linux).
 */
import { existsSync } from "node:fs";
import os from "node:os";
import { defaultDataDir } from "../src/lib/data/load";
import { pipelineDb, audit } from "../src/lib/pipeline/db";
import { claim, complete, fail, heartbeat, recoverStuck } from "../src/lib/pipeline/queue";
import { JOB_TIMEOUT_MS, runJob } from "../src/lib/pipeline/jobs";
import { availableMemoryBytes } from "../src/lib/pipeline/memory";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const ONCE = process.argv.includes("--once");
const MIN_FREE_BYTES = Number(process.env.WORKER_MIN_FREE_MB ?? 512) * 1024 * 1024;
const POLL_MS = 2_000;
const HEARTBEAT_MS = 10_000;
const STALE_MS = 2 * 60_000;
const workerId = `${os.hostname()}:${process.pid}`;

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`\n${sig}: finishing the current job, then exiting (press again to force).`);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

async function main() {
  const dataDir = defaultDataDir();
  const db = pipelineDb(dataDir);
  console.log(`worker ${workerId} on ${dataDir}${ONCE ? " (--once)" : ""}`);
  audit(db, "worker", "worker_start", "worker", workerId, { once: ONCE });
  let lastRecovery = 0;

  while (!stopping) {
    if (Date.now() - lastRecovery > 30_000) {
      const n = recoverStuck(db, STALE_MS);
      if (n) console.log(`recovered ${n} stuck job(s)`);
      lastRecovery = Date.now();
    }

    const free = availableMemoryBytes();
    if (free !== null && free < MIN_FREE_BYTES) {
      console.log(`memory guard: ${Math.round(free / 1024 / 1024)} MB available < ${MIN_FREE_BYTES / 1024 / 1024} MB; waiting`);
      if (ONCE) break;
      await sleep(10_000);
      continue;
    }

    const job = claim(db, workerId);
    if (!job) {
      if (ONCE) {
        // Jobs waiting on a retry backoff are still "queued" in the future; wait for them in --once mode.
        const next = db.prepare("SELECT min(run_after) t FROM jobs WHERE status = 'queued'").get() as { t: string | null };
        if (!next.t) break;
        await sleep(Math.max(100, Math.min(10_000, new Date(next.t).getTime() - Date.now())));
        continue;
      }
      await sleep(POLL_MS);
      continue;
    }

    console.log(`job ${job.id} ${job.kind} doc ${job.document_id} (attempt ${job.attempts}/${job.max_attempts})`);
    const beat = setInterval(() => heartbeat(db, job.id), HEARTBEAT_MS);
    try {
      const msg = await withTimeout(runJob(db, dataDir, job), JOB_TIMEOUT_MS[job.kind]);
      complete(db, job.id);
      console.log(`  done: ${msg}`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      fail(db, job, err);
      console.log(`  failed: ${err}`);
    } finally {
      clearInterval(beat);
    }
  }
  audit(db, "worker", "worker_stop", "worker", workerId);
  console.log("worker stopped");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
