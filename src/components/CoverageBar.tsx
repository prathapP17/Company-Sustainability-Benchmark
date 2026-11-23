import { LABELS, type DisclosureState } from "@/lib/schema/enums";
import { StateSwatch } from "./ui";

const ORDER: DisclosureState[] = ["disclosed", "not_disclosed", "not_found", "not_assessed"];
const FILL: Record<DisclosureState, string> = {
  disclosed: "bg-[var(--state-disclosed)]",
  not_disclosed: "bg-[var(--state-not-disclosed)]",
  not_found: "bg-[var(--state-not-found)]",
  not_assessed: "texture-not-assessed",
};

/**
 * Stacked bar of core-metric disclosure states. Segments are separated by a
 * 2px surface gap; identity comes from the legend and the accessible label,
 * never colour alone. Hovering a segment shows its count (title tooltip).
 */
export function CoverageBar({ counts, total, label }: { counts: Record<DisclosureState, number>; total: number; label: string }) {
  const summary = ORDER.filter((s) => counts[s] > 0)
    .map((s) => `${LABELS.state[s]} ${counts[s]}`)
    .join(", ");
  return (
    <div role="img" aria-label={`${label}: ${summary} of ${total} core metrics`} className="flex h-3 w-full min-w-24 gap-[2px]">
      {ORDER.filter((s) => counts[s] > 0).map((s, i, arr) => (
        <div
          key={s}
          title={`${LABELS.state[s]}: ${counts[s]} of ${total}`}
          className={`${FILL[s]} h-full ${i === 0 ? "rounded-l" : ""} ${i === arr.length - 1 ? "rounded-r" : ""}`}
          style={{ width: `${(counts[s] / total) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function CoverageLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Disclosure states">
      {ORDER.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <StateSwatch state={s} />
          {LABELS.state[s]}
        </li>
      ))}
    </ul>
  );
}
