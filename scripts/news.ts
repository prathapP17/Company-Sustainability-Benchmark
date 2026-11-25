/**
 * Search GDELT for recent news and controversy items per company (free API,
 * no account). New items wait for review on /review/news.
 *
 *   npm run news                    # all companies (about 6 s per company)
 *   npm run news -- --company apple
 */
import { defaultDataDir } from "../src/lib/data/load";
import { pipelineDb } from "../src/lib/pipeline/db";
import { fetchNews } from "../src/lib/news/gdelt";

const args = process.argv.slice(2);
const companies = args.flatMap((a, i) => (a === "--company" ? [args[i + 1]] : []));
const dataDir = defaultDataDir();
fetchNews(pipelineDb(dataDir), dataDir, { companies: companies.length ? companies : undefined, log: (m) => console.log(`  ${m}`) })
  .then((s) => {
    console.log(`news: ${s.found} articles found, ${s.added} new waiting for review`);
    for (const e of s.errors) console.log(`  error: ${e}`);
  })
  .catch((e) => {
    console.error(`news failed: ${(e as Error).message}`);
    process.exit(1);
  });
