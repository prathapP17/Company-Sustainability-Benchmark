import type { Metadata } from "next";
import Link from "next/link";
import { Card, StateBadge, Tag } from "@/components/ui";
import { latestCells } from "@/lib/data/views";
import { listPeerGroups } from "@/lib/db/queries";
import { METRICS, metricAppliesTo } from "@/lib/metrics/dictionary";
import { LABELS } from "@/lib/labels";
import type { Boundary } from "@/lib/schema/enums";

export const metadata: Metadata = { title: "Industry KPIs" };

export default function IndustryPage() {
  const { companies, cells } = latestCells();
  const cellMap = new Map(cells.map((c) => [`${c.companyId}/${c.metricId}`, c]));
  const industry = METRICS.filter((m) => m.category === "industry");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Industry KPIs</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Industry-specific indicators from the SASB/ISSB standards, compared only within the peer group they apply to.
          Each value is the company&apos;s latest disclosed year with its source. Values on a boundary other than the
          consolidated group are flagged and should not be compared directly.
        </p>
      </div>

      {listPeerGroups().map((g) => {
        const metrics = industry.filter((m) => metricAppliesTo(m, g.id));
        const members = companies.filter((c) => c.peerGroup === g.id);
        if (!metrics.length || !members.length) return null;
        return (
          <Card key={g.id} title={g.name}>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                    <th scope="col" className="sticky left-0 z-10 bg-surface py-2 pr-3 font-medium">
                      Indicator
                    </th>
                    {members.map((c) => (
                      <th key={c.id} scope="col" className="py-2 pr-3 font-medium">
                        <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                          {c.name}
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.id} className="border-b border-hairline align-top last:border-0">
                      <th scope="row" className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left font-normal">
                        <div className="text-ink">{m.label}</div>
                        {m.sasb && <div className="text-xs text-ink-muted">SASB {m.sasb}</div>}
                      </th>
                      {members.map((c) => {
                        const v = cellMap.get(`${c.id}/${m.id}`);
                        if (!v) {
                          return (
                            <td key={c.id} className="py-2 pr-3">
                              <StateBadge state="not_assessed" />
                            </td>
                          );
                        }
                        return (
                          <td key={c.id} className="py-2 pr-3">
                            {v.state === "disclosed" ? (
                              <div className="flex flex-col gap-1">
                                <span className="tabular text-ink">{v.display}</span>
                                <span className="text-xs text-ink-muted">
                                  {v.fyLabel}
                                  {v.sourceUrl ? (
                                    <>
                                      {" · "}
                                      <a href={v.sourceUrl} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                                        {v.sourceId}
                                        {v.page ? `, ${v.page}` : ""}
                                      </a>
                                    </>
                                  ) : null}
                                </span>
                                <span className="flex flex-wrap gap-1">
                                  {v.boundary !== "consolidated_group" && <Tag tone="warn">{LABELS.boundary[v.boundary as Boundary]}</Tag>}
                                  {v.status === "derived" && <Tag>Derived</Tag>}
                                  {v.lowConfidence && <Tag tone="warn">Low confidence</Tag>}
                                </span>
                              </div>
                            ) : (
                              <StateBadge state={v.state} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
