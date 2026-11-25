import { Tag } from "@/components/ui";
import { AMBITION_LABEL, ambitionOf, percentOf, type Ambition } from "@/lib/scoring/ambition";
import type { SbtiFile } from "@/lib/sbti/schema";
import type { SbtiEntry } from "@/lib/sbti/load";

export function AmbitionTag({ a }: { a: Ambition }) {
  const tone = a.status === "below_wb2c" ? "warn" : "neutral";
  return (
    <span title={a.reason ?? `Implied linear reduction ${a.ratePerYear}% of base-year emissions per year`}>
      <Tag tone={tone}>
        {AMBITION_LABEL[a.status]}
        {a.ratePerYear !== null ? ` · ${a.ratePerYear.toFixed(1)}%/yr` : ""}
      </Tag>
    </span>
  );
}

function SourceLine({ sbti }: { sbti: SbtiFile }) {
  return (
    <p className="text-xs text-ink-muted">
      Source:{" "}
      <a href={sbti.source.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
        SBTi Target Dashboard
      </a>{" "}
      (data as of {sbti.source.dataAsOf ?? "unknown"}, downloaded {sbti.source.downloaded}). Reference data from SBTi, shown
      beside the company&apos;s own statements.
    </p>
  );
}

/** SBTi status and target rows for one company, with our pace check for absolute targets. */
export function SbtiPanel({ entry, sbti, claimsValidated }: { entry: SbtiEntry; sbti: SbtiFile | null; claimsValidated: boolean }) {
  if (entry.kind === "not_checked" || !sbti) return <p className="text-sm text-ink-muted">SBTi status not assessed.</p>;
  if (entry.kind === "not_found") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-2">Not found in the SBTi Target Dashboard.</p>
        {claimsValidated && <p className="text-xs text-warn-ink">The company describes a target as SBTi-validated, but it is not in the dashboard.</p>}
        <SourceLine sbti={sbti} />
      </div>
    );
  }
  const c = entry.company;
  const removed = [c.nearTerm.status, c.longTerm.status, c.netZero.status].some((s) => /removed/i.test(s ?? ""));
  const rows: [string, string | null, string | null, string | null][] = [
    ["Near-term", c.nearTerm.status, c.nearTerm.classification, c.nearTerm.year],
    ["Long-term", c.longTerm.status, c.longTerm.classification, c.longTerm.year],
    ["Net-zero", c.netZero.status, null, c.netZero.year],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map(([label, status, cls, year]) => (
          <div key={label} className="rounded border border-hairline p-2">
            <div className="text-xs text-ink-muted">{label}</div>
            <div className="text-sm text-ink">{status ?? "None"}</div>
            {(cls || year) && <div className="text-xs text-ink-2">{[cls, year].filter(Boolean).join(" · ")}</div>}
          </div>
        ))}
      </div>
      {removed && (
        <p className="text-xs text-warn-ink">
          SBTi lists a commitment as removed{c.statusReason ? ` (${c.statusReason.toLowerCase()})` : ""}.
          {claimsValidated ? " Check the company's own claims of SBTi validation against this." : ""}
        </p>
      )}
      {c.targets.length > 0 && (
        <ul className="flex flex-col gap-2">
          {c.targets.map((t) => {
            const a = ambitionOf({
              category: "emissions",
              type: t.type === "Absolute" && t.subType === "Reduction" ? "absolute" : t.type === "Intensity" ? "intensity" : t.type === "Net-zero" ? "net_zero" : "other",
              baselineYear: t.baseYear,
              targetYear: t.targetYear,
              reductionPct: percentOf(t.value),
              unit: t.value,
            });
            return (
              <li key={t.rowId} className="text-xs text-ink-2">
                <div className="flex flex-wrap items-center gap-1">
                  <Tag>{t.horizon}</Tag>
                  {t.scope && <Tag>Scope {t.scope}</Tag>}
                  {t.classification && <Tag>SBTi: {t.classification}</Tag>}
                  {a.status !== "not_assessable" && <AmbitionTag a={a} />}
                </div>
                {t.wording && <p className="mt-1 text-ink-2">{t.wording}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <SourceLine sbti={sbti} />
    </div>
  );
}
