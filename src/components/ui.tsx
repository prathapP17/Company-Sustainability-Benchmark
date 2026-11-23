import type { ReactNode } from "react";
import { LABELS, type DisclosureState } from "@/lib/schema/enums";

export function Card({ title, children, id, action }: { title?: string; children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      {title && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const STATE_SWATCH: Record<DisclosureState, string> = {
  disclosed: "bg-[var(--state-disclosed)]",
  not_disclosed: "bg-[var(--state-not-disclosed)]",
  not_found: "bg-[var(--state-not-found)]",
  not_assessed: "texture-not-assessed",
};

export function StateSwatch({ state }: { state: DisclosureState }) {
  return <span aria-hidden className={`inline-block size-2.5 shrink-0 rounded-sm ${STATE_SWATCH[state]}`} />;
}

export function StateBadge({ state }: { state: DisclosureState }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2">
      <StateSwatch state={state} />
      {LABELS.state[state]}
    </span>
  );
}

export function Tag({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "warn"; title?: string }) {
  const cls =
    tone === "warn"
      ? "bg-warn-bg text-warn-ink"
      : "bg-[var(--hairline)]/60 text-ink-2";
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {tone === "warn" && <span aria-hidden>⚠</span>}
      {children}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}
