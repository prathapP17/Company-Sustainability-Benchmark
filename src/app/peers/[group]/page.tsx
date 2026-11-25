import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Card, StateBadge, Tag } from "@/components/ui";
import { ScoreBar } from "@/components/ScoreBar";
import { allScores, listPeerGroups } from "@/lib/db/queries";
import { applicableMetrics, latestCells, type CellValue } from "@/lib/data/views";
import { MIN_PEERS_FOR_MEDIAN, peerMedian } from "@/lib/scoring/peer";
import { industryName } from "@/lib/industry";
import { formatCompact } from "@/lib/format";
import { LABELS } from "@/lib/labels";
import type { Boundary } from "@/lib/schema/enums";

export function generateStaticParams() {
  return listPeerGroups().map((g) => ({ group: g.id }));
}

export async function generateMetadata({ params }: PageProps<"/peers/[group]">): Promise<Metadata> {
  const { group } = await params;
  return { title: listPeerGroups().find((g) => g.id === group)?.name ?? "Peer group not found" };
}

/** `params` is awaited inside <Suspense> so the pre-built page can be regenerated after approvals. */
export default function PeerGroupPage(props: PageProps<"/peers/[group]">) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Loading…</p>}>
      <PeerGroupContent params={props.params} />
    </Suspense>
  );
}

async function PeerGroupContent({ params }: Pick<PageProps<"/peers/[group]">, "params">) {
  const { group } = await params;
  const g = listPeerGroups().find((x) => x.id === group);
  if (!g) notFound();
  const { companies, cells } = latestCells();
  const members = companies.filter((c) => c.peerGroup === group);
  const scores = new Map(allScores().map((s) => [s.company_id, s]));
  const cellMap = new Map(cells.map((c) => [`${c.companyId}/${c.metricId}`, c]));
  // Benchmarks are per actual SASB industry inside the broad group, never across the whole group.
  const industries = [...new Set(members.flatMap((c) => c.sasbCodes))].sort();

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-xs text-ink-muted">
        <Link href="/peers" className="hover:underline">
          Peer groups
        </Link>{" "}
        / {g.name}
      </nav>
      <div>
        <h1 className="text-2xl font-semibold text-ink">{g.name}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">{g.description}</p>
        <p className="mt-1 max-w-3xl text-xs text-ink-muted">
          This is a navigation group. It contains {industries.length} SASB industr{industries.length === 1 ? "y" : "ies"} (
          {industries.map((c) => industryName(c)).join(", ")}); each is benchmarked separately below.
        </p>
      </div>

      <Card title="Scores">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th className="py-2 pr-3 font-medium">Company</th>
                <th className="w-2/5 py-2 pr-3 font-medium">Transparency (0-100)</th>
                <th className="w-2/5 py-2 font-medium">Performance (0-100)</th>
              </tr>
            </thead>
            <tbody>
              {members.map((c) => {
                const s = scores.get(c.id);
                return (
                  <tr key={c.id} className="border-b border-hairline align-top last:border-0">
                    <td className="py-2.5 pr-3">
                      <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <ScoreBar value={s?.transparency_score ?? null} label={`${c.name} transparency`} />
                      {s?.transparency_reason && <div className="mt-1 text-xs text-ink-muted">{s.transparency_reason}</div>}
                    </td>
                    <td className="py-2.5">
                      <ScoreBar value={s?.performance_score ?? null} label={`${c.name} performance`} />
                      {s?.performance_reason && <div className="mt-1 text-xs text-ink-muted">{s.performance_reason}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          How scores work: <Link href="/methodology" className="text-accent hover:underline">methodology</Link>.
        </p>
      </Card>

      {industries.map((code) => {
        const inds = members.filter((c) => c.sasbCodes.includes(code));
        const rows = applicableMetrics([code]).filter((m) => !/^ghg_scope3_c/.test(m.id));
        return (
          <Card key={code} title={`Benchmark: ${industryName(code)}`}>
            <p className="mb-3 text-xs text-ink-muted">
              Latest reported year per company. A median needs at least {MIN_PEERS_FOR_MEDIAN} values from companies whose
              confirmed primary industry is {code}, on the consolidated group, full coverage, stated and identical
              consolidation approach, the same reporting-period end year and unit, the right Scope 2 method and no
              low-confidence source. Values that fail are still shown, with the reason.
            </p>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 260 + inds.length * 150 + 200 }}>
                <caption className="sr-only">Metrics for {industryName(code)} companies in {g.name}, with peer median where available</caption>
                <thead>
                  <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                    <th scope="col" className="sticky left-0 z-10 w-36 bg-surface py-2 pr-3 font-medium sm:w-56">Metric</th>
                    {inds.map((c) => (
                      <th key={c.id} scope="col" className="py-2 pr-3 font-medium">
                        <Link href={`/companies/${c.id}`} className="text-accent hover:underline">{c.name}</Link>
                        {c.primarySasb !== code && (
                          <div className="mt-1 font-normal">
                            <Tag tone="warn" title={c.classificationReview ?? undefined}>{c.primarySasb ? `Primary ${c.primarySasb}` : "Classification needs review"}</Tag>
                          </div>
                        )}
                      </th>
                    ))}
                    <th scope="col" className="py-2 font-medium">Peer median</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => {
                    const rowCells = inds.map((c) => cellMap.get(`${c.id}/${m.id}`));
                    const disclosed = rowCells.filter((c): c is CellValue => !!c && c.state === "disclosed");
                    const stat = peerMedian(disclosed.map((d) => ({ ...d, metricId: m.id })), { industry: code });
                    const why = new Map(stat.excluded.map((e) => [e.value.companyId, e.reasons]));
                    return (
                      <tr key={m.id} className="border-b border-hairline align-top last:border-0">
                        <th scope="row" className="sticky left-0 z-10 w-36 bg-surface py-2.5 pr-3 text-left font-normal sm:w-56">
                          <div className="text-ink">{m.label}</div>
                        </th>
                        {rowCells.map((c, i) => (
                          <td key={inds[i].id} className="py-2.5 pr-3">
                            {!c ? (
                              <StateBadge state="not_assessed" />
                            ) : c.state !== "disclosed" ? (
                              <StateBadge state={c.state} />
                            ) : (
                              <>
                                <div className="tabular text-ink">{c.canonical !== null ? formatCompact(c.canonical, c.canonicalUnit) : c.display}</div>
                                <div className="text-xs text-ink-muted">{c.fyLabel}</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {c.boundary !== "consolidated_group" && <Tag tone="warn">{LABELS.boundary[c.boundary as Boundary]}</Tag>}
                                  {c.coverage && <Tag tone="warn">{c.coverage}</Tag>}
                                  {c.status === "derived" && <Tag>Derived</Tag>}
                                </div>
                                {why.has(c.companyId) && (
                                  <div className="mt-1 text-xs text-warn-ink">Not in median: {why.get(c.companyId)!.join("; ")}</div>
                                )}
                              </>
                            )}
                          </td>
                        ))}
                        <td className="py-2.5 text-xs text-ink-muted">
                          {stat.median !== null ? (
                            <>
                              <span className="tabular text-sm text-ink">{formatCompact(stat.median, stat.basis.unit)}</span>
                              <div>
                                n = {stat.n}, periods ending {stat.basis.periodYear}, {stat.basis.consolidation?.replace(/_/g, " ")}
                              </div>
                              {stat.cautions.length > 0 && <div className="text-warn-ink">{stat.cautions.join("; ")}</div>}
                            </>
                          ) : (
                            <>No median: {stat.reason}</>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
