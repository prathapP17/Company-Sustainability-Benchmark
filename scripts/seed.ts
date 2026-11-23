/**
 * CLI: seed data/benchmark.db from data/companies/*.json.
 *   npm run seed            (uses ./data, or CSI_DATA_DIR if set)
 */
import { defaultDataDir } from "../src/lib/data/load";
import { seed } from "../src/lib/db/seed";

try {
  const r = seed(defaultDataDir());
  console.log(`Seeded ${r.companies} companies, ${r.metricValues} metric values → ${r.dbFile}`);
  if (r.backup) console.log(`Backup before migration: ${r.backup}`);
  if (r.removedCompanies.length) console.log(`Removed companies no longer in data/: ${r.removedCompanies.join(", ")}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
