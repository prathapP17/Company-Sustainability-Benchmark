import type { Metadata } from "next";
import Link from "next/link";
import { Card, Tag } from "@/components/ui";
import { CoverageBar, CoverageLegend } from "@/components/CoverageBar";
import { listCompanies, type CompanyRow } from "@/lib/db/queries";
import { fiscalLabel } from "@/lib/fiscal";
import { industryName } from "@/lib/industry";

export const metadata: Metadata = { title: "Companies" };

function researchTag(c: CompanyRow) {
  if (c.research_status === "detailed") return <Tag>Detailed</Tag>;
  if (c.research_status === "partial") return <Tag tone="warn">Partial</Tag>;
  return <Tag tone="warn">Profile only</Tag>;
}

export default function CompaniesPage() {
  const companies = listCompanies();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Companies</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          {companies.length} operating companies. Industry is the SASB industry used for analysis; the peer group is a broad
          navigation group. Coverage counts the eight core metrics in each company&apos;s latest disclosed year.
        </p>
      </div>
      <Card id="companies" title="Disclosure coverage of core metrics" action={<CoverageLegend />}>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Companies with industry, latest year, research status and core-metric coverage</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">Company</th>
                <th scope="col" className="py-2 pr-3 font-medium">Industry (SASB)</th>
                <th scope="col" className="py-2 pr-3 font-medium">Peer group</th>
                <th scope="col" className="py-2 pr-3 font-medium">Latest year</th>
                <th scope="col" className="py-2 pr-3 font-medium">Research</th>
                <th scope="col" className="w-1/5 py-2 pr-3 font-medium">Coverage</th>
                <th scope="col" className="py-2 text-right font-medium">Disclosed</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => {
                const codes: string[] = c.sasb_codes ? JSON.parse(c.sasb_codes) : [];
                return (
                  <tr key={c.id} className="border-b border-hairline align-top last:border-0">
                    <td className="py-2.5 pr-3">
                      <Link href={`/companies/${c.id}`} className="font-medium text-accent">
                        {c.name}
                      </Link>
                      <div className="text-xs text-ink-muted">
                        {c.city}, {c.country}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-2">
                      {codes.map((k) => industryName(k)).join("; ")}
                      {c.classification_review && (
                        <div className="mt-1">
                          <Tag tone="warn" title={c.classification_review}>
                            Needs review
                          </Tag>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-ink-2">{c.peer_group_name}</td>
                    <td className="tabular py-2.5 pr-3 text-ink-2">{c.cov_year ? fiscalLabel({ end: c.fy_end, labelConvention: c.fy_label_convention }, c.cov_year) : "—"}</td>
                    <td className="py-2.5 pr-3">{researchTag(c)}</td>
                    <td className="py-2.5 pr-3">
                      <CoverageBar
                        label={`${c.name} coverage`}
                        total={c.cov_total}
                        counts={{ disclosed: c.cov_disclosed, not_disclosed: c.cov_not_disclosed, not_found: c.cov_not_found, not_assessed: c.cov_not_assessed }}
                      />
                    </td>
                    <td className="tabular py-2.5 text-right text-ink-2">
                      {c.cov_disclosed}/{c.cov_total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
