import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { allScores, allTransparencyItems, listCompanies } from "@/lib/db/queries";
import { CHECKLIST_LABELS } from "@/lib/scoring/transparency";

export const metadata: Metadata = { title: "Transparency checklist" };

function Mark({ met, evidence }: { met: 0 | 1 | null | undefined; evidence?: string | null }) {
  if (met === 1)
    return (
      <span title={evidence ?? ""} className="text-ink">
        <span aria-hidden>✓</span>
        <span className="sr-only">Met{evidence ? `: ${evidence}` : ""}</span>
      </span>
    );
  if (met === 0)
    return (
      <span title={evidence ?? ""} className="text-ink-muted">
        <span aria-hidden>✗</span>
        <span className="sr-only">Not met{evidence ? `: ${evidence}` : ""}</span>
      </span>
    );
  return (
    <span title={evidence ?? "not assessable"} className="text-ink-muted">
      <span aria-hidden>–</span>
      <span className="sr-only">Not assessable</span>
    </span>
  );
}

export default function TransparencyPage() {
  const companies = listCompanies();
  const items = allTransparencyItems();
  const scores = new Map(allScores().map((s) => [s.company_id, s]));
  const cell = new Map(items.map((i) => [`${i.company_id}/${i.item_id}`, i]));
  const groups = [...new Set(CHECKLIST_LABELS.map((x) => x.group))];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Transparency checklist</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          {CHECKLIST_LABELS.length} items covering what each company discloses and how well it is evidenced. ✓ met, ✗ not
          met, – not assessable (excluded from the score). Hover a mark for the evidence. Scores are withheld below 80%
          coverage of the core metrics.
        </p>
      </div>
      <Card>
        <p className="mb-2 text-xs text-ink-muted sm:hidden">Scroll sideways to see every company.</p>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 160 + companies.length * 84 }}>
            <thead>
              <tr className="border-b border-hairline text-xs text-ink-muted">
                <th className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left font-medium">Item</th>
                {companies.map((c) => (
                  <th key={c.id} className="px-1 py-2 text-center font-medium">
                    <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                      {c.name}
                    </Link>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-hairline">
                <th className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left text-sm font-semibold text-ink">Score (0-100)</th>
                {companies.map((c) => {
                  const s = scores.get(c.id);
                  return (
                    <td key={c.id} className="tabular px-1 py-2 text-center">
                      {s?.transparency_score !== null && s?.transparency_score !== undefined ? (
                        <span className="font-semibold text-ink">{Math.round(s.transparency_score)}</span>
                      ) : (
                        <span className="text-xs text-ink-muted" title={s?.transparency_reason ?? ""}>
                          n/a
                        </span>
                      )}
                      <div className="text-[11px] text-ink-muted">
                        {s ? `${s.transparency_met}/${s.transparency_applicable}` : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr>
                  <th colSpan={companies.length + 1} className="sticky left-0 pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {g}
                  </th>
                </tr>
                {CHECKLIST_LABELS.filter((x) => x.group === g).map((x) => (
                  <tr key={x.id} className="border-b border-hairline last:border-0">
                    <th scope="row" className="sticky left-0 z-10 bg-surface w-40 min-w-40 py-2 pr-3 text-left font-normal text-ink-2 sm:w-auto">
                      {x.label}
                    </th>
                    {companies.map((c) => {
                      const i = cell.get(`${c.id}/${x.id}`);
                      return (
                        <td key={c.id} className="px-1 py-2 text-center">
                          <Mark met={i?.met} evidence={i?.evidence} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
    </div>
  );
}
