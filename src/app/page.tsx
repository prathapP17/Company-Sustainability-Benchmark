import Link from "next/link";
import { Card, Stat, Tag } from "@/components/ui";
import { CoverageBar, CoverageLegend } from "@/components/CoverageBar";
import { MapExplorer } from "@/components/map/MapExplorer";
import { ReviewStrip } from "@/components/ReviewStrip";
import { allSources, listCompanies, totals } from "@/lib/db/queries";
import { loadCompanies } from "@/lib/data/load";
import { BASE_MAP_URL, mapGeometry } from "@/lib/map/geo";
import { mapCompanies, mapMetrics, type MapCompany } from "@/lib/map/data";
import { industryName, SASB_INDUSTRIES } from "@/lib/industry";
import { MIN_PEERS_FOR_MEDIAN } from "@/lib/scoring/peer";
import type { DisclosureState } from "@/lib/schema/enums";

const OVERVIEW_METRICS = ["ghg_scope1", "ghg_scope2_market", "ghg_scope2_location", "ghg_scope3_total", "energy_total", "renewable_electricity_share", "water_withdrawal", "waste_total"];

type Counts = Record<DisclosureState, number>;
const zero = (): Counts => ({ disclosed: 0, not_disclosed: 0, not_found: 0, not_assessed: 0 });

/** Disclosure states counted across companies (never values added across companies). */
function stateCounts(companies: MapCompany[], metric: string) {
  const counts = zero();
  let usable = 0;
  const periods = new Set<number>();
  let applies = 0;
  for (const c of companies) {
    const cell = c.cells[metric];
    if (!cell) continue;
    applies++;
    counts[cell.state]++;
    if (cell.state === "disclosed") {
      if (cell.issues.length === 0) usable++;
      if (cell.periodYear) periods.add(cell.periodYear);
    }
  }
  return { counts, usable, applies, periods: [...periods].sort() };
}

export default function Dashboard() {
  const companies = mapCompanies();
  const metrics = mapMetrics();
  const rows = listCompanies();
  const t = totals();
  const researched = rows.filter((c) => c.research_status !== "profile_only");
  const notAssessed = researched.reduce((n, c) => n + c.cov_not_assessed, 0);
  const reviewed = rows.map((c) => c.last_reviewed).sort();
  const geometry = mapGeometry(companies.filter((c) => c.pos).map((c) => c.country));

  const files = loadCompanies().companies;
  const restatements = files
    .flatMap((c) => c.metrics.flatMap((m) => (m.restatements ?? []).map((r) => ({ company: c.profile, metric: m.metric, year: m.year, r }))))
    .sort((a, b) => b.r.replacedOn.localeCompare(a.r.replacedOn))
    .slice(0, 5);
  const names = new Map(rows.map((c) => [c.id, c.name]));
  const recentSources = allSources()
    .sort((a, b) => b.accessed.localeCompare(a.accessed))
    .slice(0, 6);
  const metricLabel = new Map(metrics.map((m) => [m.id, m.label]));

  const industryCodes = Object.keys(SASB_INDUSTRIES).filter((code) => companies.some((c) => c.industries.some((i) => i.code === code)));
  const regions = [...new Set(rows.map((c) => c.region))].sort();
  const industryKpis = metrics.filter((m) => m.group === "Industry-specific");

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="overview" className="flex flex-col gap-4">
        <div>
          <h1 id="overview" className="text-2xl font-semibold text-ink">
            Sustainability disclosure benchmark
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            Reported environmental data for {t.companies} large operating companies, read from their own reports and
            filings. Every value links to its source page; gaps are shown as gaps, never as zero.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Companies" value={t.companies} hint={`in ${industryCodes.length} SASB industries`} />
          <Stat label="Researched" value={researched.length} hint={`${t.companies - researched.length} profile only`} />
          <Stat label="Disclosed values" value={t.disclosed} hint="each with source and page" />
          <Stat label="Sources" value={t.sources} hint="reports, filings, pages" />
          <Stat label="Open data gaps" value={t.gaps + notAssessed} hint={`${t.gaps} logged, ${notAssessed} core metrics not assessed`} />
          <Stat label="Last reviewed" value={reviewed.at(-1) ?? "—"} hint={`oldest company ${reviewed[0] ?? "—"}`} />
        </div>
        <ReviewStrip />
      </section>

      <Card id="map" title="Where the companies are headquartered">
        <MapExplorer geometry={geometry} baseMapUrl={BASE_MAP_URL} companies={companies} metrics={metrics} />
      </Card>

      <Card title="Sustainability overview" action={<CoverageLegend />}>
        <p className="mb-3 max-w-3xl text-xs text-ink-muted">
          How many companies disclose each metric in their latest year. No totals or averages are calculated across
          companies: their industries, fiscal years and boundaries differ. &ldquo;Usable across companies&rdquo; counts
          disclosed values on the consolidated group with full coverage and a primary or official source; peer medians
          add further checks.
        </p>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Disclosure of each core metric across companies</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Metric</th>
                <th scope="col" className="w-1/3 py-2 pr-3 font-medium">Disclosure across companies</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Disclosed</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Usable across companies</th>
                <th scope="col" className="py-2 font-medium">Periods ending</th>
              </tr>
            </thead>
            <tbody>
              {[...OVERVIEW_METRICS, ...industryKpis.map((m) => m.id)].map((id) => {
                const s = stateCounts(companies, id);
                const def = metrics.find((m) => m.id === id)!;
                return (
                  <tr key={id} className="border-b border-hairline align-top last:border-0">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">
                      {def.label}
                      {def.appliesTo !== "all" && <div className="text-xs text-ink-muted">Industry KPI · {def.appliesTo.join(", ")}</div>}
                    </th>
                    <td className="py-2.5 pr-3">
                      {s.applies ? <CoverageBar label={def.label} total={s.applies} counts={s.counts} /> : <span className="text-xs text-ink-muted">No company in these industries</span>}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-ink-2">
                      {s.counts.disclosed}/{s.applies}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right text-ink-2">{s.usable}</td>
                    <td className="tabular py-2.5 text-xs text-ink-2">{s.periods.join(", ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs">
          <Link href="/compare" className="text-accent">
            Compare values side by side
          </Link>
          {" · "}
          <Link href="/companies" className="text-accent">
            Coverage per company
          </Link>
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Industries and peer benchmarks">
          <p className="mb-3 text-xs text-ink-muted">
            Peer medians are calculated within one SASB industry and need {MIN_PEERS_FOR_MEDIAN} researched companies whose
            primary industry is confirmed.
          </p>
          <table className="w-full text-sm">
            <caption className="sr-only">Companies per SASB industry and whether a peer median is possible</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">SASB industry</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Companies</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Usable for medians</th>
                <th scope="col" className="py-2 font-medium">Median</th>
              </tr>
            </thead>
            <tbody>
              {industryCodes.map((code) => {
                const members = companies.filter((c) => c.industries.some((i) => i.code === code));
                const eligible = members.filter((c) => c.primaryIndustry === code && c.researchStatus !== "profile_only");
                return (
                  <tr key={code} className="border-b border-hairline last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">
                      {industryName(code)}
                    </th>
                    <td className="tabular py-2 pr-3 text-right">{members.length}</td>
                    <td className="tabular py-2 pr-3 text-right">{eligible.length}</td>
                    <td className="py-2 text-xs">{eligible.length >= MIN_PEERS_FOR_MEDIAN ? <Tag>Possible</Tag> : <span className="text-ink-muted">Not yet (needs {MIN_PEERS_FOR_MEDIAN})</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs">
            <Link href="/peers" className="text-accent">
              Peer benchmarks
            </Link>
            {" · "}
            <Link href="/industry" className="text-accent">
              Industry KPIs
            </Link>
          </p>
        </Card>

        <Card title="Regions and research gaps">
          <table className="w-full text-sm">
            <caption className="sr-only">Companies and core-metric coverage per headquarters region</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Region</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Companies</th>
                <th scope="col" className="w-2/5 py-2 font-medium">Core-metric states</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => {
                const list = rows.filter((c) => c.region === r);
                const counts = list.reduce<Counts>(
                  (acc, c) => ({ disclosed: acc.disclosed + c.cov_disclosed, not_disclosed: acc.not_disclosed + c.cov_not_disclosed, not_found: acc.not_found + c.cov_not_found, not_assessed: acc.not_assessed + c.cov_not_assessed }),
                  zero(),
                );
                const total = list.reduce((n, c) => n + c.cov_total, 0);
                return (
                  <tr key={r} className="border-b border-hairline last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">
                      {r}
                    </th>
                    <td className="tabular py-2 pr-3 text-right">{list.length}</td>
                    <td className="py-2">
                      <CoverageBar label={`${r} core metrics`} total={total} counts={counts} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h3 className="mt-4 text-sm font-medium text-ink">Research gaps</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-2">
            {rows
              .filter((c) => c.research_status === "profile_only")
              .map((c) => (
                <li key={c.id}>
                  <Link href={`/companies/${c.id}`} className="text-accent">
                    {c.name}
                  </Link>
                  : profile only, no metrics researched yet
                </li>
              ))}
            {rows
              .filter((c) => c.classification_review && c.research_status !== "profile_only")
              .map((c) => (
                <li key={`${c.id}-class`}>
                  <Link href={`/companies/${c.id}`} className="text-accent">
                    {c.name}
                  </Link>
                  : SASB primary industry not confirmed
                </li>
              ))}
            {researched
              .filter((c) => c.cov_not_assessed > 0)
              .map((c) => (
                <li key={`${c.id}-na`}>
                  <Link href={`/companies/${c.id}`} className="text-accent">
                    {c.name}
                  </Link>
                  : {c.cov_not_assessed} core metric{c.cov_not_assessed === 1 ? "" : "s"} not assessed
                </li>
              ))}
          </ul>
        </Card>
      </div>

      <Card title="Recent research activity">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-ink">Sources most recently checked</h3>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {recentSources.map((s) => (
                <li key={`${s.company_id}/${s.id}`}>
                  <span className="text-ink">{names.get(s.company_id)}</span>
                  <span className="text-ink-muted"> · {s.accessed}</span>
                  <div className="text-xs text-ink-2">{s.title}</div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium text-ink">Restatements recorded</h3>
            {restatements.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No restatement has been approved yet. Possible restatements found by the pipeline wait for a reviewer.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {restatements.map((x) => (
                  <li key={`${x.company.id}-${x.metric}-${x.year}-${x.r.replacedOn}`}>
                    <Link href={`/companies/${x.company.id}`} className="text-accent">
                      {x.company.name}
                    </Link>
                    <span className="text-ink-2">
                      {" "}
                      · {metricLabel.get(x.metric) ?? x.metric}, {x.year}
                    </span>
                    <div className="text-xs text-ink-muted">
                      Replaced {x.r.replacedOn}: {x.r.reason}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {t.lastSeed && <p className="text-xs text-ink-muted">Data refreshed {t.lastSeed.slice(0, 10)} from the curated company files.</p>}
    </div>
  );
}
