import type { Metadata } from "next";
import Link from "next/link";
import { Card, StateBadge } from "@/components/ui";
import { latestCells, type CellValue } from "@/lib/data/views";
import { listPeerGroups } from "@/lib/db/queries";
import { SCOPE3_NAMES } from "@/lib/metrics/dictionary";
import { LABELS } from "@/lib/labels";
import type { DisclosureState } from "@/lib/schema/enums";

export const metadata: Metadata = { title: "Scope 3 heatmap" };

const CATS = Object.keys(SCOPE3_NAMES).map(Number);

const FILL: Record<DisclosureState, string> = {
  disclosed: "bg-[var(--state-disclosed)] text-[var(--on-state-disclosed)]",
  not_disclosed: "bg-[var(--state-not-disclosed)]",
  not_found: "bg-[var(--state-not-found)]",
  not_assessed: "texture-not-assessed",
};

/** Share of the company's own Scope 3 total, only when year and boundary match (derived). */
function shareOf(cell: CellValue, total: CellValue | undefined): number | null {
  if (!total || total.state !== "disclosed" || cell.state !== "disclosed") return null;
  if (cell.year !== total.year || cell.boundary !== total.boundary) return null;
  if (cell.canonical === null || total.canonical === null || total.canonical <= 0) return null;
  if (cell.canonicalUnit !== total.canonicalUnit) return null;
  return (cell.canonical / total.canonical) * 100;
}

export default function Scope3Page() {
  const { companies, cells } = latestCells();
  const cellMap = new Map(cells.map((c) => [`${c.companyId}/${c.metricId}`, c]));
  const groups = listPeerGroups();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Scope 3 heatmap</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Which of the 15 GHG Protocol Scope 3 categories each company reports, in its latest disclosed year. Numbers in
          a cell are that category&apos;s share of the company&apos;s own reported Scope 3 total, a derived figure shown only when
          the category and the total have the same year and boundary. Shares are not compared across companies: category
          methods differ between companies.
        </p>
      </div>

      <div className="flex flex-wrap gap-4" aria-label="Legend">
        {(["disclosed", "not_disclosed", "not_found", "not_assessed"] as DisclosureState[]).map((s) => (
          <StateBadge key={s} state={s} />
        ))}
        <span className="text-xs text-ink-muted">Blank: no value recorded (treated as not assessed)</span>
      </div>

      <Card>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[920px] border-separate border-spacing-[2px] text-xs">
            <caption className="sr-only">Scope 3 categories reported per company</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left font-medium text-ink-muted">
                  Company
                </th>
                {CATS.map((n) => (
                  <th key={n} scope="col" title={SCOPE3_NAMES[n]} className="w-12 py-2 text-center font-medium text-ink-muted">
                    {n}
                  </th>
                ))}
                <th scope="col" className="py-2 pl-2 text-right font-medium text-ink-muted">
                  Reported
                </th>
              </tr>
            </thead>
            {groups.map((g) => {
              const members = companies.filter((c) => c.peerGroup === g.id);
              if (!members.length) return null;
              return (
                <tbody key={g.id}>
                  <tr>
                    <th colSpan={CATS.length + 2} scope="colgroup" className="sticky left-0 bg-surface pt-3 pb-1 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                      {g.name}
                    </th>
                  </tr>
                  {members.map((c) => {
                    const total = cellMap.get(`${c.id}/ghg_scope3_total`);
                    let reported = 0;
                    return (
                      <tr key={c.id}>
                        <th scope="row" className="sticky left-0 z-10 bg-surface py-1 pr-3 text-left font-normal">
                          <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                            {c.name}
                          </Link>
                        </th>
                        {CATS.map((n) => {
                          const cell = cellMap.get(`${c.id}/ghg_scope3_c${n}`);
                          const state: DisclosureState = cell?.state ?? "not_assessed";
                          if (state === "disclosed") reported++;
                          const share = cell ? shareOf(cell, total) : null;
                          const tip = cell
                            ? `${SCOPE3_NAMES[n]}: ${LABELS.state[state]}${cell.state === "disclosed" ? ` · ${cell.display} · ${cell.fyLabel}` : ""}${share !== null ? ` · ${share.toFixed(1)}% of reported Scope 3` : ""}${cell.sourceId ? ` · source ${cell.sourceId}${cell.page ? `, ${cell.page}` : ""}` : ""}`
                            : `${SCOPE3_NAMES[n]}: no value recorded`;
                          return (
                            <td key={n} title={tip} className={`tabular h-8 rounded-[4px] text-center align-middle ${FILL[state]}`}>
                              <span className="sr-only">{tip}</span>
                              {share !== null ? <span aria-hidden>{share < 1 ? "<1" : Math.round(share)}%</span> : null}
                            </td>
                          );
                        })}
                        <td className="tabular py-1 pl-2 text-right text-ink-2">{reported}/15</td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      </Card>

      <Card title="Categories">
        <ol className="grid gap-x-6 gap-y-1 text-sm text-ink-2 sm:grid-cols-2 lg:grid-cols-3">
          {CATS.map((n) => (
            <li key={n}>
              <span className="tabular text-ink-muted">{n}.</span> {SCOPE3_NAMES[n]}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
