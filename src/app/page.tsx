import Link from "next/link";
import { Card, Stat, Tag } from "@/components/ui";
import { CoverageBar, CoverageLegend } from "@/components/CoverageBar";
import { ContextTags } from "@/components/ContextTags";
import { latestValues, listCompanies, totals, type CompanyRow, type MetricValueRow } from "@/lib/db/queries";
import { fiscalLabel } from "@/lib/fiscal";
import { formatCompact } from "@/lib/format";

const HEADLINE = ["ghg_scope1", "ghg_scope2_market", "ghg_scope3_total"] as const;
const HEADLINE_LABEL: Record<(typeof HEADLINE)[number], string> = {
  ghg_scope1: "Scope 1",
  ghg_scope2_market: "Scope 2 (market)",
  ghg_scope3_total: "Scope 3",
};
const REGIONS = ["Americas", "Europe", "South Asia", "Asia-Pacific", "Middle East & Africa"];

function researchTag(c: CompanyRow) {
  if (c.research_status === "detailed") return <Tag>Detailed</Tag>;
  if (c.research_status === "partial") return <Tag tone="warn">Partial</Tag>;
  return <Tag tone="warn">Profile only</Tag>;
}

function HeadlineCell({ v }: { v: MetricValueRow | undefined }) {
  if (!v) return <span className="text-ink-muted">Not assessed</span>;
  if (v.state !== "disclosed") return <span className="text-ink-muted">{v.state === "not_disclosed" ? "Not disclosed" : "Not found"}</span>;
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="tabular text-ink">{formatCompact(v.canonical_value, v.canonical_unit)}</span>
      <ContextTags v={v} compact />
    </span>
  );
}

export default function Dashboard() {
  const companies = listCompanies();
  const t = totals();
  const values = latestValues([...HEADLINE]);
  const byCompany = new Map<string, Map<string, MetricValueRow>>();
  for (const v of values) {
    if (!byCompany.has(v.company_id)) byCompany.set(v.company_id, new Map());
    // Prefer the consolidated value if a company has two boundaries for the same metric.
    const m = byCompany.get(v.company_id)!;
    const prev = m.get(v.metric_id);
    if (!prev || (prev.boundary !== "consolidated_group" && v.boundary === "consolidated_group")) m.set(v.metric_id, v);
  }
  const researched = companies.filter((c) => c.research_status !== "profile_only").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Sustainability disclosure benchmark</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Phase 1: {companies.length} operating companies across five industry peer groups, read from their latest
          sustainability reports and regulatory filings. Comparisons, scores and exports come in phase 2.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Companies" value={t.companies} hint={`${researched} researched in detail`} />
        <Stat label="Disclosed values" value={t.disclosed} hint="Each with source and page" />
        <Stat label="Sources" value={t.sources} />
        <Stat label="Logged data gaps" value={t.gaps} hint="Ambiguous or blocked, not recorded" />
      </div>

      <Card id="companies" title="Disclosure coverage of core metrics" action={<CoverageLegend />}>
        <p className="mb-3 text-xs text-ink-muted">
          Eight core metrics per company in its latest disclosed year: Scope 1, Scope 2 (market and location), Scope 3,
          energy, renewable electricity, water withdrawal and waste.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th className="py-2 pr-3 font-medium">Company</th>
                <th className="py-2 pr-3 font-medium">Peer group</th>
                <th className="py-2 pr-3 font-medium">Latest year</th>
                <th className="py-2 pr-3 font-medium">Research</th>
                <th className="w-1/4 py-2 pr-3 font-medium">Coverage</th>
                <th className="py-2 text-right font-medium">Disclosed</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-hairline last:border-0">
                  <td className="py-2.5 pr-3">
                    <Link href={`/companies/${c.id}`} className="font-medium text-accent hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-ink-muted">{c.country}</div>
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">{c.peer_group_name}</td>
                  <td className="tabular py-2.5 pr-3 text-ink-2">
                    {c.cov_year ? fiscalLabel({ end: c.fy_end, labelConvention: c.fy_label_convention }, c.cov_year) : "—"}
                  </td>
                  <td className="py-2.5 pr-3">{researchTag(c)}</td>
                  <td className="py-2.5 pr-3">
                    <CoverageBar
                      label={`${c.name} coverage`}
                      total={c.cov_total}
                      counts={{
                        disclosed: c.cov_disclosed,
                        not_disclosed: c.cov_not_disclosed,
                        not_found: c.cov_not_found,
                        not_assessed: c.cov_not_assessed,
                      }}
                    />
                  </td>
                  <td className="tabular py-2.5 text-right text-ink-2">
                    {c.cov_disclosed}/{c.cov_total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Headline emissions, latest reported year">
        <p className="mb-3 text-xs text-ink-muted">
          Shown side by side, not ranked. ⚠ tags mark values that are not directly comparable (different boundary or
          partial coverage). Fiscal years differ by company.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th className="py-2 pr-3 font-medium">Company</th>
                <th className="py-2 pr-3 font-medium">Year</th>
                {HEADLINE.map((m) => (
                  <th key={m} className="py-2 pr-3 text-right font-medium last:pr-0">
                    {HEADLINE_LABEL[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const row = byCompany.get(c.id);
                return (
                  <tr key={c.id} className="border-b border-hairline align-top last:border-0">
                    <td className="py-2.5 pr-3">
                      <Link href={`/companies/${c.id}`} className="font-medium text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="tabular py-2.5 pr-3 text-ink-2">
                      {c.cov_year ? fiscalLabel({ end: c.fy_end, labelConvention: c.fy_label_convention }, c.cov_year) : "—"}
                    </td>
                    {HEADLINE.map((m) => (
                      <td key={m} className="py-2.5 pr-3 text-right last:pr-0">
                        <HeadlineCell v={row?.get(m)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Companies by headquarters region">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {REGIONS.map((r) => {
            const list = companies.filter((c) => c.region === r);
            if (!list.length) return null;
            return (
              <div key={r}>
                <h3 className="text-sm font-medium text-ink">
                  {r} <span className="text-ink-muted">({list.length})</span>
                </h3>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {list.map((c) => (
                    <li key={c.id}>
                      <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                        {c.name}
                      </Link>
                      <span className="text-ink-muted">
                        {" "}
                        · {c.city}, {c.country}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      {t.lastSeed && <p className="text-xs text-ink-muted">Database seeded {t.lastSeed.slice(0, 10)} from curated company files.</p>}
    </div>
  );
}
