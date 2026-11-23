import { LABELS, type Boundary } from "@/lib/schema/enums";
import type { MetricValueRow } from "@/lib/db/queries";
import { Tag } from "./ui";

/**
 * Rule-3 context shown next to a value. Anything that limits comparability
 * (non-group boundary, partial coverage, derived, low-confidence source)
 * renders as a warning tag so it is never hidden in a tooltip.
 */
export function ContextTags({ v, compact = false }: { v: MetricValueRow; compact?: boolean }) {
  const boundary = v.boundary as Boundary;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {boundary !== "consolidated_group" && (
        <Tag tone="warn" title="Boundary differs from consolidated group; do not compare directly">
          {LABELS.boundary[boundary]}
        </Tag>
      )}
      {v.coverage && (
        <Tag tone="warn" title="Partial operational coverage">
          {v.coverage}
        </Tag>
      )}
      {v.status === "derived" && <Tag title="Simple arithmetic on reported values; method in note">Derived</Tag>}
      {v.low_confidence === 1 && <Tag tone="warn">Low confidence</Tag>}
      {!compact && v.scope2_method && <Tag>{v.scope2_method === "market" ? "Market-based" : "Location-based"}</Tag>}
    </span>
  );
}
