import type { Metadata } from "next";
import Link from "next/link";
import { Card, Stat, Tag } from "@/components/ui";
import { TargetProgressBar } from "@/components/TargetProgressBar";
import { allSources, allTargets, listCompanies } from "@/lib/db/queries";
import { progressFromRow } from "@/lib/scoring/targets";
import { titleCase } from "@/lib/format";
import { AmbitionTag, SbtiPanel } from "@/components/Sbti";
import { ambitionOf, PATHWAY_RATES } from "@/lib/scoring/ambition";
import { loadSbti, sbtiFor } from "@/lib/sbti/load";

export const metadata: Metadata = { title: "Targets and progress" };

const VALIDATION: Record<string, string> = {
  sbti_validated: "SBTi validated",
  self_declared: "Self-declared",
  not_stated: "Validation not stated",
};

export default function TargetsPage() {
  const targets = allTargets();
  const sources = new Map(allSources().map((s) => [`${s.company_id}/${s.id}`, s]));
  const sbti = loadSbti();
  const withProgress = targets.map((t) => ({
    t,
    p: progressFromRow(t),
    a: ambitionOf({ category: t.category, type: t.type, baselineYear: t.baseline_year, targetYear: t.target_year, reductionPct: t.target_value, unit: t.target_unit }),
  }));
  const computable = withProgress.filter((x) => x.p.status !== "not_computable");
  const byCompany = new Map<string, typeof withProgress>();
  for (const x of withProgress) {
    if (!byCompany.has(x.t.company_name)) byCompany.set(x.t.company_name, []);
    byCompany.get(x.t.company_name)!.push(x);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Targets and progress</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Each company&apos;s stated targets. Where the company reports progress in the same unit as the target, progress is
          compared with a straight line from the baseline year to the target year. Absolute emissions targets also get a
          pace check: the implied linear yearly reduction against SBTi&apos;s near-term minimums ({PATHWAY_RATES["1.5C"]}% a year for
          1.5 °C, {PATHWAY_RATES.WB2C}% for well-below 2 °C). Both are our derived assessments, not the company&apos;s; the pace
          check ignores coverage and time-frame rules that SBTi validation also applies. SBTi&apos;s own status comes from
          its public Target Dashboard.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Targets recorded" value={targets.length} />
        <Stat label="SBTi validated" value={targets.filter((t) => t.validation === "sbti_validated").length} />
        <Stat label="Net-zero goals" value={targets.filter((t) => t.type === "net_zero").length} />
        <Stat label="Progress computable" value={computable.length} hint="Same-unit progress reported" />
        <Stat
          label="Near-term validated (SBTi)"
          value={sbti ? Object.values(sbti.companies).filter((c) => !("notFound" in c) && /validated/i.test(c.nearTerm.status ?? "")).length : "–"}
          hint={sbti ? `SBTi dashboard, ${sbti.source.dataAsOf}` : "SBTi data not imported"}
        />
      </div>

      {[...byCompany.entries()].map(([name, list]) => (
        <Card key={name} title={name} action={<Link href={`/companies/${list[0].t.company_id}`} className="text-sm text-accent hover:underline">Company page →</Link>}>
          <ul className="flex flex-col gap-4">
            {list.map(({ t, p, a }) => {
              const src = sources.get(`${t.company_id}/${t.source_id}`);
              return (
                <li key={t.id} className="border-b border-hairline pb-4 last:border-0 last:pb-0">
                  <div className="text-sm text-ink">{t.description}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Tag>{titleCase(t.category)}</Tag>
                    <Tag>{titleCase(t.type)}</Tag>
                    {t.scopes && <Tag>Scopes {(JSON.parse(t.scopes) as string[]).join(", ")}</Tag>}
                    <Tag tone={t.validation === "sbti_validated" ? "neutral" : "warn"}>{VALIDATION[t.validation]}</Tag>
                    {a.status !== "not_assessable" && <AmbitionTag a={a} />}
                  </div>
                  <div className="tabular mt-2 grid gap-1 text-xs text-ink-muted sm:grid-cols-3">
                    <span>Baseline: {t.baseline_year ?? "not stated"}{t.baseline_value !== null ? ` (${t.baseline_value} ${t.baseline_unit ?? ""})` : ""}</span>
                    <span>Target: {t.target_year}{t.target_value !== null ? ` · ${t.target_value} ${t.target_unit ?? ""}` : ""}</span>
                    <span>Latest: {t.latest_year ? `${t.latest_year} · ${t.latest_value} ${t.latest_unit ?? ""}` : "not reported"}</span>
                  </div>
                  <div className="mt-2 max-w-xl">
                    <TargetProgressBar p={p} />
                  </div>
                  <div className="mt-1 text-xs text-ink-muted">
                    Source:{" "}
                    {src ? (
                      <a href={src.url} className="text-accent hover:underline" target="_blank" rel="noreferrer">
                        {t.source_id}, {t.page}
                      </a>
                    ) : (
                      `${t.source_id}, ${t.page}`
                    )}
                    {t.note ? ` · ${t.note}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
          <details className="mt-4 border-t border-hairline pt-3">
            <summary className="cursor-pointer text-sm text-ink-2">SBTi Target Dashboard</summary>
            <div className="mt-3">
              <SbtiPanel entry={sbtiFor(sbti, list[0].t.company_id)} sbti={sbti} claimsValidated={list.some((x) => x.t.validation === "sbti_validated")} />
            </div>
          </details>
        </Card>
      ))}

      {(() => {
        const withTargets = new Set(targets.map((t) => t.company_id));
        const rest = listCompanies().filter((c) => !withTargets.has(c.id));
        if (!rest.length) return null;
        return (
          <Card title="Companies without targets recorded here">
            <p className="mb-3 text-sm text-ink-2">
              No targets have been curated for these companies yet (not assessed, not a statement that they have none).
              Their SBTi status is shown for reference.
            </p>
            <ul className="flex flex-col gap-4">
              {rest.map((c) => (
                <li key={c.id} className="border-b border-hairline pb-4 last:border-0 last:pb-0">
                  <Link href={`/companies/${c.id}`} className="text-sm font-medium text-accent hover:underline">
                    {c.name}
                  </Link>
                  <div className="mt-2">
                    <SbtiPanel entry={sbtiFor(sbti, c.id)} sbti={sbti} claimsValidated={false} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })()}
    </div>
  );
}
