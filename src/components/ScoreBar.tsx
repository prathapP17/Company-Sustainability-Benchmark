/** A 0-100 score as a thin bar with the value at its tip. Single series: no legend. */
export function ScoreBar({ value, label, muted = false }: { value: number | null; label: string; muted?: boolean }) {
  if (value === null) return <span className="text-xs text-ink-muted">Not scored</span>;
  return (
    <div className="flex items-center gap-2" role="img" aria-label={`${label}: ${value} out of 100`}>
      <div className="h-2.5 flex-1 rounded-r bg-[var(--hairline)]/50">
        <div
          className={`h-full rounded-r ${muted ? "bg-[var(--state-not-found)]" : "bg-[var(--series-1)]"}`}
          style={{ width: `${Math.max(Math.min(value, 100), 1)}%` }}
        />
      </div>
      <span className="tabular w-10 text-right text-sm text-ink">{Math.round(value)}</span>
    </div>
  );
}
