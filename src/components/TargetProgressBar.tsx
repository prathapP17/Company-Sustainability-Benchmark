import type { Progress } from "@/lib/scoring/targets";

const STATUS: Record<Progress["status"], { icon: string; text: string }> = {
  ahead: { icon: "▲", text: "Ahead of straight-line path" },
  on_track: { icon: "●", text: "On track" },
  behind: { icon: "▼", text: "Behind straight-line path" },
  not_computable: { icon: "–", text: "Progress not computable" },
};

/**
 * Achieved share of the target (bar) against the share expected by now on a
 * straight line from baseline to target year (tick). Status is icon + text,
 * never colour alone.
 */
export function TargetProgressBar({ p }: { p: Progress }) {
  const s = STATUS[p.status];
  if (p.achievedShare === null || p.expectedShare === null) {
    return (
      <div className="text-xs text-ink-muted">
        <span aria-hidden>{s.icon} </span>
        {s.text}
        {p.reason ? `: ${p.reason}` : ""}
      </div>
    );
  }
  const achieved = Math.max(0, Math.min(p.achievedShare, 100));
  const expected = Math.max(0, Math.min(p.expectedShare, 100));
  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative h-2.5 w-full rounded-r bg-[var(--hairline)]/50"
        role="img"
        aria-label={`${Math.round(p.achievedShare)}% of target achieved; ${Math.round(p.expectedShare)}% expected on a straight-line path`}
      >
        <div className="h-full rounded-r bg-[var(--series-1)]" style={{ width: `${achieved}%` }} />
        <div className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: `calc(${expected}% - 1px)` }} />
      </div>
      <div className="tabular text-xs text-ink-2">
        <span aria-hidden>{s.icon} </span>
        {s.text}: {Math.round(p.achievedShare)}% achieved vs {Math.round(p.expectedShare)}% expected (derived)
      </div>
    </div>
  );
}
