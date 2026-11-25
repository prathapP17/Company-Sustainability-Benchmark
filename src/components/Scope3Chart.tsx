"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Scope3Datum {
  category: number;
  label: string;
  value: number; // tCO2e
  derived: boolean;
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Approximate rendered width of a 12px system-ui label (lesson: size from the actual text). */
function labelWidth(labels: string[]): number {
  const longest = Math.max(...labels.map((l) => l.length));
  return Math.min(240, Math.ceil(longest * 6.6) + 12);
}

interface TipProps {
  active?: boolean;
  payload?: { payload: Scope3Datum }[];
}

function Tip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-hairline bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-ink">
        Cat. {d.category}: {d.label}
      </div>
      <div className="tabular text-ink-2">
        {full.format(d.value)} tCO2e{d.derived ? " (derived)" : ""}
      </div>
    </div>
  );
}

/**
 * One company's Scope 3 categories as horizontal bars (always horizontal: the
 * category names are long). Single series, so no legend; the heading names it.
 */
export function Scope3Chart({ data, companyName }: { data: Scope3Datum[]; companyName: string }) {
  const rows = [...data].sort((a, b) => b.value - a.value);
  const yWidth = labelWidth(rows.map((r) => r.label));
  const height = rows.length * 30 + 36;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div>
      {/* Narrow screens: label above each bar so long category names never squeeze the plot. */}
      <ul className="flex flex-col gap-2 sm:hidden" aria-hidden>
        {rows.map((r) => (
          <li key={r.category} title={`${full.format(r.value)} tCO2e${r.derived ? " (derived)" : ""}`}>
            <div className="flex justify-between gap-2 text-xs">
              <span className="text-ink-2">{r.label}</span>
              <span className="tabular text-ink-muted">{compact.format(r.value)}</span>
            </div>
            <div className="mt-1 h-3 w-full">
              <div
                className="h-full rounded-r bg-[var(--series-1)]"
                style={{ width: `${Math.max((r.value / max) * 100, 0.5)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div style={{ height }} className="hidden sm:block" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid horizontal={false} stroke="var(--hairline)" />
            <XAxis
              type="number"
              tickFormatter={(v: number) => compact.format(v)}
              tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={yWidth}
              tick={{ fill: "var(--ink-2)", fontSize: 12 }}
              axisLine={{ stroke: "var(--axis)" }}
              tickLine={false}
              interval={0}
            />
            <Tooltip content={<Tip />} cursor={{ fill: "var(--hairline)", opacity: 0.5 }} />
            <Bar dataKey="value" fill="var(--series-1)" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Lesson learned: the screen-reader table sits in a sized, clipped wrapper so it can never widen the page. */}
      <div className="relative w-full overflow-hidden">
        <table className="sr-only">
          <caption>{companyName} Scope 3 emissions by category (tCO2e)</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">tCO2e</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.category}>
                <th scope="row">
                  {r.category}. {r.label}
                </th>
                <td>
                  {full.format(r.value)}
                  {r.derived ? " (derived)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
