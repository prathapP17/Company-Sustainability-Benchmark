"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CellValue, CompanyMeta, MetricMeta } from "@/lib/data/views";
import { compareSet, rankable, type ComparabilityLevel } from "@/lib/scoring/comparability";
import { formatCompact } from "@/lib/format";
import { LABELS } from "@/lib/labels";
import type { Boundary } from "@/lib/schema/enums";
import { Tag } from "./ui";

const TOPICS: { id: string; label: string; match: (m: MetricMeta) => boolean }[] = [
  { id: "emissions", label: "Emissions", match: (m) => m.category === "emissions" && !/^ghg_scope3_c/.test(m.id) },
  { id: "scope3", label: "Scope 3 categories", match: (m) => /^ghg_scope3_c/.test(m.id) },
  { id: "energy", label: "Energy", match: (m) => m.category === "energy" },
  { id: "water", label: "Water", match: (m) => m.category === "water" },
  { id: "waste", label: "Waste", match: (m) => m.category === "waste" },
  { id: "industry", label: "Industry (SASB)", match: (m) => m.category === "industry" },
];

const LEVEL_TEXT: Record<ComparabilityLevel, string> = {
  comparable: "Comparable",
  caution: "Compare with caution",
  not_comparable: "Not directly comparable",
};

function CellTags({ c }: { c: CellValue }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {c.boundary !== "consolidated_group" && <Tag tone="warn">{LABELS.boundary[c.boundary as Boundary]}</Tag>}
      {c.coverage && <Tag tone="warn">{c.coverage}</Tag>}
      {c.status === "derived" && <Tag>Derived</Tag>}
      {c.lowConfidence && <Tag tone="warn">Low confidence</Tag>}
    </span>
  );
}

export function CompareView({ companies, metrics, cells }: { companies: CompanyMeta[]; metrics: MetricMeta[]; cells: CellValue[] }) {
  const researched = companies.filter((c) => c.researchStatus !== "profile_only").map((c) => c.id);
  const [selected, setSelected] = useState<string[]>(researched);
  const [topic, setTopic] = useState("emissions");
  const [chartMetric, setChartMetric] = useState("ghg_scope1");

  const cellMap = useMemo(() => new Map(cells.map((c) => [`${c.companyId}/${c.metricId}`, c])), [cells]);
  const chosen = companies.filter((c) => selected.includes(c.id));
  const rows = metrics.filter((m) => TOPICS.find((t) => t.id === topic)!.match(m));
  const visibleRows = rows.filter((m) => chosen.some((c) => cellMap.has(`${c.id}/${m.id}`)));

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const chartable = metrics.filter((m) => cells.some((c) => c.metricId === m.id && c.canonical !== null));
  const bars = chosen
    .map((co) => ({ co, cell: cellMap.get(`${co.id}/${chartMetric}`) }))
    .filter((b): b is { co: CompanyMeta; cell: CellValue } => !!b.cell && b.cell.state === "disclosed" && b.cell.canonical !== null)
    .sort((a, b) => b.cell.canonical! - a.cell.canonical!);
  const max = Math.max(1, ...bars.map((b) => b.cell.canonical!));
  const chartSet = compareSet(bars.map((b) => ({ ...b.cell })));
  const chartMeta = metrics.find((m) => m.id === chartMetric);

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="rounded-xl border border-hairline bg-surface p-4">
        <legend className="px-1 text-sm font-medium text-ink">Companies</legend>
        <div className="flex flex-wrap gap-2">
          {companies.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.id)}
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-accent bg-accent text-[var(--on-accent)]" : "border-hairline text-ink-2 hover:border-ink-muted"}`}
              >
                {on && <span aria-hidden>✓ </span>}
                {c.name}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <button type="button" className="text-accent hover:underline" onClick={() => setSelected(researched)}>
            All researched
          </button>
          <button type="button" className="text-accent hover:underline" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      </fieldset>

      <section className="rounded-xl border border-hairline bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Values side by side</h2>
          <div role="tablist" aria-label="Topic" className="flex flex-wrap gap-1">
            {TOPICS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={topic === t.id}
                onClick={() => setTopic(t.id)}
                className={`rounded px-2 py-1 text-xs ${topic === t.id ? "bg-ink text-surface" : "text-ink-2 hover:bg-[var(--hairline)]"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {chosen.length === 0 ? (
          <p className="text-sm text-ink-muted">Select at least one company.</p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-ink-muted">No values recorded for this topic for the selected companies.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 150 + chosen.length * 150 }}>
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                  <th className="sticky left-0 z-10 bg-surface w-36 py-2 pr-3 font-medium sm:w-56">Metric</th>
                  {chosen.map((c) => (
                    <th key={c.id} className="py-2 pr-3 font-medium">
                      <Link href={`/companies/${c.id}`} className="text-accent hover:underline">
                        {c.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((m) => {
                  const rowCells = chosen.map((c) => cellMap.get(`${c.id}/${m.id}`));
                  const disclosed = rowCells.filter((c): c is CellValue => !!c && c.state === "disclosed" && c.canonical !== null);
                  const comp = disclosed.length >= 2 ? compareSet(disclosed) : null;
                  return (
                    <tr key={m.id} className="border-b border-hairline align-top last:border-0">
                      <th scope="row" className="sticky left-0 z-10 bg-surface w-36 py-2.5 pr-3 text-left font-normal sm:w-56">
                        <div className="text-ink">{m.label}</div>
                        {comp && (
                          <div className="mt-1 text-xs">
                            {comp.level === "comparable" ? (
                              <span className="text-ink-muted">{LEVEL_TEXT.comparable}</span>
                            ) : (
                              <Tag tone="warn" title={comp.reasons.join("; ")}>
                                {LEVEL_TEXT[comp.level]}
                              </Tag>
                            )}
                            {comp.level !== "comparable" && <div className="mt-1 text-ink-muted">{comp.reasons.join("; ")}</div>}
                          </div>
                        )}
                        {disclosed.length >= 2 && new Set(disclosed.map((d) => d.year)).size > 1 && (
                          <div className="mt-1 text-xs text-ink-muted">Reporting years differ.</div>
                        )}
                      </th>
                      {rowCells.map((c, i) => (
                        <td key={chosen[i].id} className="py-2.5 pr-3">
                          {!c ? (
                            <span className="text-ink-muted">Not assessed</span>
                          ) : c.state !== "disclosed" ? (
                            <span className="text-ink-muted">
                              {LABELS.state[c.state]} <span className="text-xs">· {c.fyLabel}</span>
                            </span>
                          ) : (
                            <>
                              <div className="tabular text-ink">{c.display}</div>
                              <div className="text-xs text-ink-muted">
                                {c.fyLabel}
                                {c.sourceUrl && (
                                  <>
                                    {" · "}
                                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                                      {c.page ?? "source"}
                                    </a>
                                  </>
                                )}
                              </div>
                              <CellTags c={c} />
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-hairline bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Chart one metric</h2>
          <label className="flex items-center gap-2 text-xs text-ink-2">
            Metric
            <select
              value={chartMetric}
              onChange={(e) => setChartMetric(e.target.value)}
              className="max-w-[16rem] rounded border border-hairline bg-surface px-2 py-1 text-sm text-ink"
            >
              {chartable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {bars.length === 0 ? (
          <p className="text-sm text-ink-muted">No disclosed values for this metric among the selected companies.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-ink-muted">
              {chartMeta?.label}, converted to {chartMeta?.canonicalUnit}. Hatched bars marked ⚠ are not on a
              consolidated-group boundary or cover only part of operations: shown for reference, not for ranking.
              {chartSet.level !== "comparable" && ` (${chartSet.reasons.join("; ")}.)`}
            </p>
            <ul className="flex flex-col gap-2.5">
              {bars.map(({ co, cell }) => {
                const ok = rankable(cell).ok;
                return (
                  <li key={co.id} title={`${co.name}: ${cell.display} (${cell.fyLabel})`}>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-ink-2">
                        {!ok && <span aria-label="not comparable">⚠ </span>}
                        {co.name} <span className="text-ink-muted">· {cell.fyLabel}</span>
                      </span>
                      <span className="tabular text-ink">{formatCompact(cell.canonical, cell.canonicalUnit)}</span>
                    </div>
                    <div className="mt-1 h-3 w-full">
                      <div
                        className={`h-full rounded-r ${ok ? "bg-[var(--series-1)]" : "texture-not-assessed"}`}
                        style={{ width: `${Math.max((cell.canonical! / max) * 100, 0.5)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
