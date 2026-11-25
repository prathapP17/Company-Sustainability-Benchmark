/**
 * CLI: validate every curated company file against the schema and the
 * non-negotiable data rules. Exits 1 on any error (warnings are printed).
 *
 *   npm run validate
 */
import { loadCompanies } from "../src/lib/data/load";
import { coverageFor } from "../src/lib/data/coverage";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defaultDataDir } from "../src/lib/data/load";
import { SbtiFile } from "../src/lib/sbti/schema";

const { companies, issues } = loadCompanies();
const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warning");

for (const i of issues) {
  console.log(`${i.level.toUpperCase().padEnd(7)} ${i.file} ${i.path}: ${i.message}`);
}

console.log("\nCoverage of core metrics (latest disclosed year):");
for (const c of companies) {
  const cov = coverageFor(c);
  console.log(
    `  ${c.profile.id.padEnd(10)} ${c.researchStatus.padEnd(13)} year ${String(cov.year ?? "-").padEnd(5)} ` +
      `disclosed ${cov.counts.disclosed}/${cov.total}, assessed ${cov.assessed}/${cov.total}`,
  );
}

// Reference data: the SBTi extract must parse, and only name companies in the benchmark.
const sbtiFile = path.join(defaultDataDir(), "sbti.json");
if (existsSync(sbtiFile)) {
  const r = SbtiFile.safeParse(JSON.parse(readFileSync(sbtiFile, "utf8")));
  if (!r.success) errors.push({ level: "error", file: "sbti.json", path: "", message: r.error.message.slice(0, 500) } as (typeof issues)[number]);
  else {
    const ids = new Set(companies.map((c) => c.profile.id));
    for (const id of Object.keys(r.data.companies)) {
      if (!ids.has(id)) errors.push({ level: "error", file: "sbti.json", path: id, message: "not a company in the benchmark" } as (typeof issues)[number]);
    }
    console.log(`\nSBTi extract: ${Object.keys(r.data.companies).length} companies, data as of ${r.data.source.dataAsOf}`);
  }
}
for (const e of errors.filter((x) => x.file === "sbti.json")) console.log(`ERROR   ${e.file} ${e.path}: ${e.message}`);

console.log(`\n${companies.length} companies, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
