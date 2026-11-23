import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Tag } from "@/components/ui";
import { ScoreBar } from "@/components/ScoreBar";
import { allScores, listPeerGroups } from "@/lib/db/queries";
import { applicableMetrics, latestCells } from "@/lib/data/views";
import { compareSet } from "@/lib/scoring/comparability";
import { peerMedian } from "@/lib/scoring/peer";
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

export default async function PeerGroupPage({ params }: PageProps<"/peers/[group]">) {
  const { group } = await params;
  const g = listPeerGroups().find((x) => x.id === group);
  if (!g) notFound();
  const { companies, cells } = latestCells();
  const members = companies.filter((c) => c.peerGroup === group);
  const scores = new Map(allScores().map((s) => [s.company_id, s]));
  const cellMap = new Map(cells.map((c) => [`${c.companyId}/${c.metricId}`, c]));
  const rows = applicableMetrics(group).filter((m) => !/^ghg_scope3_c/.test(m.id));

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

      <Card title="Metrics side by side">
        <p className="mb-3 text-xs text-ink-muted">
          Latest reported year for each company. Peer median needs at least three comparable values (consolidated
          group, full coverage, same unit).
        </p>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 260 + members.length * 140 + 140 }}>
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                <th className="sticky left-0 z-10 bg-surface w-36 py-2 pr-3 font-medium sm:w-56">Metric</th>
                {members.map((c) => (
                  <th key={c.id} className="py-2 pr-3 font-medium">
                    {c.name}
                  </th>
                ))}
                <th className="py-2 font-medium">Peer median</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const rowCells = members.map((c) => cellMap.get(`${c.id}/${m.id}`));
                const disclosed = rowCells.filter((c) => c && c.state === "disclosed" && c.canonical !== null).map((c) => c!);
                const comp = disclosed.length >= 2 ? compareSet(disclosed) : null;
                const stat = peerMedian(disclosed);
                return (
                  <tr key={m.id} className="border-b border-hairline align-top last:border-0">
                    <th scope="row" className="sticky left-0 z-10 bg-surface w-36 py-2.5 pr-3 text-left font-normal sm:w-56">
                      <div className="text-ink">{m.label}</div>
                      {comp && comp.level !== "comparable" && (
                        <div className="mt-1">
                          <Tag tone="warn" title={comp.reasons.join("; ")}>
                            {comp.level === "caution" ? "Caution" : "Not directly comparable"}
                          </Tag>
                        </div>
                      )}
                    </th>
                    {rowCells.map((c, i) => (
                      <td key={members[i].id} className="py-2.5 pr-3">
                        {!c ? (
                          <span className="text-ink-muted">Not assessed</span>
                        ) : c.state !== "disclosed" ? (
                          <span className="text-ink-muted">{LABELS.state[c.state]}</span>
                        ) : (
                          <>
                            <div className="tabular text-ink">
                              {c.canonical !== null ? formatCompact(c.canonical, c.canonicalUnit) : c.display}
                            </div>
                            <div className="text-xs text-ink-muted">{c.fyLabel}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {c.boundary !== "consolidated_group" && <Tag tone="warn">{LABELS.boundary[c.boundary as Boundary]}</Tag>}
                              {c.coverage && <Tag tone="warn">{c.coverage}</Tag>}
                              {c.status === "derived" && <Tag>Derived</Tag>}
                            </div>
                          </>
                        )}
                      </td>
                    ))}
                    <td className="py-2.5 text-xs text-ink-muted">
                      {stat.median !== null ? (
                        <span className="tabular text-sm text-ink">{formatCompact(stat.median, disclosed[0]?.canonicalUnit ?? null)}</span>
                      ) : (
                        <>— {stat.reason ? `(${stat.reason})` : ""}</>
                      )}
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
