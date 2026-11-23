/**
 * CLI: validate every curated company file against the schema and the
 * non-negotiable data rules. Exits 1 on any error (warnings are printed).
 *
 *   npm run validate
 */
import { loadCompanies } from "../src/lib/data/load";
import { coverageFor } from "../src/lib/data/coverage";

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

console.log(`\n${companies.length} companies, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
